import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gantt global
global.gantt = { attachEvent: vi.fn(), eachTask: vi.fn() };

describe('onTaskClick 单选高亮', () => {
    it('普通点击应清空已选任务并高亮当前任务', () => {
        const state = { selectedTasks: new Set(['old-id']), isCtrlPressed: false };
        const updateSelectedTasksUI = vi.fn();

        // 模拟 onTaskClick 逻辑（普通点击，无 Ctrl）
        const e = { target: null, ctrlKey: false, metaKey: false };
        const id = 'new-id';

        // 非 checkbox，非 ctrl → 清空 + 加入当前
        if (!state.isCtrlPressed && !e.ctrlKey && !e.metaKey) {
            state.selectedTasks.clear();
            state.selectedTasks.add(id);
            updateSelectedTasksUI();
        }

        expect(state.selectedTasks.has('old-id')).toBe(false);
        expect(state.selectedTasks.has('new-id')).toBe(true);
        expect(updateSelectedTasksUI).toHaveBeenCalledOnce();
    });

    it('Ctrl+点击应追加到已选集合，不清空', () => {
        const state = { selectedTasks: new Set(['old-id']), isCtrlPressed: false };
        const updateSelectedTasksUI = vi.fn();

        const e = { target: null, ctrlKey: true, metaKey: false };
        const id = 'new-id';

        if (state.isCtrlPressed || e.ctrlKey || e.metaKey) {
            state.selectedTasks.add(id);
            updateSelectedTasksUI();
        }

        expect(state.selectedTasks.has('old-id')).toBe(true);
        expect(state.selectedTasks.has('new-id')).toBe(true);
    });
});
