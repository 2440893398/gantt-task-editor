import { getProjectRev } from '../../gantt/domain/rev.js';
import { fail, ok, withErrorNavigation } from './result.js';
import { stableStringify } from './stable-key.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const MAX_OPERATION_HISTORY = 50;
const OPERATION_POLL_AFTER_MS = 1000;
const OPERATION_LONG_RUNNING_MS = 10000;
const OPERATION_NO_PROGRESS_OBSERVED_MS = 60000;

function nowMs() {
    return Date.now();
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTerminalStatus(status) {
    return TERMINAL_STATUSES.has(status);
}

function operationResultRev(operation) {
    return operation.result?.rev ?? getProjectRev(operation.projectId);
}

function operationProgress(operation, observedAtMs) {
    if (!operation.progress) {
        return null;
    }

    const { updatedAtMs, ...progress } = operation.progress;
    return {
        ...progress,
        updatedAt: new Date(updatedAtMs).toISOString(),
        ageMs: Math.max(0, observedAtMs - updatedAtMs),
    };
}

function buildHealth(operation, observedAtMs) {
    if (isTerminalStatus(operation.status)) {
        return { health: operation.status };
    }

    const progressAgeMs = Math.max(0, observedAtMs - operation.lastProgressAtMs);
    if (progressAgeMs >= OPERATION_NO_PROGRESS_OBSERVED_MS) {
        return {
            health: 'no_progress_observed',
            advisory: {
                code: 'NO_PROGRESS_OBSERVED',
                message: 'No operation progress heartbeat has been observed recently.',
                hint: 'The operation manager is still responsive, but the business command has not reached a progress checkpoint. Request cancellation if the work should stop.',
            },
        };
    }

    if (operation.status === 'cancel_requested') {
        return {
            health: 'cancelling',
            advisory: {
                code: 'CANCEL_REQUESTED',
                message: 'Cancellation has been requested.',
                hint: 'Cancellation is cooperative; wait for a checkpoint to return CANCELLED, or use operation.status to keep polling.',
            },
        };
    }

    if (observedAtMs - operation.startedAtMs >= OPERATION_LONG_RUNNING_MS) {
        return {
            health: 'long_running',
            advisory: {
                code: 'LONG_RUNNING',
                message: 'The operation is taking longer than usual.',
                hint: 'Large writes, scheduling, or persistence may legitimately take time. Continue polling unless you need to cancel.',
            },
        };
    }

    return { health: 'running' };
}

function publicOperation(operation, { includeResult = false } = {}) {
    const observedAtMs = nowMs();
    const finishedAtMs = operation.finishedAtMs;
    const progress = operationProgress(operation, observedAtMs);
    const health = buildHealth(operation, observedAtMs);

    return {
        operationId: operation.id,
        status: operation.status,
        command: operation.command,
        projectId: operation.projectId,
        mutating: operation.mutating,
        cancelRequested: operation.cancelRequested,
        ...(operation.idempotencyKey ? { idempotencyKey: operation.idempotencyKey } : {}),
        startedAt: new Date(operation.startedAtMs).toISOString(),
        ...(finishedAtMs ? { finishedAt: new Date(finishedAtMs).toISOString() } : {}),
        elapsedMs: Math.max(0, (finishedAtMs ?? observedAtMs) - operation.startedAtMs),
        heartbeatAt: new Date(observedAtMs).toISOString(),
        pollAfterMs: OPERATION_POLL_AFTER_MS,
        ...health,
        ...(progress ? { progress } : {}),
        ...(includeResult && operation.result ? { result: operation.result } : {}),
    };
}

function operationNotFound(id) {
    return fail('NOT_FOUND', 'Operation not found.', {
        hint: 'Use operation.start to create an operation, then pass its operationId.',
        operationId: id,
    });
}

function normalizeStartRequest(request = {}) {
    if (!isPlainObject(request)) {
        return fail('BAD_ARGS', 'operation.start requires a JSON object.');
    }

    const command = String(request.command || request.name || '').trim();
    if (!command) {
        return fail('BAD_ARGS', 'operation.start requires command.');
    }

    const args = request.args === undefined ? {} : request.args;
    if (!isPlainObject(args)) {
        return fail('BAD_ARGS', 'operation.start args must be a JSON object.');
    }

    const options = request.options === undefined ? {} : request.options;
    if (!isPlainObject(options)) {
        return fail('BAD_ARGS', 'operation.start options must be a JSON object.');
    }

    if (command === 'batch') {
        const steps = Array.isArray(request.steps) ? request.steps : args.steps;
        if (!Array.isArray(steps)) {
            return fail('BAD_ARGS', 'operation.start batch requires steps array.');
        }
        return { ok: true, command, args, options, steps, idempotencyKey: request.idempotencyKey };
    }

    return { ok: true, command, args, options, idempotencyKey: request.idempotencyKey };
}

function isCancelledResult(result) {
    return result?.ok === false && result.error?.code === 'CANCELLED';
}

function createOperationId(nextSeq) {
    return `op_${Date.now().toString(36)}_${nextSeq}`;
}

function recordOperationProgress(operation, progress = {}) {
    if (!operation || isTerminalStatus(operation.status)) {
        return;
    }

    const updatedAtMs = nowMs();
    operation.progressSeq += 1;
    operation.lastProgressAtMs = updatedAtMs;
    operation.progress = {
        stage: String(progress.stage || 'running'),
        ...(progress.message ? { message: String(progress.message) } : {}),
        ...(Number.isFinite(progress.currentStep) ? { currentStep: progress.currentStep } : {}),
        ...(Number.isFinite(progress.totalSteps) ? { totalSteps: progress.totalSteps } : {}),
        sequence: operation.progressSeq,
        updatedAtMs,
    };
}

export function createOperationManager({
    executeRequest,
    getContext,
    getCommand,
    getRev = getProjectRev,
} = {}) {
    const operations = new Map();
    const activeMutatingByProject = new Map();
    const operationsByIdempotencyKey = new Map();
    let seq = 0;

    function deleteOperation(operation) {
        operations.delete(operation.id);

        const scopedKey = normalizeIdempotencyKey(operation.projectId, operation.idempotencyKey);
        if (scopedKey && operationsByIdempotencyKey.get(scopedKey) === operation.id) {
            operationsByIdempotencyKey.delete(scopedKey);
        }
    }

    // 与 dispatch 层的幂等缓存同理：历史有上限，被淘汰的 idempotencyKey 重放会
    // 重新执行——幂等窗口有限（MAX_OPERATION_HISTORY 条终态操作）是协议已知约束。
    // 淘汰时必须连同 key 映射一起清理，否则映射表在长会话下无限增长。
    function pruneHistory() {
        if (operations.size <= MAX_OPERATION_HISTORY) {
            return;
        }

        const removable = [...operations.values()]
            .filter((operation) => isTerminalStatus(operation.status))
            .sort((a, b) => a.startedAtMs - b.startedAtMs);

        while (operations.size > MAX_OPERATION_HISTORY && removable.length) {
            deleteOperation(removable.shift());
        }
    }

    function getOperation(id) {
        return operations.get(String(id || ''));
    }

    function isMutatingRequest(request) {
        if (request.command === 'batch') {
            return true;
        }

        return Boolean(getCommand?.(request.command)?.mutating);
    }

    function normalizeIdempotencyKey(projectId, key) {
        const normalized = String(key || '').trim();
        return normalized ? `${projectId}:${normalized}` : null;
    }

    function finishOperation(operation, result) {
        operation.result = result;
        operation.finishedAtMs = nowMs();
        operation.status = isCancelledResult(result)
            ? 'cancelled'
            : result?.ok
              ? 'succeeded'
              : 'failed';

        if (
            operation.mutating &&
            activeMutatingByProject.get(operation.projectId) === operation.id
        ) {
            activeMutatingByProject.delete(operation.projectId);
        }

        pruneHistory();
    }

    async function runOperation(operation, request) {
        try {
            recordOperationProgress(operation, {
                stage: 'started',
                message: `Started ${request.command}.`,
            });
            const result = await executeRequest(request, {
                signal: operation.controller.signal,
                operationId: operation.id,
                reportProgress: (progress) => recordOperationProgress(operation, progress),
            });
            finishOperation(operation, result);
        } catch (error) {
            finishOperation(
                operation,
                fail(
                    operation.controller.signal.aborted ? 'CANCELLED' : 'EXEC_ERROR',
                    operation.controller.signal.aborted
                        ? 'Operation cancelled.'
                        : error?.message || 'Operation failed.',
                    { rev: getRev(operation.projectId) }
                )
            );
        }
    }

    async function start(request = {}) {
        const normalized = normalizeStartRequest(request);
        const context = getContext();
        const projectId = context.projectId;
        const rev = getRev(projectId);

        if (!normalized.ok) {
            return { ...normalized, rev };
        }

        const mutating = isMutatingRequest(normalized);
        // Request fingerprint for idempotent replay. `options` (ifRev/schemaRev/
        // policyRev) are excluded on purpose: a legitimate retry may refresh
        // revision guards, but command/args/steps must be identical.
        const requestKey = stableStringify({
            command: normalized.command,
            args: normalized.args,
            ...(normalized.steps ? { steps: normalized.steps } : {}),
        });
        const scopedIdempotencyKey = normalizeIdempotencyKey(projectId, normalized.idempotencyKey);
        const existingOperationId = scopedIdempotencyKey
            ? operationsByIdempotencyKey.get(scopedIdempotencyKey)
            : null;
        const existingOperation = getOperation(existingOperationId);
        if (existingOperation) {
            if (existingOperation.requestKey !== requestKey) {
                return fail(
                    'CONFLICT',
                    'idempotencyKey was already used with a different request.',
                    {
                        hint: 'An idempotencyKey identifies ONE operation. Use a new key for a different request, or retry with the original command, args, and steps.',
                        operationId: existingOperation.id,
                        rev,
                    }
                );
            }
            return ok(publicOperation(existingOperation), operationResultRev(existingOperation));
        }

        if (mutating && context.readOnly) {
            return fail('CONSTRAINT', 'Agent command layer is read-only.', {
                hint: 'Use read commands only or enable write mode in app configuration.',
                rev,
            });
        }

        const activeOperationId = activeMutatingByProject.get(projectId);
        const activeOperation = getOperation(activeOperationId);
        if (mutating && activeOperation && !isTerminalStatus(activeOperation.status)) {
            return fail('BUSY', 'A mutating operation is already running for this project.', {
                hint: 'Wait for the active operation to finish, request cancellation, or poll operation.status.',
                operationId: activeOperation.id,
                status: activeOperation.status,
                rev,
            });
        }

        seq += 1;
        const operation = {
            id: createOperationId(seq),
            status: 'running',
            command: normalized.command,
            projectId,
            mutating,
            cancelRequested: false,
            idempotencyKey: normalized.idempotencyKey,
            requestKey,
            startedAtMs: nowMs(),
            lastProgressAtMs: nowMs(),
            progressSeq: 0,
            progress: null,
            controller: new AbortController(),
        };

        operations.set(operation.id, operation);
        if (scopedIdempotencyKey) {
            operationsByIdempotencyKey.set(scopedIdempotencyKey, operation.id);
        }
        if (mutating) {
            activeMutatingByProject.set(projectId, operation.id);
        }

        queueMicrotask(() => runOperation(operation, normalized));

        return ok(publicOperation(operation), rev);
    }

    async function status({ id } = {}) {
        const operation = getOperation(id);
        if (!operation) {
            return operationNotFound(id);
        }

        return ok(publicOperation(operation), operationResultRev(operation));
    }

    async function result({ id } = {}) {
        const operation = getOperation(id);
        if (!operation) {
            return operationNotFound(id);
        }

        if (!isTerminalStatus(operation.status)) {
            return fail('RUNNING', 'Operation is still running.', {
                hint: 'Use operation.status to poll or operation.cancel to request cancellation.',
                operationId: operation.id,
                status: operation.status,
                rev: getRev(operation.projectId),
            });
        }

        return ok(
            publicOperation(operation, { includeResult: true }),
            operationResultRev(operation)
        );
    }

    async function cancel({ id } = {}) {
        const operation = getOperation(id);
        if (!operation) {
            return operationNotFound(id);
        }

        if (isTerminalStatus(operation.status)) {
            return ok(publicOperation(operation), operationResultRev(operation));
        }

        operation.cancelRequested = true;
        operation.status = 'cancel_requested';
        operation.controller.abort();

        return ok(publicOperation(operation), getRev(operation.projectId));
    }

    function navigate(method, args, commandResult) {
        return withErrorNavigation(commandResult, {
            command: `operation.${method}`,
            args,
            getCommand,
        });
    }

    return {
        start: async (request) => navigate('start', request, await start(request)),
        status: async (args) => navigate('status', args, await status(args)),
        result: async (args) => navigate('result', args, await result(args)),
        cancel: async (args) => navigate('cancel', args, await cancel(args)),
    };
}
