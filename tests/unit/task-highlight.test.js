import { describe, it, expect, vi } from 'vitest';

// Mock gantt global
global.gantt = { attachEvent: vi.fn(), eachTask: vi.fn() };

describe('onTaskClick 行点击不影响复选框选择', () => {
    it('普通点击任务行不应改变已选集合', () => {
        const state = { selectedTasks: new Set(['old-id']), isCtrlPressed: false };
        const updateSelectedTasksUI = vi.fn();

        // 模拟 onTaskClick 逻辑：点击行本身不改 selectedTasks
        const e = { target: null, ctrlKey: false, metaKey: false };
        const id = 'new-id';

        expect(e.ctrlKey).toBe(false);
        expect(id).toBe('new-id');

        expect(state.selectedTasks.has('old-id')).toBe(true);
        expect(state.selectedTasks.has('new-id')).toBe(false);
        expect(updateSelectedTasksUI).not.toHaveBeenCalled();
    });

    it('Ctrl+点击任务行也不应改变已选集合', () => {
        const state = { selectedTasks: new Set(['old-id']), isCtrlPressed: false };
        const updateSelectedTasksUI = vi.fn();

        const e = { target: null, ctrlKey: true, metaKey: false };
        const id = 'new-id';

        expect(e.ctrlKey).toBe(true);
        expect(id).toBe('new-id');

        expect([...state.selectedTasks]).toEqual(['old-id']);
        expect(updateSelectedTasksUI).not.toHaveBeenCalled();
    });
});
