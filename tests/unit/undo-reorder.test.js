import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gantt global
const mockTasks = {
    'task1': { id: 'task1', parent: 0, $index: 0 },
    'task2': { id: 'task2', parent: 0, $index: 1 },
    'task3': { id: 'task3', parent: 'task1', $index: 0 },
};
global.gantt = {
    getTask: vi.fn((id) => mockTasks[id]),
    updateTask: vi.fn(),  // _applyReorderSnapshot sets task props then calls updateTask
    moveTask: vi.fn(),
    render: vi.fn(),
    eachTask: vi.fn(),
};

describe('UndoManager reorder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('saveReorderState 应能压入 reorder 快照', async () => {
        const { saveReorderState, canUndo, getUndoStackSize, clearHistory } = await import('../../src/features/ai/services/undoManager.js');
        clearHistory();

        const before = [{ id: 'task1', parent: 0, sortorder: 0 }];
        const after  = [{ id: 'task1', parent: 0, sortorder: 1 }];

        const result = saveReorderState(before, after);

        expect(result).toBe(true);
        expect(canUndo()).toBe(true);
        expect(getUndoStackSize()).toBe(1);
    });

    it('saveReorderState 对无效参数应返回 false', async () => {
        const { saveReorderState, clearHistory } = await import('../../src/features/ai/services/undoManager.js');
        clearHistory();

        expect(saveReorderState(null, [])).toBe(false);
        expect(saveReorderState([], null)).toBe(false);
        expect(saveReorderState('bad', [])).toBe(false);
    });

    it('undo reorder 应调用 gantt.updateTask 恢复 before 状态并 render', async () => {
        const { saveReorderState, undo, clearHistory } = await import('../../src/features/ai/services/undoManager.js');
        clearHistory();

        const before = [{ id: 'task1', parent: 0, sortorder: 0 }];
        const after  = [{ id: 'task1', parent: 'task2', sortorder: 1 }];
        saveReorderState(before, after);

        const result = undo();

        expect(result).toBe(true);
        // _applyReorderSnapshot sets task.parent/sortorder directly then calls gantt.updateTask
        expect(gantt.updateTask).toHaveBeenCalledWith('task1');
        expect(gantt.render).toHaveBeenCalled();
    });

    it('redo reorder 应调用 gantt.updateTask 恢复 after 状态并 render', async () => {
        const { saveReorderState, undo, redo, clearHistory, canRedo } = await import('../../src/features/ai/services/undoManager.js');
        clearHistory();

        const before = [{ id: 'task1', parent: 0, sortorder: 0 }];
        const after  = [{ id: 'task1', parent: 'task2', sortorder: 1 }];
        saveReorderState(before, after);

        undo(); // 先撤销，把 snapshot 推入 redo 栈
        vi.clearAllMocks();

        expect(canRedo()).toBe(true);
        const result = redo();

        expect(result).toBe(true);
        expect(gantt.updateTask).toHaveBeenCalledWith('task1');
        expect(gantt.render).toHaveBeenCalled();
    });

    it('undo reorder 后 canRedo 应为 true', async () => {
        const { saveReorderState, undo, canRedo, clearHistory } = await import('../../src/features/ai/services/undoManager.js');
        clearHistory();

        const before = [{ id: 'task1', parent: 0, sortorder: 0 }];
        const after  = [{ id: 'task1', parent: 0, sortorder: 1 }];
        saveReorderState(before, after);

        undo();

        expect(canRedo()).toBe(true);
    });
});
