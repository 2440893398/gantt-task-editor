// @vitest-environment jsdom
/**
 * Task 10 — AI write convergence.
 *
 * These tests assert that the AI write paths (DiffConfirmModal.applySelectedChanges
 * and aiService.applyToTask) route through the SHARED command/domain pipeline so that
 * AI writes gain the same transaction + persistence + rev-bump + undo-scope semantics
 * as the agent command layer, WHILE preserving the existing public shapes and the
 * partial-apply (per-row error collection) behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Shared-pipeline primitives are mocked so we can assert AI routes through them. ---
vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn().mockResolvedValue(undefined),
}));

// aiService pulls in a heavy UI/client graph; stub it so we can import the module.
vi.mock('../../../src/core/store.js', () => ({ checkAiConfigured: vi.fn(() => true) }));
vi.mock('../../../src/features/ai/api/client.js', () => ({
    runAgentStream: vi.fn(),
    runSmartChat: vi.fn(),
}));
vi.mock('../../../src/features/ai/prompts/agentRegistry.js', () => ({
    getAgent: vi.fn(),
    getAgentName: vi.fn(),
}));
vi.mock('../../../src/features/ai/components/AiDrawer.js', () => ({ default: {} }));
vi.mock('../../../src/features/ai/components/AiConfigModal.js', () => ({
    openAiConfigModal: vi.fn(),
}));
vi.mock('../../../src/features/ai/services/errorHandler.js', () => ({ handleAiError: vi.fn() }));
vi.mock('../../../src/utils/i18n.js', () => ({ i18n: { t: (k) => k } }));
vi.mock('../../../src/utils/toast.js', () => ({ showToast: vi.fn() }));

const { runGanttTransaction } = await import('../../../src/features/gantt/domain/transaction.js');
const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');
const { getProjectRev, resetProjectRev } =
    await import('../../../src/features/gantt/domain/rev.js');
const undoHistory = await import('../../../src/features/gantt/history/undoManager.js');

const { applySelectedChanges, __test__ } =
    await import('../../../src/features/ai/components/DiffConfirmModal.js');
const { normalizeDiffPayload } = __test__;

function createGanttMock(taskStore) {
    return {
        getTask: vi.fn((id) => taskStore[id] || null),
        isTaskExists: vi.fn((id) => Boolean(taskStore[id])),
        addTask: vi.fn((data, parent) => {
            const id = data.id || `new-${Object.keys(taskStore).length}`;
            taskStore[id] = { ...data, id, parent };
            return id;
        }),
        updateTask: vi.fn((id) => id),
        deleteTask: vi.fn((id) => {
            delete taskStore[id];
        }),
        serialize: vi.fn(() => ({ data: Object.values(taskStore) })),
        clearAll: vi.fn(),
        parse: vi.fn(),
        render: vi.fn(),
    };
}

const undoManagerMock = () => ({
    saveAddState: vi.fn(),
    saveState: vi.fn(),
    saveDeleteState: vi.fn(),
});

const projectId = 'ai-convergence-test';

describe('AI write convergence — applySelectedChanges', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetProjectRev(projectId);
        // re-arm default mock impls cleared by clearAllMocks
        runGanttTransaction.mockImplementation(async ({ work }) => ({
            ok: true,
            data: await work(),
        }));
        settleAndPersist.mockResolvedValue(undefined);
    });

    afterEach(() => {
        resetProjectRev(projectId);
    });

    it('wraps the whole apply in ONE transaction, settles once, and bumps rev once', async () => {
        const taskStore = {
            u1: { id: 'u1', text: '旧标题', progress: 0.1 },
            d1: { id: 'd1', text: '删除项' },
        };
        const ganttMock = createGanttMock(taskStore);
        const undoApi = undoManagerMock();

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                { op: 'add', taskId: 'tmp', data: { id: 'new-parent', text: '新任务' } },
                { op: 'update', taskId: 'u1', data: { text: '新标题', progress: 0.4 } },
                { op: 'delete', taskId: 'd1', data: { text: '删除项' } },
            ],
        });

        const result = await applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi,
            projectId,
        });

        // Behavior/shape preserved.
        expect(result.ok).toBe(true);
        expect(result.applied).toEqual({ add: 1, update: 1, delete: 1, skipped: 0, failed: 0 });
        expect(Array.isArray(result.errors)).toBe(true);

        // Routed through the shared pipeline exactly once.
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'ai', projectId })
        );
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('preserves the {ok, applied, errors} shape and partial-apply on a per-row failure', async () => {
        const taskStore = {
            u1: { id: 'u1', text: 'ok row' },
            bad: { id: 'bad', text: 'bad row' },
        };
        const ganttMock = createGanttMock(taskStore);
        // Make ONE row throw; the rest must still apply (partial-apply preserved).
        ganttMock.updateTask.mockImplementation((id) => {
            if (id === 'bad') {
                throw new Error('boom');
            }
            return id;
        });
        const undoApi = undoManagerMock();

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                { op: 'update', taskId: 'u1', data: { text: 'new ok' } },
                { op: 'update', taskId: 'bad', data: { text: 'new bad' } },
            ],
        });

        const result = await applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi,
            projectId,
        });

        // One bad row does NOT abort the rest: partial-apply, not all-or-nothing.
        expect(result.applied).toEqual({ add: 0, update: 1, delete: 0, skipped: 0, failed: 1 });
        expect(result.ok).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ nodeId: expect.any(String) });

        // A per-row failure is NOT an unexpected throw: the transaction still commits
        // the good rows, so we still settle + bump rev once.
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('does not settle or bump rev when there is nothing to apply', async () => {
        const result = await applySelectedChanges([], { projectId });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('empty_rows');
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('does not settle or bump rev when gantt is unavailable', async () => {
        const result = await applySelectedChanges(
            [{ nodeId: 'n', op: 'update', data: {}, include: true, level: 0, index: 0 }],
            { ganttApi: {}, projectId }
        );

        expect(result.ok).toBe(false);
        expect(result.error).toBe('gantt_unavailable');
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('opens a command undo scope while committing rows (same scoping as command layer)', async () => {
        const taskStore = { u1: { id: 'u1', text: 'x' } };
        const ganttMock = createGanttMock(taskStore);
        ganttMock.updateTask.mockImplementation((id) => {
            // While a row is being committed, the shared command undo scope must be active.
            expect(undoHistory.isCommandUndoScopeActive()).toBe(true);
            return id;
        });

        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [{ op: 'update', taskId: 'u1', data: { text: 'y' } }],
        });

        await applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi: undoManagerMock(),
            projectId,
        });

        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);
    });

    it('maps a transaction rollback to {ok:false, error:"apply_failed"} without bumping rev', async () => {
        const taskStore = { u1: { id: 'u1', text: 'x' } };
        const ganttMock = createGanttMock(taskStore);
        const undoApi = undoManagerMock();

        // Simulate the transaction wrapper rolling back on an unexpected throw.
        const boom = new Error('boom');
        runGanttTransaction.mockImplementationOnce(async ({ work }) => {
            // Still run work so applied/errors are populated, but report rollback.
            try {
                await work();
            } catch {
                /* ignore: we are forcing the rollback branch */
            }
            return { ok: false, error: boom };
        });

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [{ op: 'update', taskId: 'u1', data: { text: 'y' } }],
        });

        const before = getProjectRev(projectId);
        const result = await applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi,
            projectId,
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('apply_failed');
        // applied/errors from the (rolled-back) attempt are surfaced, not swallowed.
        expect(result.applied).toMatchObject({ update: 1 });
        expect(Array.isArray(result.errors)).toBe(true);
        // A rollback must NOT bump the shared project rev.
        expect(getProjectRev(projectId)).toBe(before);
    });

    it('surfaces the rollback error when work committed no errors of its own', async () => {
        const ganttMock = createGanttMock({ u1: { id: 'u1', text: 'x' } });

        // Force the rollback branch WITHOUT running work, so outcome.errors is empty
        // and the wrapper must synthesize an error entry from txResult.error.
        const boom = new Error('settle exploded');
        runGanttTransaction.mockImplementationOnce(async () => ({ ok: false, error: boom }));

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [{ op: 'update', taskId: 'u1', data: { text: 'y' } }],
        });

        const before = getProjectRev(projectId);
        const result = await applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi: undoManagerMock(),
            projectId,
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('apply_failed');
        expect(result.errors).toEqual([{ nodeId: null, error: boom }]);
        expect(getProjectRev(projectId)).toBe(before);
    });
});

describe('AI write convergence — applyToTask', () => {
    let applyToTask;

    beforeEach(async () => {
        vi.clearAllMocks();
        resetProjectRev('default');
        settleAndPersist.mockResolvedValue(undefined);
        ({ applyToTask } = await import('../../../src/features/ai/services/aiService.js'));
    });

    afterEach(() => {
        resetProjectRev('default');
        delete global.gantt;
    });

    it('keeps the synchronous boolean contract and mutates + updates the task', () => {
        const updateTask = vi.fn();
        const task = { id: '1', text: 'Old' };
        global.gantt = {
            getTask: vi.fn(() => task),
            updateTask,
        };

        const result = applyToTask('1', 'New');

        // Public contract preserved: SYNCHRONOUS true, task mutated, updateTask called.
        expect(result).toBe(true);
        expect(task.text).toBe('New');
        expect(updateTask).toHaveBeenCalledWith('1');
    });

    it('bumps the project rev so AI text edits become visible to state.rev/ifRev', () => {
        global.gantt = { getTask: vi.fn(() => ({ id: '1', text: 'Old' })), updateTask: vi.fn() };

        const before = getProjectRev('default');
        applyToTask('1', 'New');
        expect(getProjectRev('default')).toBe(before + 1);
    });

    it('schedules settle+persist with source:"ai" (fire-and-forget) after the edit', async () => {
        global.gantt = { getTask: vi.fn(() => ({ id: '1', text: 'Old' })), updateTask: vi.fn() };

        applyToTask('1', 'New');
        // settle is fire-and-forget; allow the microtask to flush.
        await Promise.resolve();
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledWith(expect.objectContaining({ source: 'ai' }));
    });

    it('does not bump rev or settle when the task is missing', () => {
        global.gantt = { getTask: vi.fn(() => null), updateTask: vi.fn() };

        const before = getProjectRev('default');
        const result = applyToTask('missing', 'New');

        expect(result).toBe(false);
        expect(getProjectRev('default')).toBe(before);
        expect(settleAndPersist).not.toHaveBeenCalled();
    });
});

describe('AI write convergence — read tool shape unchanged', () => {
    it('keeps a representative read tool shape identical after convergence', async () => {
        const { allTools } = await import('../../../src/features/ai/tools/registry.js');

        // The read-only ai/tools/* are NOT converged; their shape must stay identical.
        const tool = allTools.get_today_tasks;
        expect(tool).toBeDefined();
        expect(tool).toHaveProperty('description');
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).toHaveProperty('execute');
        expect(typeof tool.execute).toBe('function');
    });
});
