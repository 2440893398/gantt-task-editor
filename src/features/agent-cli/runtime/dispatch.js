import { getCommand } from '../registry.js';
import { bumpProjectRev, getProjectRev } from '../../gantt/domain/rev.js';
import { runGanttTransaction } from '../../gantt/domain/transaction.js';
import { settleAndPersist } from '../../gantt/domain/settle.js';
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

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
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
                data = command.op
                    ? await command.op.commit(plan, ctx)
                    : await command.handler(resolvedArgs, ctx);
            } finally {
                endCommandUndoScope();
            }

            const commandResult = normalizeCommandResult(data, currentRev);

            if (!commandResult.ok) {
                throw new CommandResultError(commandResult);
            }

            if (
                typeof command.shouldCommit === 'function' &&
                !command.shouldCommit(commandResult.data)
            ) {
                return {
                    changed: false,
                    result: commandResult,
                };
            }

            await settleAndPersist({
                projectId,
                source: 'agent',
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

export async function dispatch(name, args = {}, context = {}) {
    const started = nowMs();
    const projectId = context.projectId || 'default';
    const command = getCommand(name);
    let result;
    let resolvedArgs = args;

    if (!command) {
        return fail('UNKNOWN_COMMAND', `Unknown command: ${name}`, {
            rev: getProjectRev(projectId),
        });
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

        if (!command.mutating) {
            const rev = getProjectRev(projectId);
            const data = await command.handler(resolvedArgs, ctx);
            result = normalizeCommandResult(data, rev);
            return result;
        }

        const currentRev = getProjectRev(projectId);

        if (context.ifRev !== undefined && context.ifRev !== currentRev) {
            result = fail('CONFLICT', 'Project revision changed.', {
                hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
                rev: currentRev,
            });
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
                ? await command.op.plan(resolvedArgs, ctx)
                : undefined;

        if (plan?.ok === false) {
            result = withRev(plan, currentRev);
            return result;
        }

        if (wantsDryRun) {
            result = ok({ diff: plan.diff }, currentRev);
            return result;
        }

        if (command.op?.skipEmptyDiff === true && isEmptyDiff(plan.diff)) {
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
            ? ok({ diff: plan.diff }, nextRev)
            : replaceRev(txResult.data.result, nextRev);
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
