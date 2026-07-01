// @vitest-environment jsdom
/**
 * Task 10 hardening (FIX B) — ONE-undo-per-committed-row under the REAL undoManager.
 *
 * The other convergence tests inject a MOCK undoApi, so they never exercise the real
 * global-hook suppression. In production (src/main.js) the gantt lifecycle hooks call
 * undoManager.saveAddState/saveDeleteState, while the AI apply engine ALSO calls the
 * explicit undoManager.save* helpers. The command undo scope
 * (isCommandUndoScopeActive) is what keeps this from double-recording: while an AI
 * apply runs inside the scope, the hooks suppress, so only the explicit save* calls
 * record — exactly one snapshot per committed row.
 *
 * This test uses the REAL undoManager + REAL runGanttTransaction and a gantt whose
 * add/update/delete fire the same guarded hook logic as production, then asserts the
 * undo stack grew by EXACTLY the number of committed rows (not double, not zero).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Persist is the only side effect we stub; keep the transaction + undoManager REAL.
vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn().mockResolvedValue(undefined),
}));

const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');
const undoManager = (await import('../../../src/features/gantt/history/undoManager.js')).default;
const undoHistory = await import('../../../src/features/gantt/history/undoManager.js');
const { applySelectedChanges, __test__ } =
    await import('../../../src/features/ai/components/DiffConfirmModal.js');
const { normalizeDiffPayload } = __test__;
const { resetProjectRev } = await import('../../../src/features/gantt/domain/rev.js');

const projectId = 'ai-undo-real-test';

/**
 * A gantt whose lifecycle mutations fire the SAME guarded hooks as production
 * (src/main.js): the hooks record undo snapshots only when we are NOT replaying
 * history AND NOT inside a command undo scope. Because applySelectedChanges runs
 * inside a command undo scope, these hooks suppress and the engine's explicit
 * undoManager.save* calls become the single source of truth.
 */
function createHookedGantt(initial = []) {
    const store = new Map(initial.map((task) => [task.id, { ...task }]));
    let seq = 1000;

    const hooksSuppressed = () =>
        undoManager.isApplyingHistoryOperation() || undoManager.isCommandUndoScopeActive();

    const gantt = {
        getTask: (id) => store.get(id) || null,
        isTaskExists: (id) => store.has(id),
        addTask: (data, parent) => {
            const id = data.id ?? `gen-${seq++}`;
            store.set(id, { ...data, id, parent: parent ?? 0 });
            // production onAfterTaskAdd hook
            if (!hooksSuppressed()) {
                undoManager.saveAddState(id);
            }
            return id;
        },
        updateTask: () => {
            // production onAfterTaskUpdate does not record undo (only debouncedSave);
            // the AI engine records update snapshots explicitly via saveState.
        },
        deleteTask: (id) => {
            // production onBeforeTaskDelete hook fires BEFORE removal
            if (!hooksSuppressed()) {
                undoManager.saveDeleteState(id);
            }
            store.delete(id);
        },
        serialize: () => ({ data: [...store.values()], links: [] }),
        clearAll: () => store.clear(),
        parse: (snapshot) => {
            store.clear();
            for (const task of snapshot?.data || []) {
                store.set(task.id, { ...task });
            }
        },
        render: () => {},
    };

    return gantt;
}

describe('AI write convergence — real undoManager one-undo-per-row', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settleAndPersist.mockResolvedValue(undefined);
        undoManager.clearHistory();
        resetProjectRev(projectId);
    });

    afterEach(() => {
        undoManager.clearHistory();
        resetProjectRev(projectId);
        delete global.gantt;
    });

    it('records EXACTLY one undo snapshot per committed row (add + update + delete)', async () => {
        const gantt = createHookedGantt([
            { id: 'u1', text: 'old update', progress: 0.1 },
            { id: 'd1', text: 'to delete' },
        ]);
        // The real undoManager.save* helpers snapshot from the GLOBAL gantt.
        global.gantt = gantt;

        expect(undoManager.getUndoStackSize()).toBe(0);

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                { op: 'add', taskId: 'tmp', data: { id: 'new-1', text: 'new task' } },
                { op: 'update', taskId: 'u1', data: { text: 'new update', progress: 0.5 } },
                { op: 'delete', taskId: 'd1', data: { text: 'to delete' } },
            ],
        });

        // Use the REAL undoManager (default) — do NOT inject a mock undoApi.
        const result = await applySelectedChanges(normalized.flatRows, {
            ganttApi: gantt,
            projectId,
        });

        expect(result.ok).toBe(true);
        expect(result.applied).toEqual({ add: 1, update: 1, delete: 1, skipped: 0, failed: 0 });

        // Three committed rows -> exactly three snapshots. Not 6 (hook + explicit),
        // not 0 (hooks alone suppressed with no explicit calls).
        expect(undoManager.getUndoStackSize()).toBe(3);

        // Scope is balanced after the apply.
        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);
    });

    it('keeps the command undo scope balanced even when settleAndPersist throws', async () => {
        const gantt = createHookedGantt([{ id: 'u1', text: 'x' }]);
        global.gantt = gantt;
        settleAndPersist.mockRejectedValueOnce(new Error('persist boom'));

        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [{ op: 'update', taskId: 'u1', data: { text: 'y' } }],
        });

        const before = undoManager.getUndoStackSize();
        const result = await applySelectedChanges(normalized.flatRows, {
            ganttApi: gantt,
            projectId,
        });

        // settle threw AFTER the row committed -> the real transaction rolls back and
        // restores the history snapshot, so the wrapper reports failure.
        expect(result.ok).toBe(false);
        expect(result.error).toBe('apply_failed');

        // The scope must be balanced (endCommandUndoScope ran in finally) and the
        // rolled-back apply must not leave a net snapshot behind.
        expect(undoHistory.isCommandUndoScopeActive()).toBe(false);
        expect(undoManager.getUndoStackSize()).toBe(before);
    });
});
