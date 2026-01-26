
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import undoManager, {
    saveState,
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoStackSize,
    getRedoStackSize,
    clearHistory
} from '../../../../src/features/ai/services/undoManager.js';

// Mock global gantt
const mockTask = {
    id: '1',
    text: 'Original Task',
    start_date: new Date('2024-01-01'),
    end_date: new Date('2024-01-05'),
    duration: 5,
    progress: 0.5,
    priority: 'medium',
    status: 'in_progress',
    assignee: 'John',
    summary: 'Task summary',
    parent: 0,
    open: true
};

let currentTaskState = { ...mockTask };

global.gantt = {
    getTask: vi.fn((id) => {
        if (id === mockTask.id) {
            return currentTaskState;
        }
        return null;
    }),
    updateTask: vi.fn()
};

describe('UndoManager (F-201)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHistory();
        // Reset task state
        currentTaskState = {
            id: '1',
            text: 'Original Task',
            start_date: new Date('2024-01-01'),
            end_date: new Date('2024-01-05'),
            duration: 5,
            progress: 0.5,
            priority: 'medium',
            status: 'in_progress',
            assignee: 'John',
            summary: 'Task summary',
            parent: 0,
            open: true
        };
    });

    describe('saveState', () => {
        it('should save task state to undo stack', () => {
            expect(getUndoStackSize()).toBe(0);

            const result = saveState('1');

            expect(result).toBe(true);
            expect(getUndoStackSize()).toBe(1);
            expect(canUndo()).toBe(true);
        });

        it('should return false if taskId is missing', () => {
            const result = saveState(null);
            expect(result).toBe(false);
            expect(getUndoStackSize()).toBe(0);
        });

        it('should return false if task not found', () => {
            const result = saveState('nonexistent');
            expect(result).toBe(false);
            expect(getUndoStackSize()).toBe(0);
        });

        it('should clear redo stack when new state is saved', () => {
            // Setup: save state, then undo to populate redo stack
            saveState('1');
            currentTaskState.text = 'Modified';
            undo();
            expect(canRedo()).toBe(true);

            // Save new state should clear redo stack
            saveState('1');
            expect(canRedo()).toBe(false);
        });

        it('should limit undo stack to 50 entries', () => {
            // Save 55 states
            for (let i = 0; i < 55; i++) {
                currentTaskState.text = `Task ${i}`;
                saveState('1');
            }

            expect(getUndoStackSize()).toBe(50);
        });
    });

    describe('undo', () => {
        it('should restore previous task state', () => {
            // Save original state
            saveState('1');

            // Modify task
            currentTaskState.text = 'Modified Task';

            // Undo
            const result = undo();

            expect(result).toBe(true);
            expect(currentTaskState.text).toBe('Original Task');
            expect(gantt.updateTask).toHaveBeenCalledWith('1');
        });

        it('should return false if nothing to undo', () => {
            const result = undo();
            expect(result).toBe(false);
        });

        it('should push current state to redo stack', () => {
            saveState('1');
            currentTaskState.text = 'Modified';

            expect(canRedo()).toBe(false);

            undo();

            expect(canRedo()).toBe(true);
            expect(getRedoStackSize()).toBe(1);
        });

        it('should restore all task properties', () => {
            saveState('1');

            // Modify multiple properties
            currentTaskState.text = 'New Text';
            currentTaskState.progress = 1.0;
            currentTaskState.priority = 'high';
            currentTaskState.status = 'completed';
            currentTaskState.assignee = 'Jane';

            undo();

            expect(currentTaskState.text).toBe('Original Task');
            expect(currentTaskState.progress).toBe(0.5);
            expect(currentTaskState.priority).toBe('medium');
            expect(currentTaskState.status).toBe('in_progress');
            expect(currentTaskState.assignee).toBe('John');
        });
    });

    describe('redo', () => {
        it('should restore undone state', () => {
            saveState('1');
            const modifiedText = 'Modified Task';
            currentTaskState.text = modifiedText;

            undo();
            expect(currentTaskState.text).toBe('Original Task');

            const result = redo();

            expect(result).toBe(true);
            expect(currentTaskState.text).toBe(modifiedText);
            expect(gantt.updateTask).toHaveBeenCalledWith('1');
        });

        it('should return false if nothing to redo', () => {
            const result = redo();
            expect(result).toBe(false);
        });

        it('should push current state back to undo stack', () => {
            saveState('1');
            currentTaskState.text = 'Modified';
            undo();

            expect(getUndoStackSize()).toBe(0);

            redo();

            expect(getUndoStackSize()).toBe(1);
        });
    });

    describe('multiple undo/redo operations', () => {
        it('should support consecutive undo operations', () => {
            // Save state 1
            saveState('1');
            currentTaskState.text = 'Change 1';

            // Save state 2
            saveState('1');
            currentTaskState.text = 'Change 2';

            // Save state 3
            saveState('1');
            currentTaskState.text = 'Change 3';

            expect(getUndoStackSize()).toBe(3);

            // Undo to Change 2
            undo();
            expect(currentTaskState.text).toBe('Change 2');

            // Undo to Change 1
            undo();
            expect(currentTaskState.text).toBe('Change 1');

            // Undo to Original
            undo();
            expect(currentTaskState.text).toBe('Original Task');

            expect(getUndoStackSize()).toBe(0);
            expect(getRedoStackSize()).toBe(3);
        });

        it('should support consecutive redo operations', () => {
            saveState('1');
            currentTaskState.text = 'Change 1';

            saveState('1');
            currentTaskState.text = 'Change 2';

            // Undo all
            undo();
            undo();

            // Redo
            redo();
            expect(currentTaskState.text).toBe('Change 1');

            redo();
            expect(currentTaskState.text).toBe('Change 2');
        });

        it('should handle interleaved undo/redo correctly', () => {
            saveState('1');
            currentTaskState.text = 'Change 1';

            saveState('1');
            currentTaskState.text = 'Change 2';

            // Undo once
            undo();
            expect(currentTaskState.text).toBe('Change 1');

            // Redo
            redo();
            expect(currentTaskState.text).toBe('Change 2');

            // Undo again
            undo();
            expect(currentTaskState.text).toBe('Change 1');
        });
    });

    describe('canUndo/canRedo', () => {
        it('should return false initially', () => {
            expect(canUndo()).toBe(false);
            expect(canRedo()).toBe(false);
        });

        it('should return true after saveState', () => {
            saveState('1');
            expect(canUndo()).toBe(true);
            expect(canRedo()).toBe(false);
        });

        it('should update correctly after undo', () => {
            saveState('1');
            undo();
            expect(canUndo()).toBe(false);
            expect(canRedo()).toBe(true);
        });

        it('should update correctly after redo', () => {
            saveState('1');
            undo();
            redo();
            expect(canUndo()).toBe(true);
            expect(canRedo()).toBe(false);
        });
    });

    describe('clearHistory', () => {
        it('should clear both undo and redo stacks', () => {
            // Save multiple states to have items in undo stack
            saveState('1');
            currentTaskState.text = 'Change 1';
            saveState('1');
            currentTaskState.text = 'Change 2';

            // Undo once to have items in both stacks
            undo();

            // Now we should have 1 in undo stack and 1 in redo stack
            expect(getUndoStackSize()).toBe(1);
            expect(getRedoStackSize()).toBe(1);

            clearHistory();

            expect(getUndoStackSize()).toBe(0);
            expect(getRedoStackSize()).toBe(0);
            expect(canUndo()).toBe(false);
            expect(canRedo()).toBe(false);
        });
    });

    describe('date handling', () => {
        it('should properly serialize and restore dates', () => {
            const originalDate = new Date('2024-01-01');
            currentTaskState.start_date = originalDate;

            saveState('1');

            currentTaskState.start_date = new Date('2024-06-01');

            undo();

            expect(currentTaskState.start_date).toBeInstanceOf(Date);
            expect(currentTaskState.start_date.getTime()).toBe(originalDate.getTime());
        });
    });

    describe('default export', () => {
        it('should expose all methods', () => {
            expect(undoManager.saveState).toBeDefined();
            expect(undoManager.undo).toBeDefined();
            expect(undoManager.redo).toBeDefined();
            expect(undoManager.canUndo).toBeDefined();
            expect(undoManager.canRedo).toBeDefined();
            expect(undoManager.getUndoStackSize).toBeDefined();
            expect(undoManager.getRedoStackSize).toBeDefined();
            expect(undoManager.clearHistory).toBeDefined();
        });
    });
});
