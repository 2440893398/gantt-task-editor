import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';
import { registerSessionCommands } from '../../../src/features/agent-cli/commands/session.js';
import {
    dispatch,
    clearIdempotencyCacheForTest,
} from '../../../src/features/agent-cli/runtime/dispatch.js';
import { clearCommandLog, getCommandLog } from '../../../src/features/agent-cli/runtime/log.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';
import { fail } from '../../../src/features/agent-cli/runtime/result.js';
import { DEFAULT_PROJECT_ID } from '../../../src/core/storage.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const { runGanttTransaction } = await import('../../../src/features/gantt/domain/transaction.js');
const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');
const undoHistory = await import('../../../src/features/gantt/history/undoManager.js');

const projectId = 'dispatch-write-test';

function registerWriteCommand({ commit = vi.fn(() => ({ id: 1 })) } = {}) {
    const plan = vi.fn(() => ({
        diff: {
            created: [{ id: 1, text: 'Created' }],
            updated: [],
            deleted: [],
            links: { added: [], removed: [] },
        },
    }));

    defineCommand({
        name: 'task.create',
        summary: 'Create task',
        params: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                dryRun: { type: 'boolean' },
                idempotencyKey: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        op: { plan, commit },
    });

    return { plan, commit };
}

function createGantt(tasks = []) {
    const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));

    return {
        addTask: vi.fn((task, parent) => {
            const id = task.id ?? Math.max(0, ...taskMap.keys()) + 1;
            taskMap.set(id, { ...task, id, parent: parent ?? task.parent ?? 0 });
            return id;
        }),
        deleteTask: vi.fn((id) => {
            const deleteIds = [id];
            for (const deleteId of deleteIds) {
                const childIds = [...taskMap.values()]
                    .filter((task) => task.parent === deleteId)
                    .map((task) => task.id);
                deleteIds.push(...childIds);
                taskMap.delete(deleteId);
            }
        }),
        getTask: vi.fn((id) => {
            const task = taskMap.get(id);
            if (!task) {
                throw new Error('Task not found');
            }
            return task;
        }),
        getChildren: vi.fn((id) =>
            [...taskMap.values()].filter((task) => task.parent === id).map((task) => task.id)
        ),
        hasTask: (id) => taskMap.has(id),
        getTaskSnapshot: (id) => taskMap.get(id),
        updateTask: vi.fn(),
    };
}

describe('agent dispatch write commands', () => {
    beforeEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        clearIdempotencyCacheForTest();
        resetProjectRev(projectId);
        resetProjectRev(DEFAULT_PROJECT_ID);
        resetProjectRev('default');
        vi.clearAllMocks();
    });

    afterEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        clearIdempotencyCacheForTest();
        resetProjectRev(projectId);
        resetProjectRev(DEFAULT_PROJECT_ID);
        resetProjectRev('default');
        delete globalThis.gantt;
    });

    it('returns a dry-run diff without transaction or persistence', async () => {
        const command = registerWriteCommand();

        const result = await dispatch(
            'task.create',
            { name: 'Created', dryRun: true },
            {
                projectId,
                gantt: {},
            }
        );

        expect(result).toEqual({
            ok: true,
            data: {
                diff: {
                    created: [{ id: 1, text: 'Created' }],
                    updated: [],
                    deleted: [],
                    links: { added: [], removed: [] },
                },
            },
            rev: 0,
        });
        expect(command.commit).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('bumps project rev once after a successful write', async () => {
        registerWriteCommand();

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(result).toMatchObject({
            ok: true,
            data: { diff: { created: [{ id: 1, text: 'Created' }] } },
            rev: 1,
        });
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('returns commit data from single command writes so callers can use new ids', async () => {
        registerWriteCommand({
            commit: vi.fn(() => ({ id: 99, task: { id: 99, text: 'Created' } })),
        });

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(result).toMatchObject({
            ok: true,
            data: {
                id: 99,
                task: { id: 99, text: 'Created' },
                diff: {
                    created: [{ id: 1, text: 'Created' }],
                },
            },
            rev: 1,
        });
    });

    it('uses DEFAULT_PROJECT_ID instead of a literal default bucket when context omits projectId', async () => {
        registerWriteCommand();

        const result = await dispatch('task.create', { name: 'Created' }, { gantt: {} });

        expect(result.rev).toBe(1);
        expect(getProjectRev(DEFAULT_PROJECT_ID)).toBe(1);
        expect(getProjectRev('default')).toBe(0);
    });

    it('rolls back failed writes and does not bump rev', async () => {
        registerWriteCommand({
            commit: vi.fn(() => {
                throw new Error('commit failed');
            }),
        });
        runGanttTransaction.mockImplementationOnce(async ({ work }) => {
            try {
                await work();
                return { ok: true, data: null };
            } catch (error) {
                return { ok: false, error };
            }
        });

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'EXEC_ERROR',
                message: 'commit failed',
            },
            rev: 0,
        });
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('treats commit failure results as failures without settling or bumping rev', async () => {
        registerWriteCommand({
            commit: vi.fn(() => fail('BAD_ARGS', 'Commit rejected')),
        });

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Commit rejected',
                nextAction: {
                    command: 'help',
                    args: { command: 'task.create' },
                    reason: 'Read the command parameter contract.',
                },
            },
            rev: 0,
        });
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
        expect(getCommandLog({ limit: 1 })).toEqual([
            expect.objectContaining({
                name: 'task.create',
                ok: false,
                rev: 0,
            }),
        ]);
    });

    it('rolls back when settle and persist fails after commit', async () => {
        const command = registerWriteCommand();
        let transactionCaughtError = false;
        settleAndPersist.mockRejectedValueOnce(new Error('persist failed'));
        runGanttTransaction.mockImplementationOnce(async ({ work }) => {
            try {
                await work();
                return { ok: true, data: null };
            } catch (error) {
                transactionCaughtError = true;
                return { ok: false, error };
            }
        });

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(command.commit).toHaveBeenCalledTimes(1);
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            ok: false,
            error: {
                code: 'EXEC_ERROR',
                message: 'persist failed',
            },
            rev: 0,
        });
        expect(transactionCaughtError).toBe(true);
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('treats same-value task updates as no-ops without commit, settle, or rev bump', async () => {
        registerTaskCommands();
        const gantt = createGantt([{ id: 4, text: 'Same name', duration: 2 }]);

        const result = await dispatch(
            'task.update',
            { id: 4, values: { text: 'Same name' } },
            { projectId, gantt }
        );

        expect(result).toEqual({
            ok: true,
            data: {
                diff: {
                    created: [],
                    updated: [],
                    deleted: [],
                    links: { added: [], removed: [] },
                },
            },
            rev: 0,
        });
        expect(gantt.updateTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('treats same-value date-only task updates as no-ops without commit, settle, or rev bump', async () => {
        registerTaskCommands();
        const gantt = createGantt([
            {
                id: 4,
                text: 'Same date',
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);

        const result = await dispatch(
            'task.update',
            { id: 4, values: { start_date: '2026-07-01', end_date: '2026-07-02' } },
            { projectId, gantt }
        );

        expect(result).toEqual({
            ok: true,
            data: {
                diff: {
                    created: [],
                    updated: [],
                    deleted: [],
                    links: { added: [], removed: [] },
                },
            },
            rev: 0,
        });
        expect(gantt.updateTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('commits changed task updates through transaction and persistence', async () => {
        registerTaskCommands();
        const gantt = createGantt([{ id: 4, text: 'Old name', duration: 2 }]);
        globalThis.gantt = gantt;

        const result = await dispatch(
            'task.update',
            { id: 4, values: { text: 'New name' } },
            { projectId, gantt }
        );

        expect(result).toMatchObject({
            ok: true,
            data: {
                diff: {
                    updated: [
                        {
                            id: 4,
                            fields: {
                                text: { old: 'Old name', new: 'New name' },
                            },
                        },
                    ],
                },
            },
            rev: 1,
        });
        expect(gantt.updateTask).toHaveBeenCalledWith(4);
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('commits changed date-only task updates through transaction and persistence', async () => {
        registerTaskCommands();
        const gantt = createGantt([{ id: 4, text: 'Old date', start_date: new Date(2026, 6, 1) }]);
        globalThis.gantt = gantt;

        const result = await dispatch(
            'task.update',
            { id: 4, values: { start_date: '2026-07-02' } },
            { projectId, gantt }
        );

        expect(result).toMatchObject({
            ok: true,
            data: {
                diff: {
                    updated: [
                        {
                            id: 4,
                            fields: {
                                start_date: {
                                    old: new Date(2026, 6, 1).toISOString(),
                                    new: new Date(2026, 6, 2),
                                },
                            },
                        },
                    ],
                },
            },
            rev: 1,
        });
        expect(gantt.updateTask).toHaveBeenCalledWith(4);
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('rejects invalid task.create dates during dry-run planning', async () => {
        registerTaskCommands();
        const gantt = createGantt();

        const result = await dispatch(
            'task.create',
            {
                values: { text: 'Invalid date', assignee: 'Ada', start_date: '2026-02-31' },
                dryRun: true,
            },
            { projectId, gantt }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'INVALID_FIELD_VALUE',
                field: 'start_date',
                message: 'start_date must use YYYY-MM-DD',
            },
            rev: 0,
        });
        expect(gantt.addTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('rejects invalid task.create dates before real execution opens a transaction', async () => {
        registerTaskCommands();
        const gantt = createGantt();

        const result = await dispatch(
            'task.create',
            { values: { text: 'Invalid date', assignee: 'Ada', start_date: '2026-02-31' } },
            { projectId, gantt }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'INVALID_FIELD_VALUE',
                field: 'start_date',
                message: 'start_date must use YYYY-MM-DD',
            },
            rev: 0,
        });
        expect(gantt.addTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('rejects invalid task.update dates during planning without transaction or rev bump', async () => {
        registerTaskCommands();
        const gantt = createGantt([{ id: 4, text: 'Invalid update' }]);

        const result = await dispatch(
            'task.update',
            { id: 4, values: { start_date: '2026-02-31' } },
            { projectId, gantt }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'INVALID_FIELD_VALUE',
                field: 'start_date',
                message: 'start_date must use YYYY-MM-DD',
            },
            rev: 0,
        });
        expect(gantt.updateTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('restores a deleted task subtree with one session undo', async () => {
        registerTaskCommands();
        registerSessionCommands();
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Child A', parent: 1 },
            { id: 3, text: 'Child B', parent: 1 },
            { id: 4, text: 'Grandchild', parent: 2 },
        ]);
        globalThis.gantt = gantt;

        const deleteResult = await dispatch('task.delete', { id: 1 }, { projectId, gantt });

        expect(deleteResult).toMatchObject({
            ok: true,
            data: {
                id: 1,
                deletedIds: [1, 2, 4, 3],
                diff: {
                    created: [],
                    updated: [],
                    deleted: [
                        { id: 1, text: 'Parent', parent: 0 },
                        { id: 2, text: 'Child A', parent: 1 },
                        { id: 4, text: 'Grandchild', parent: 2 },
                        { id: 3, text: 'Child B', parent: 1 },
                    ],
                    links: { added: [], removed: [] },
                },
            },
            rev: 1,
        });
        expect([1, 2, 3, 4].map((id) => gantt.hasTask(id))).toEqual([false, false, false, false]);

        await expect(dispatch('session.undo', {}, { projectId, gantt })).resolves.toEqual({
            ok: true,
            data: { undone: true },
            rev: 2,
        });

        expect(gantt.getTaskSnapshot(1)).toEqual({ id: 1, text: 'Parent', parent: 0 });
        expect(gantt.getTaskSnapshot(2)).toEqual({ id: 2, text: 'Child A', parent: 1 });
        expect(gantt.getTaskSnapshot(3)).toEqual({ id: 3, text: 'Child B', parent: 1 });
        expect(gantt.getTaskSnapshot(4)).toEqual({ id: 4, text: 'Grandchild', parent: 2 });
        expect(
            gantt.addTask.mock.calls.slice(-4).map(([task, parent]) => [task.id, parent])
        ).toEqual([
            [1, 0],
            [2, 1],
            [4, 2],
            [3, 1],
        ]);
    });

    it('returns conflict before opening a transaction when ifRev mismatches', async () => {
        const command = registerWriteCommand();

        const result = await dispatch(
            'task.create',
            { name: 'Created' },
            {
                projectId,
                gantt: {},
                ifRev: 3,
            }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'CONFLICT',
                message: 'Project revision changed.',
                hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
            },
            rev: 0,
        });
        expect(command.plan).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('logs mutating validation failures without transaction, persistence, or rev bump', async () => {
        const command = registerWriteCommand();

        const result = await dispatch(
            'task.create',
            { name: 'Created', unexpected: 'value' },
            { projectId, gantt: {} }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Unknown argument: unexpected',
                hint: 'Remove --unexpected.',
                nextAction: {
                    command: 'help',
                    args: { command: 'task.create' },
                    reason: 'Read the command parameter contract.',
                },
            },
            rev: 0,
        });
        expect(command.plan).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
        expect(getCommandLog({ limit: 1 })).toEqual([
            expect.objectContaining({
                name: 'task.create',
                args: { name: 'Created', unexpected: 'value' },
                ok: false,
                rev: 0,
                ms: expect.any(Number),
            }),
        ]);
    });

    it('accepts an idempotencyKey on task.create and commits the write', async () => {
        registerWriteCommand();

        const result = await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'create-1' },
            { projectId, gantt: {} }
        );

        expect(result).toMatchObject({ ok: true, rev: 1 });
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('replays the cached result for a repeated idempotencyKey without re-committing', async () => {
        const command = registerWriteCommand();

        const first = await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'create-1' },
            { projectId, gantt: {} }
        );
        const second = await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'create-1' },
            { projectId, gantt: {} }
        );

        // Same result object, but the write engine ran exactly once.
        expect(second).toEqual(first);
        expect(command.commit).toHaveBeenCalledTimes(1);
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        // The retry does NOT bump the project rev a second time.
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('scopes idempotency keys per project so different keys still execute', async () => {
        const command = registerWriteCommand();

        await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'key-a' },
            { projectId, gantt: {} }
        );
        await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'key-b' },
            { projectId, gantt: {} }
        );

        expect(command.commit).toHaveBeenCalledTimes(2);
        expect(getProjectRev(projectId)).toBe(2);
    });

    it('accepts idempotencyKey supplied via dispatch context', async () => {
        const command = registerWriteCommand();

        const first = await dispatch(
            'task.create',
            { name: 'Created' },
            { projectId, gantt: {}, idempotencyKey: 'ctx-1' }
        );
        const second = await dispatch(
            'task.create',
            { name: 'Created' },
            { projectId, gantt: {}, idempotencyKey: 'ctx-1' }
        );

        expect(second).toEqual(first);
        expect(command.commit).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('does not cache dry-run previews under an idempotencyKey', async () => {
        const command = registerWriteCommand();

        const preview = await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'dry-1', dryRun: true },
            { projectId, gantt: {} }
        );
        expect(preview.ok).toBe(true);
        expect(command.commit).not.toHaveBeenCalled();

        // A later real write with the same key must still execute (dry-run did not claim it).
        const real = await dispatch(
            'task.create',
            { name: 'Created', idempotencyKey: 'dry-1' },
            { projectId, gantt: {} }
        );
        expect(real.ok).toBe(true);
        expect(command.commit).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('returns conflict before planning task updates when ifRev mismatches', async () => {
        registerTaskCommands();
        const gantt = createGantt([]);

        const result = await dispatch(
            'task.update',
            { id: 404, values: { text: 'Stale update' } },
            {
                projectId,
                gantt,
                ifRev: 9,
            }
        );

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'CONFLICT',
                message: 'Project revision changed.',
                hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
            },
            rev: 0,
        });
        expect(gantt.getTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
    });

    it('activates command undo scope only while committing transaction work', async () => {
        registerWriteCommand({
            commit: vi.fn(() => {
                expect(undoHistory.isCommandUndoScopeActive()).toBe(true);
                return { id: 1 };
            }),
        });

        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(result.ok).toBe(true);
        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);
    });

    it('cleans up command undo scope when commit throws', async () => {
        registerWriteCommand({
            commit: vi.fn(() => {
                expect(undoHistory.isCommandUndoScopeActive()).toBe(true);
                throw new Error('commit failed');
            }),
        });
        runGanttTransaction.mockImplementationOnce(async ({ work }) => {
            try {
                await work();
                return { ok: true, data: null };
            } catch (error) {
                return { ok: false, error };
            }
        });

        const result = await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(result.ok).toBe(false);
        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);
    });

    it('records command log entries with command outcome metadata', async () => {
        registerWriteCommand();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-30T00:00:00Z'));

        await dispatch('task.create', { name: 'Created' }, { projectId, gantt: {} });

        expect(getCommandLog({ limit: 1 })).toEqual([
            expect.objectContaining({
                seq: 1,
                ts: '2026-06-30T00:00:00.000Z',
                name: 'task.create',
                args: { name: 'Created' },
                ok: true,
                rev: 1,
                ms: expect.any(Number),
            }),
        ]);

        vi.useRealTimers();
    });

    it('clones command log args so later nested mutations do not change entries', async () => {
        defineCommand({
            name: 'task.nested',
            summary: 'Nested args',
            params: {
                type: 'object',
                properties: {
                    payload: {},
                },
                additionalProperties: false,
            },
            mutating: true,
            op: {
                plan: vi.fn(() => ({
                    diff: {
                        created: [],
                        updated: [],
                        deleted: [],
                        links: { added: [], removed: [] },
                    },
                })),
                commit: vi.fn(() => ({ id: 1 })),
            },
        });
        const args = { payload: { nested: { value: 'before' } } };

        await dispatch('task.nested', args, { projectId, gantt: {} });
        args.payload.nested.value = 'after';

        expect(getCommandLog({ limit: 1 })[0].args).toEqual({
            payload: { nested: { value: 'before' } },
        });
    });
});
