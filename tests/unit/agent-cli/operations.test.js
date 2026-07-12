import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

const projectId = 'operation-test';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

function registerCreateCommand() {
    defineCommand({
        name: 'task.create',
        summary: 'Create task',
        params: {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        handler: () => ({ id: 1 }),
    });
}

function registerBatchCreateCommand({ commit }) {
    defineCommand({
        name: 'task.create',
        summary: 'Create task',
        params: {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        op: {
            plan: vi.fn((args) => ({
                args,
                diff: {
                    created: [{ text: args.name }],
                    updated: [],
                    deleted: [],
                    links: { added: [], removed: [] },
                },
            })),
            commit,
        },
    });
}

function createTransactionalGantt() {
    return {
        serialize: vi.fn(() => ({ data: [], links: [] })),
        clearAll: vi.fn(),
        parse: vi.fn(),
        render: vi.fn(),
    };
}

describe('agent operation runtime', () => {
    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        registerCreateCommand();
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        vi.restoreAllMocks();
    });

    it('starts a mutating command as a pollable operation and exposes its final result', async () => {
        const pending = deferred();
        const executeCommand = vi.fn(() => pending.promise);
        const app = buildApi({
            executeCommand,
            context: { projectId, adapter: 'trusted-adapter' },
        });

        const started = await app.operation.start({
            command: 'task.create',
            args: { name: 'Async task' },
            options: { ifRev: 0 },
        });

        expect(started).toMatchObject({
            ok: true,
            data: {
                status: 'running',
                command: 'task.create',
                projectId,
                mutating: true,
                operationId: expect.any(String),
            },
            rev: 0,
        });
        expect(executeCommand).toHaveBeenCalledWith(
            'task.create',
            { name: 'Async task' },
            expect.objectContaining({
                projectId,
                adapter: 'trusted-adapter',
                ifRev: 0,
                signal: expect.any(AbortSignal),
                operationId: started.data.operationId,
            })
        );

        await expect(app.operation.status({ id: started.data.operationId })).resolves.toMatchObject(
            {
                ok: true,
                data: {
                    status: 'running',
                    operationId: started.data.operationId,
                },
            }
        );

        pending.resolve({ ok: true, data: { id: 42 }, rev: 1 });

        await vi.waitFor(async () => {
            await expect(
                app.operation.status({ id: started.data.operationId })
            ).resolves.toMatchObject({
                ok: true,
                data: {
                    status: 'succeeded',
                    operationId: started.data.operationId,
                },
            });
        });

        await expect(app.operation.result({ id: started.data.operationId })).resolves.toMatchObject(
            {
                ok: true,
                data: {
                    status: 'succeeded',
                    result: { ok: true, data: { id: 42 }, rev: 1 },
                },
                rev: 1,
            }
        );
    });

    it('exposes command progress heartbeats while an operation is running', async () => {
        const pending = deferred();
        const executeCommand = vi.fn((name, args, context) => {
            context.reportProgress({
                stage: 'commit',
                message: 'Applying task changes',
                currentStep: 1,
                totalSteps: 2,
            });
            return pending.promise;
        });
        const app = buildApi({
            executeCommand,
            context: { projectId, adapter: {} },
        });

        const started = await app.operation.start({
            command: 'task.create',
            args: { name: 'Heartbeat task' },
        });

        await vi.waitFor(async () => {
            await expect(
                app.operation.status({ id: started.data.operationId })
            ).resolves.toMatchObject({
                ok: true,
                data: {
                    status: 'running',
                    health: 'running',
                    progress: {
                        stage: 'commit',
                        message: 'Applying task changes',
                        currentStep: 1,
                        totalSteps: 2,
                        sequence: expect.any(Number),
                        updatedAt: expect.any(String),
                        ageMs: expect.any(Number),
                    },
                    heartbeatAt: expect.any(String),
                    pollAfterMs: expect.any(Number),
                },
            });
        });

        pending.resolve({ ok: true, data: { id: 51 }, rev: 1 });
    });

    it('rejects a second mutating operation for the same project while one is running', async () => {
        const pending = deferred();
        const executeCommand = vi.fn(() => pending.promise);
        const app = buildApi({ executeCommand, context: { projectId, adapter: {} } });

        const first = await app.operation.start({
            command: 'task.create',
            args: { name: 'First' },
        });
        const second = await app.operation.start({
            command: 'task.create',
            args: { name: 'Second' },
        });

        expect(first.ok).toBe(true);
        expect(second).toEqual({
            ok: false,
            error: {
                code: 'BUSY',
                message: 'A mutating operation is already running for this project.',
                hint: 'Wait for the active operation to finish, request cancellation, or poll operation.status.',
                operationId: first.data.operationId,
                status: 'running',
                nextAction: {
                    command: 'operation.status',
                    args: { id: first.data.operationId },
                    reason: 'Poll the active operation status.',
                },
            },
            rev: 0,
        });
        expect(executeCommand).toHaveBeenCalledTimes(1);

        pending.resolve({ ok: true, data: { id: 1 }, rev: 1 });
        await vi.waitFor(async () => {
            await expect(
                app.operation.status({ id: first.data.operationId })
            ).resolves.toMatchObject({
                data: { status: 'succeeded' },
            });
        });
    });

    it('guides a premature result read back to operation.status', async () => {
        const pending = deferred();
        const app = buildApi({
            executeCommand: vi.fn(() => pending.promise),
            context: { projectId, adapter: {} },
        });
        const started = await app.operation.start({
            command: 'task.create',
            args: { name: 'Still running' },
        });

        const result = await app.operation.result({ id: started.data.operationId });

        expect(result.error).toMatchObject({
            code: 'RUNNING',
            nextAction: {
                command: 'operation.status',
                args: { id: started.data.operationId },
            },
        });
        pending.resolve({ ok: true, data: { id: 1 }, rev: 1 });
    });

    it('uses idempotencyKey to return the existing operation on start retries', async () => {
        const pending = deferred();
        const executeCommand = vi.fn(() => pending.promise);
        const app = buildApi({ executeCommand, context: { projectId, adapter: {} } });

        const first = await app.operation.start({
            command: 'task.create',
            args: { name: 'Retry-safe' },
            idempotencyKey: 'agent-op-1',
        });
        const retried = await app.operation.start({
            command: 'task.create',
            args: { name: 'Retry-safe' },
            idempotencyKey: 'agent-op-1',
        });

        expect(first.ok).toBe(true);
        expect(retried).toMatchObject({
            ok: true,
            data: {
                operationId: first.data.operationId,
                status: 'running',
                idempotencyKey: 'agent-op-1',
            },
        });
        expect(executeCommand).toHaveBeenCalledTimes(1);

        pending.resolve({ ok: true, data: { id: 1 }, rev: 1 });
    });

    it('marks cancellation as requested and finishes cancelled when the command returns CANCELLED', async () => {
        let commandSignal;
        const executeCommand = vi.fn(
            (name, args, context) =>
                new Promise((resolve) => {
                    commandSignal = context.signal;
                    context.signal.addEventListener('abort', () => {
                        resolve({
                            ok: false,
                            error: {
                                code: 'CANCELLED',
                                message: 'Operation cancelled.',
                            },
                            rev: 0,
                        });
                    });
                })
        );
        const app = buildApi({ executeCommand, context: { projectId, adapter: {} } });

        const started = await app.operation.start({
            command: 'task.create',
            args: { name: 'Cancelled' },
        });
        const cancelled = await app.operation.cancel({ id: started.data.operationId });

        expect(commandSignal.aborted).toBe(true);
        expect(cancelled).toMatchObject({
            ok: true,
            data: {
                status: 'cancel_requested',
                cancelRequested: true,
            },
        });

        await vi.waitFor(async () => {
            await expect(
                app.operation.result({ id: started.data.operationId })
            ).resolves.toMatchObject({
                ok: true,
                data: {
                    status: 'cancelled',
                    result: {
                        ok: false,
                        error: { code: 'CANCELLED' },
                    },
                },
            });
        });

        const next = await app.operation.start({
            command: 'task.create',
            args: { name: 'After cancel' },
        });
        expect(next.ok).toBe(true);
    });

    it('cancels a real batch operation at a dispatch checkpoint and releases the write lock', async () => {
        clearCommandsForTest();
        const firstCommitStarted = deferred();
        const firstCommitDone = deferred();
        const commit = vi.fn((plan) => {
            if (plan.args.name === 'First') {
                firstCommitStarted.resolve();
                return firstCommitDone.promise;
            }
            return { id: 2 };
        });
        registerBatchCreateCommand({ commit });

        const app = buildApi({
            context: {
                projectId,
                gantt: createTransactionalGantt(),
            },
        });

        const started = await app.operation.start({
            command: 'batch',
            steps: [
                { op: 'task.create', args: { name: 'First' } },
                { op: 'task.create', args: { name: 'Second' } },
            ],
        });

        await firstCommitStarted.promise;
        await expect(app.operation.cancel({ id: started.data.operationId })).resolves.toMatchObject(
            {
                ok: true,
                data: { status: 'cancel_requested' },
            }
        );
        firstCommitDone.resolve({ id: 1 });

        await vi.waitFor(async () => {
            await expect(
                app.operation.result({ id: started.data.operationId })
            ).resolves.toMatchObject({
                ok: true,
                data: {
                    status: 'cancelled',
                    result: {
                        ok: false,
                        error: { code: 'CANCELLED' },
                    },
                },
            });
        });
        expect(commit).toHaveBeenCalledTimes(1);

        await expect(
            app.operation.start({
                command: 'batch',
                steps: [{ op: 'task.create', args: { name: 'After cancel' } }],
            })
        ).resolves.toMatchObject({
            ok: true,
            data: { status: 'running' },
        });
    });
});
