import { getCommand } from '../registry.js';
import { bumpProjectRev, getProjectRev } from '../../gantt/domain/rev.js';
import { runGanttTransaction } from '../../gantt/domain/transaction.js';
import { settleAndPersist } from '../../gantt/domain/settle.js';
import { createEmptyDiff, mergeDiffs } from '../../gantt/domain/diff.js';
import { DEFAULT_PROJECT_ID } from '../../../core/storage.js';
import { runProjectMutationExclusive } from '../../../core/project-mutation-gate.js';
import { state } from '../../../core/store.js';
import {
    beginCommandUndoScope,
    endCommandUndoScope,
    restoreHistoryForTransaction,
    snapshotHistoryForTransaction,
} from '../../gantt/history/undoManager.js';
import { validateArgs } from './guards.js';
import { recordCommandLog } from './log.js';
import { fail, ok } from './result.js';

class CommandResultError extends Error {
    constructor(result) {
        super(result.error?.message || 'Command failed');
        this.result = result;
    }
}

/**
 * Command-level idempotency (design spec §4/§6, milestone M2).
 *
 * A successful mutating dispatch that carries an `idempotencyKey` caches its
 * result under `(projectId, key)`. A later dispatch with the SAME key returns
 * the stored result verbatim WITHOUT re-planning or re-committing, so an agent
 * retry never double-writes. This mirrors the operation-manager idempotency on
 * the long-running `app.operation()` path, but for the direct command path.
 */
const idempotencyResults = new Map();

function scopedIdempotencyKey(projectId, command, key) {
    const normalized = String(key ?? '').trim();
    if (!normalized) {
        return null;
    }

    const scope = command.execution === 'direct' ? 'workspace' : projectId;
    return `${scope}::${command.name}::${normalized}`;
}

export function clearIdempotencyCacheForTest() {
    idempotencyResults.clear();
}

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function readOnlyResult(rev) {
    return fail('CONSTRAINT', 'Agent command layer is read-only.', {
        hint: 'Use read commands only or enable write mode in app configuration.',
        rev,
    });
}

function cancelledResult(rev) {
    return fail('CANCELLED', 'Operation cancelled.', {
        hint: 'The operation was cancelled before it reached a final commit.',
        rev,
    });
}

function throwIfCancelled(context, rev) {
    if (context?.signal?.aborted) {
        throw new CommandResultError(cancelledResult(rev));
    }
}

function reportProgress(context, progress) {
    if (typeof context?.reportProgress !== 'function') {
        return;
    }

    try {
        context.reportProgress(progress);
    } catch {
        /* progress reporting is diagnostic only */
    }
}

async function yieldForCancellation(context) {
    if (!context?.signal) {
        return;
    }

    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Whether a mutating command should also push to the cloud. Cloud sync is
 * opt-in: a caller must explicitly pass `sync: true` (via the command args or
 * the dispatch context). Default behavior stays local-only.
 */
function wantsCloudSync(context, resolvedArgs) {
    return context.sync === true || resolvedArgs?.sync === true;
}

function maybeScheduleCloudSync(context, resolvedArgs, projectId) {
    if (wantsCloudSync(context, resolvedArgs) && typeof context.scheduleCloudSync === 'function') {
        // Cloud sync runs AFTER commit + rev bump inside the success path's try
        // block. It is best-effort: a synchronous throw here must never bubble
        // into the surrounding catch and turn an already-applied write into an
        // EXEC_ERROR. Swallow scheduling failures.
        try {
            context.scheduleCloudSync(projectId);
        } catch {
            /* best-effort: never fail a committed write on a sync-scheduling error */
        }
    }
}

function maybeMarkLocalOnlyAutosave(context, resolvedArgs, projectId) {
    if (
        !wantsCloudSync(context, resolvedArgs) &&
        typeof context.markNextAutosaveLocalOnly === 'function'
    ) {
        try {
            context.markNextAutosaveLocalOnly(projectId);
        } catch {
            /* best-effort: never fail a committed write on an autosave marker error */
        }
    }
}

function getGantt(context) {
    return context.gantt || context.adapter?.gantt || globalThis.gantt;
}

function normalizeCommandResult(result, rev) {
    if (result?.ok === true || result?.ok === false) {
        return result.rev === undefined ? { ...result, rev } : result;
    }

    return ok(result, rev);
}

function withRev(result, rev) {
    return result.rev === undefined ? { ...result, rev } : result;
}

function replaceRev(result, rev) {
    return { ...result, rev };
}

function buildOpSuccessData(commitData, diff) {
    if (commitData && typeof commitData === 'object' && !Array.isArray(commitData)) {
        return {
            ...commitData,
            diff,
        };
    }

    return { diff };
}

function getNoOpAliasValue(plan, args) {
    return plan?.id ?? plan?.task?.id ?? args?.id;
}

function getCommitFailureResult(error, fallbackRev) {
    if (error instanceof CommandResultError || error?.result) {
        return withRev(error.result, fallbackRev);
    }

    return null;
}

function isEmptyDiff(diff) {
    return (
        Array.isArray(diff?.created) &&
        diff.created.length === 0 &&
        Array.isArray(diff?.updated) &&
        diff.updated.length === 0 &&
        Array.isArray(diff?.deleted) &&
        diff.deleted.length === 0 &&
        Array.isArray(diff?.links?.added) &&
        diff.links.added.length === 0 &&
        Array.isArray(diff?.links?.removed) &&
        diff.links.removed.length === 0
    );
}

async function runSettledTransaction({ command, resolvedArgs, ctx, projectId, currentRev, plan }) {
    const txResult = await runGanttTransaction({
        gantt: ctx.gantt,
        history: {
            snapshot: snapshotHistoryForTransaction,
            restore: restoreHistoryForTransaction,
        },
        work: async () => {
            beginCommandUndoScope();
            let data;

            try {
                throwIfCancelled(ctx, currentRev);
                reportProgress(ctx, {
                    stage: 'commit',
                    message: `Committing ${command.name}.`,
                });
                data = command.op
                    ? await command.op.commit(plan, ctx)
                    : await command.handler(resolvedArgs, ctx);
            } finally {
                endCommandUndoScope();
            }

            throwIfCancelled(ctx, currentRev);
            const commandResult = normalizeCommandResult(data, currentRev);

            if (!commandResult.ok) {
                throw new CommandResultError(commandResult);
            }

            if (
                typeof command.shouldCommit === 'function' &&
                !command.shouldCommit(commandResult.data)
            ) {
                reportProgress(ctx, {
                    stage: 'no_change',
                    message: `${command.name} completed without changes.`,
                });
                return {
                    changed: false,
                    result: commandResult,
                };
            }

            throwIfCancelled(ctx, currentRev);
            reportProgress(ctx, {
                stage: 'settle',
                message: `Settling ${command.name}.`,
            });
            await settleAndPersist({
                projectId,
                source: 'agent',
            });
            reportProgress(ctx, {
                stage: 'settled',
                message: `${command.name} settled and persisted.`,
            });

            return {
                changed: true,
                result: commandResult,
            };
        },
    });

    if (!txResult.ok) {
        return {
            ok: false,
            result:
                getCommitFailureResult(txResult.error, currentRev) ||
                fail('EXEC_ERROR', txResult.error?.message || `Command failed: ${command.name}`, {
                    rev: currentRev,
                }),
        };
    }

    return {
        ok: true,
        data: txResult.data,
    };
}

async function dispatchUnlocked(name, args = {}, context = {}) {
    const started = nowMs();
    const projectId = context.projectId || DEFAULT_PROJECT_ID;
    const command = getCommand(name);
    let result;
    let resolvedArgs = args;
    let idemKey = null;
    let cacheIdempotentResult = false;

    if (!command) {
        return fail('UNKNOWN_COMMAND', `Unknown command: ${name}`, {
            rev: getProjectRev(projectId),
        });
    }

    if (command.mutating && context.readOnly) {
        return readOnlyResult(getProjectRev(projectId));
    }

    try {
        const validated = validateArgs(command.params, args);
        if (!validated.ok) {
            result = withRev(validated, getProjectRev(projectId));
            return result;
        }

        resolvedArgs = validated.args;
        const ctx = {
            ...context,
            projectId,
            gantt: getGantt(context),
        };
        reportProgress(ctx, {
            stage: 'validated',
            message: `Validated ${name}.`,
        });
        throwIfCancelled(ctx, getProjectRev(projectId));

        if (!command.mutating) {
            const rev = getProjectRev(projectId);
            throwIfCancelled(ctx, rev);
            reportProgress(ctx, {
                stage: 'read',
                message: `Reading ${name}.`,
            });
            const data = await command.handler(resolvedArgs, ctx);
            result = normalizeCommandResult(data, rev);
            return result;
        }

        idemKey = scopedIdempotencyKey(
            projectId,
            command,
            resolvedArgs.idempotencyKey ?? context.idempotencyKey
        );
        if (idemKey && idempotencyResults.has(idemKey)) {
            // Idempotent replay: return the stored result without re-executing.
            result = idempotencyResults.get(idemKey);
            return result;
        }
        cacheIdempotentResult = Boolean(idemKey);

        const currentRev = getProjectRev(projectId);

        if (context.ifRev !== undefined && context.ifRev !== currentRev) {
            result = fail('CONFLICT', 'Project revision changed.', {
                hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
                rev: currentRev,
            });
            return result;
        }

        // Workspace-level mutations such as switching projects do not mutate
        // the current Gantt data and therefore must not open a Gantt
        // transaction, settle task state, or bump a project revision.
        if (command.execution === 'direct') {
            reportProgress(ctx, {
                stage: 'commit',
                message: `Committing ${command.name}.`,
            });
            const data = await command.handler(resolvedArgs, ctx);
            result = normalizeCommandResult(data, currentRev);
            return result;
        }

        const wantsDryRun = context.dryRun || resolvedArgs.dryRun;
        if (wantsDryRun && typeof command.op?.plan !== 'function') {
            result = fail('BAD_ARGS', `Dry-run is not supported for ${command.name}.`, {
                hint: `Run ${command.name} without dryRun.`,
                rev: currentRev,
            });
            return result;
        }

        const plan =
            typeof command.op?.plan === 'function'
                ? await (async () => {
                      reportProgress(ctx, {
                          stage: 'plan',
                          message: `Planning ${command.name}.`,
                      });
                      const planned = await command.op.plan(resolvedArgs, ctx);
                      reportProgress(ctx, {
                          stage: 'planned',
                          message: `Planned ${command.name}.`,
                      });
                      return planned;
                  })()
                : undefined;
        throwIfCancelled(ctx, currentRev);

        if (plan?.ok === false) {
            result = withRev(plan, currentRev);
            return result;
        }

        if (wantsDryRun) {
            reportProgress(ctx, {
                stage: 'previewed',
                message: `Previewed ${command.name}.`,
            });
            result = ok({ diff: plan.diff }, currentRev);
            return result;
        }

        if (command.op?.skipEmptyDiff === true && isEmptyDiff(plan.diff)) {
            reportProgress(ctx, {
                stage: 'no_change',
                message: `${command.name} produced no changes.`,
            });
            result = ok({ diff: plan.diff }, currentRev);
            return result;
        }

        const txResult = await runSettledTransaction({
            command,
            resolvedArgs,
            ctx,
            projectId,
            currentRev,
            plan,
        });

        if (!txResult.ok) {
            result = txResult.result;
            return result;
        }

        if (!txResult.data.changed) {
            result = withRev(txResult.data.result, currentRev);
            return result;
        }

        const nextRev = bumpProjectRev(projectId);
        result = command.op
            ? ok(buildOpSuccessData(txResult.data.result.data, plan.diff), nextRev)
            : replaceRev(txResult.data.result, nextRev);
        maybeMarkLocalOnlyAutosave(context, resolvedArgs, projectId);
        maybeScheduleCloudSync(context, resolvedArgs, projectId);
        return result;
    } catch (error) {
        const rev = getProjectRev(projectId);
        result =
            getCommitFailureResult(error, rev) ||
            fail('EXEC_ERROR', error.message || `Command failed: ${name}`, {
                rev,
            });
        return result;
    } finally {
        if (command.mutating && result) {
            // Cache only real (non-dry-run) successful writes for idempotent replay.
            const wasDryRun = Boolean(context.dryRun || resolvedArgs.dryRun);
            if (idemKey && cacheIdempotentResult && result.ok && !wasDryRun) {
                idempotencyResults.set(idemKey, result);
            }

            recordCommandLog({
                name,
                args: resolvedArgs,
                ok: result.ok,
                rev: result.rev,
                ms: Math.max(0, Math.round(nowMs() - started)),
            });
        }
    }
}

export function dispatch(name, args = {}, context = {}) {
    const command = getCommand(name);
    if (command?.mutating && command.execution !== 'direct') {
        return runProjectMutationExclusive(() => {
            const activeProjectId = state.currentProjectId || DEFAULT_PROJECT_ID;
            if (context._dynamicProjectId && context.projectId !== activeProjectId) {
                return fail('CONFLICT', 'Active project changed while the command was queued.', {
                    hint: 'Read the active project state, then retry the command.',
                    rev: getProjectRev(activeProjectId),
                });
            }
            return dispatchUnlocked(name, args, context);
        });
    }

    return dispatchUnlocked(name, args, context);
}

const REF_PREFIX = '$';

function isRefToken(value) {
    return typeof value === 'string' && value.length > 1 && value.startsWith(REF_PREFIX);
}

function refAlias(value) {
    return value.slice(REF_PREFIX.length);
}

/**
 * Recursively replace `$alias` reference tokens with values from `aliases`.
 * An unknown alias throws a CommandResultError carrying a BAD_ARGS result.
 */
function resolveRefs(value, aliases) {
    if (isRefToken(value)) {
        const alias = refAlias(value);
        if (!Object.hasOwn(aliases, alias)) {
            throw new CommandResultError(
                fail('BAD_ARGS', `Unknown batch reference: ${value}`, {
                    hint: `No earlier step declares as: '${alias}'.`,
                })
            );
        }
        return aliases[alias];
    }

    if (Array.isArray(value)) {
        return value.map((item) => resolveRefs(item, aliases));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, resolveRefs(item, aliases)])
        );
    }

    return value;
}

function getStepCommand(step) {
    const command = getCommand(step?.op);

    if (!command) {
        return {
            ok: false,
            result: fail('UNKNOWN_COMMAND', `Unknown command: ${step?.op}`),
        };
    }

    if (!command.mutating) {
        return {
            ok: false,
            result: fail('BAD_ARGS', `Command ${command.name} cannot run inside a batch.`, {
                hint: 'Batch steps must be mutating commands.',
            }),
        };
    }

    if (typeof command.op?.plan !== 'function' || typeof command.op?.commit !== 'function') {
        return {
            ok: false,
            result: fail('BAD_ARGS', `Command ${command.name} does not support batch execution.`, {
                hint: 'Batch steps require commands with plan and commit operations.',
            }),
        };
    }

    return { ok: true, command };
}

/**
 * Recursively determine whether a value contains at least one `$ref` token.
 */
function containsRef(value) {
    if (isRefToken(value)) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.some((item) => containsRef(item));
    }

    if (value && typeof value === 'object') {
        return Object.values(value).some((item) => containsRef(item));
    }

    return false;
}

/**
 * Recursively assert every `$ref` token in a value names an alias that was
 * already declared by an earlier step. Throws a CommandResultError otherwise.
 * This is an existence check only — it does NOT substitute values, because a
 * forward ref's real id does not exist until the referenced step commits.
 */
function assertRefsDeclared(value, declaredAliases) {
    if (isRefToken(value)) {
        const alias = refAlias(value);
        if (!declaredAliases.has(alias)) {
            throw new CommandResultError(
                fail('BAD_ARGS', `Unknown batch reference: ${value}`, {
                    hint: `No earlier step declares as: '${alias}'.`,
                })
            );
        }
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => assertRefsDeclared(item, declaredAliases));
        return;
    }

    if (value && typeof value === 'object') {
        Object.values(value).forEach((item) => assertRefsDeclared(item, declaredAliases));
    }
}

/**
 * Walk steps in order, surfacing command/argument/reference errors BEFORE any
 * transaction opens. A step whose args contain an unresolved forward `$ref`
 * cannot be schema-validated or planned with a placeholder (ref targets are
 * often typed, e.g. integer ids), so its validateArgs + plan are DEFERRED to
 * the transaction where refs resolve to real committed ids. Ref-independent
 * steps are validated and planned here, contributing their real diff.
 *
 * Returns `{ ok, diff, warnings }` for dry-run reporting, or `{ ok: false,
 * result }` carrying the failing step result.
 */
async function preflightBatch(steps, ctx) {
    const declaredAliases = new Set();
    const diffs = [];
    const warnings = [];

    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const resolved = getStepCommand(step);
        if (!resolved.ok) {
            return resolved;
        }

        const { command } = resolved;
        const stepArgs = step.args || {};
        reportProgress(ctx, {
            stage: 'batch_preflight',
            message: `Preflighting ${command.name}.`,
            currentStep: index + 1,
            totalSteps: steps.length,
        });

        // Every forward ref must name an already-declared alias.
        try {
            assertRefsDeclared(stepArgs, declaredAliases);
        } catch (error) {
            return { ok: false, result: getCommitFailureResult(error, undefined) };
        }

        if (containsRef(stepArgs)) {
            // Defer validateArgs + plan to the transaction (real ids needed).
            warnings.push(
                `Step ${index + 1} (${command.name}) not previewed: depends on an id created in this batch.`
            );
        } else {
            const validated = validateArgs(command.params, stepArgs);
            if (!validated.ok) {
                return { ok: false, result: validated };
            }

            let plan;
            try {
                plan = await command.op.plan(validated.args, ctx);
            } catch (error) {
                return {
                    ok: false,
                    result: fail('EXEC_ERROR', error.message || `Plan failed: ${command.name}`),
                };
            }

            if (plan?.ok === false) {
                return { ok: false, result: plan };
            }

            diffs.push(plan?.diff || createEmptyDiff());
        }

        if (step.as) {
            declaredAliases.add(step.as);
        }
    }

    return { ok: true, diff: mergeDiffs(diffs), warnings };
}

/**
 * Execute an atomic sequence of mutating commands as ONE transaction:
 * one settle, one rev bump, full rollback on any failure. `$ref` tokens
 * resolve left-to-right to ids returned by earlier steps' commits.
 */
async function batchUnlocked(steps = [], context = {}) {
    const started = nowMs();
    const projectId = context.projectId || DEFAULT_PROJECT_ID;
    const currentRev = getProjectRev(projectId);
    let result;

    if (context.readOnly) {
        result = readOnlyResult(currentRev);
        return result;
    }

    try {
        const ctx = {
            ...context,
            projectId,
            gantt: getGantt(context),
        };
        throwIfCancelled(ctx, currentRev);

        if (context.ifRev !== undefined && context.ifRev !== currentRev) {
            result = fail('CONFLICT', 'Project revision changed.', {
                hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
                rev: currentRev,
            });
            return result;
        }

        // An empty batch is a no-op: no transaction, no settle, no rev bump.
        if (steps.length === 0) {
            result = ok({ steps: [], diff: createEmptyDiff() }, currentRev);
            return result;
        }

        const preflight = await preflightBatch(steps, ctx);
        throwIfCancelled(ctx, currentRev);
        if (!preflight.ok) {
            result = withRev(preflight.result, currentRev);
            return result;
        }

        if (context.dryRun) {
            result = ok({ steps: [], diff: preflight.diff }, currentRev, preflight.warnings);
            return result;
        }

        const txResult = await runGanttTransaction({
            gantt: ctx.gantt,
            history: {
                snapshot: snapshotHistoryForTransaction,
                restore: restoreHistoryForTransaction,
            },
            work: async () => {
                beginCommandUndoScope();

                try {
                    const aliases = {};
                    const stepResults = [];
                    const diffs = [];
                    let changed = false;

                    for (let index = 0; index < steps.length; index += 1) {
                        const step = steps[index];
                        throwIfCancelled(ctx, currentRev);
                        await yieldForCancellation(ctx);
                        throwIfCancelled(ctx, currentRev);

                        const command = getCommand(step.op);
                        reportProgress(ctx, {
                            stage: 'batch_step',
                            message: `Committing ${command.name}.`,
                            currentStep: index + 1,
                            totalSteps: steps.length,
                        });
                        const resolvedArgs = resolveRefs(step.args || {}, aliases);
                        const validated = validateArgs(command.params, resolvedArgs);

                        if (!validated.ok) {
                            throw new CommandResultError(validated);
                        }

                        reportProgress(ctx, {
                            stage: 'batch_plan',
                            message: `Planning ${command.name}.`,
                            currentStep: index + 1,
                            totalSteps: steps.length,
                        });
                        const plan = await command.op.plan(validated.args, ctx);
                        throwIfCancelled(ctx, currentRev);
                        if (plan?.ok === false) {
                            throw new CommandResultError(plan);
                        }

                        const stepDiff = plan?.diff || createEmptyDiff();

                        // Mirror single-op: skip commit for a no-op step that opts in.
                        if (command.op.skipEmptyDiff === true && isEmptyDiff(stepDiff)) {
                            const aliasValue = getNoOpAliasValue(plan, validated.args);
                            if (step.as && aliasValue !== undefined) {
                                aliases[step.as] = aliasValue;
                            }
                            diffs.push(stepDiff);
                            continue;
                        }

                        const data = await command.op.commit(plan, ctx);
                        throwIfCancelled(ctx, currentRev);
                        reportProgress(ctx, {
                            stage: 'batch_step_committed',
                            message: `Committed ${command.name}.`,
                            currentStep: index + 1,
                            totalSteps: steps.length,
                        });
                        const commandResult = normalizeCommandResult(data, currentRev);
                        if (!commandResult.ok) {
                            throw new CommandResultError(commandResult);
                        }

                        changed = true;
                        stepResults.push(commandResult.data);
                        diffs.push(stepDiff);

                        if (step.as && commandResult.data?.id !== undefined) {
                            aliases[step.as] = commandResult.data.id;
                        }
                    }

                    if (changed) {
                        throwIfCancelled(ctx, currentRev);
                        reportProgress(ctx, {
                            stage: 'batch_settle',
                            message: 'Settling batch.',
                        });
                        await settleAndPersist({
                            projectId,
                            source: 'agent',
                        });
                        reportProgress(ctx, {
                            stage: 'batch_settled',
                            message: 'Batch settled and persisted.',
                        });
                    }

                    return { changed, steps: stepResults, diff: mergeDiffs(diffs) };
                } finally {
                    endCommandUndoScope();
                }
            },
        });

        if (!txResult.ok) {
            result =
                getCommitFailureResult(txResult.error, currentRev) ||
                fail('EXEC_ERROR', txResult.error?.message || 'Batch failed.', {
                    rev: currentRev,
                });
            return result;
        }

        // Nothing committed (all no-op steps): do not settle or bump rev.
        if (!txResult.data.changed) {
            result = ok({ steps: txResult.data.steps, diff: txResult.data.diff }, currentRev);
            return result;
        }

        const nextRev = bumpProjectRev(projectId);
        result = ok({ steps: txResult.data.steps, diff: txResult.data.diff }, nextRev);
        maybeMarkLocalOnlyAutosave(context, undefined, projectId);
        maybeScheduleCloudSync(context, undefined, projectId);
        return result;
    } catch (error) {
        result =
            getCommitFailureResult(error, currentRev) ||
            fail('EXEC_ERROR', error.message || 'Batch failed.', {
                rev: currentRev,
            });
        return result;
    } finally {
        recordCommandLog({
            name: 'batch',
            args: { steps: steps.length },
            ok: Boolean(result?.ok),
            rev: result?.rev,
            ms: Math.max(0, Math.round(nowMs() - started)),
        });
    }
}

export function batch(steps = [], context = {}) {
    return runProjectMutationExclusive(() => {
        const activeProjectId = state.currentProjectId || DEFAULT_PROJECT_ID;
        if (context._dynamicProjectId && context.projectId !== activeProjectId) {
            return fail('CONFLICT', 'Active project changed while the batch was queued.', {
                hint: 'Read the active project state, then retry the batch.',
                rev: getProjectRev(activeProjectId),
            });
        }
        return batchUnlocked(steps, context);
    });
}
