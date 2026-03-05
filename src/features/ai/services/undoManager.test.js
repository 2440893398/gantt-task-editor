// src/features/ai/services/undoManager.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTaskStore = {};
globalThis.gantt = {
  isTaskExists: (id) => !!mockTaskStore[id],
  getTask: (id) => mockTaskStore[id] ?? null,
  updateTask: vi.fn(),
  addTask: vi.fn((data, parent) => { mockTaskStore[data.id] = { ...data, parent }; return data.id; }),
  deleteTask: vi.fn((id) => { delete mockTaskStore[id]; }),
};

beforeEach(() => {
  Object.keys(mockTaskStore).forEach(k => delete mockTaskStore[k]);
  gantt.updateTask.mockClear();
  gantt.addTask.mockClear();
  gantt.deleteTask.mockClear();
  // reset module state between tests by reimporting won't work easily,
  // so call clearHistory each time
});

describe('undoManager – extended ops', () => {
  it('saveAddState + undo removes the task', async () => {
    const um = await import('./undoManager.js');
    um.clearHistory();
    mockTaskStore[99] = { id: 99, text: 'New', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-05'), duration: 3 };
    um.saveAddState(99);
    expect(um.canUndo()).toBe(true);
    um.undo();
    expect(gantt.deleteTask).toHaveBeenCalledWith(99);
  });

  it('saveDeleteState + undo re-adds the task', async () => {
    const um = await import('./undoManager.js');
    um.clearHistory();
    mockTaskStore[5] = { id: 5, text: 'Old', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-03'), duration: 2, parent: 0 };
    um.saveDeleteState(5);
    delete mockTaskStore[5];
    um.undo();
    expect(gantt.addTask).toHaveBeenCalled();
  });

  it('saveState (update) + undo restores fields and calls updateTask', async () => {
    const um = await import('./undoManager.js');
    um.clearHistory();
    mockTaskStore[1] = { id: 1, text: 'Before', start_date: new Date('2024-01-01'), end_date: new Date('2024-01-05'), duration: 4, progress: 0, status: 'pending', assignee: 'A', priority: 'low', summary: '', parent: 0, open: true };
    um.saveState(1);
    mockTaskStore[1].text = 'After';
    um.undo();
    expect(gantt.updateTask).toHaveBeenCalledWith(1);
    expect(mockTaskStore[1].text).toBe('Before');
  });
});
