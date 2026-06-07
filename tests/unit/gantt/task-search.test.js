import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    bindTaskSearchInput,
    clearTaskSearchVisibility,
    getTaskSearchClass,
    isTaskVisibleForSearch,
    updateTaskSearchVisibility,
} from '../../../src/features/gantt/task-search.js';

describe('task search filter', () => {
    let tasks;
    let ganttApi;

    beforeEach(() => {
        clearTaskSearchVisibility();
        tasks = [
            { id: 1, text: '目标转移-目标设置' },
            { id: 2, text: '经营指标分析' },
        ];
        ganttApi = {
            eachTask: vi.fn((callback) => tasks.forEach(callback)),
            refreshData: vi.fn(),
            render: vi.fn(),
        };
    });

    it('marks non-matching task ids hidden without mutating task data', () => {
        updateTaskSearchVisibility(ganttApi, '目标');

        expect(getTaskSearchClass(tasks[0])).toBe('');
        expect(getTaskSearchClass(tasks[1])).toBe('gantt-task-search-hidden');
        expect(isTaskVisibleForSearch(tasks[0])).toBe(true);
        expect(isTaskVisibleForSearch(tasks[1])).toBe(false);
        expect(tasks[0]).not.toHaveProperty('$searchHidden');
        expect(tasks[1]).not.toHaveProperty('$searchHidden');
        expect(ganttApi.refreshData).toHaveBeenCalledTimes(1);
        expect(ganttApi.render).not.toHaveBeenCalled();
    });

    it('keeps non-matching ancestors visible when a descendant matches', () => {
        const parent = { id: 10, text: '父级阶段', parent: 0 };
        const child = { id: 11, text: '目标任务', parent: 10 };
        tasks = [parent, child];
        ganttApi.eachTask = vi.fn((callback) => tasks.forEach(callback));
        ganttApi.getTask = vi.fn((id) => tasks.find((task) => String(task.id) === String(id)));

        updateTaskSearchVisibility(ganttApi, '目标');

        expect(isTaskVisibleForSearch(parent)).toBe(true);
        expect(isTaskVisibleForSearch(child)).toBe(true);
        expect(getTaskSearchClass(parent)).toBe('');
    });

    it('clears hidden markers for an empty query', () => {
        updateTaskSearchVisibility(ganttApi, '目标');

        updateTaskSearchVisibility(ganttApi, '   ');

        expect(getTaskSearchClass(tasks[0])).toBe('');
        expect(getTaskSearchClass(tasks[1])).toBe('');
    });

    it('falls back to render when refreshData is unavailable', () => {
        ganttApi.refreshData = undefined;

        updateTaskSearchVisibility(ganttApi, '目标');

        expect(ganttApi.render).toHaveBeenCalledTimes(1);
    });

    it('returns the hidden class used by gantt row and task templates', () => {
        updateTaskSearchVisibility(ganttApi, '经营');

        expect(getTaskSearchClass(tasks[0])).toBe('gantt-task-search-hidden');
        expect(getTaskSearchClass(tasks[1])).toBe('');
    });

    it('binds the input event to task visibility updates', () => {
        const input = document.createElement('input');
        bindTaskSearchInput(input, ganttApi);

        input.value = '经营';
        input.dispatchEvent(new Event('input'));

        expect(getTaskSearchClass(tasks[0])).toBe('gantt-task-search-hidden');
        expect(getTaskSearchClass(tasks[1])).toBe('');
    });
});
