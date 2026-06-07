import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ASSIGNEE_FOCUS_DIMMED_CLASS,
    ASSIGNEE_FOCUS_MATCH_CLASS,
    ASSIGNEE_FOCUS_ONLY_MODE,
    ASSIGNEE_FOCUS_TAGGED_CLASS,
    applyAssigneeFocus,
    collectAssigneeOptions,
    getAssigneeFocusClass,
    initAssigneeFocusControl,
    isTaskVisibleForAssigneeFocus,
    matchesAssigneeFocus,
    normalizeAssigneeNames,
    renderAssigneeFocusLabel,
} from '../../../src/features/gantt/assignee-focus.js';

describe('assignee focus helpers', () => {
    beforeEach(() => {
        applyAssigneeFocus({ assignee: '', mode: 'dim' }, { render: vi.fn() });
    });

    it('normalizes assignee values from strings arrays and separated text', () => {
        expect(normalizeAssigneeNames(' 张三 / 李四, 王五；张三 ')).toEqual([
            '张三',
            '李四',
            '王五',
        ]);
        expect(normalizeAssigneeNames(['Alice', ' Bob ', '', 'Alice'])).toEqual(['Alice', 'Bob']);
    });

    it('collects unique assignees and keeps unassigned tasks explicit', () => {
        const options = collectAssigneeOptions([
            { assignee: '张三/李四' },
            { assignee: ['王五', '张三'] },
            { assignee: '' },
        ]);

        expect(options).toEqual(['张三', '李四', '王五']);
    });

    it('matches all unassigned single assignee and multi assignee tasks', () => {
        expect(matchesAssigneeFocus({ assignee: 'all' }, { assignee: '张三' })).toBe(true);
        expect(matchesAssigneeFocus({ assignee: '__unassigned__' }, { assignee: '' })).toBe(true);
        expect(matchesAssigneeFocus({ assignee: '李四' }, { assignee: '张三/李四' })).toBe(true);
        expect(matchesAssigneeFocus({ assignee: '赵六' }, { assignee: '张三/李四' })).toBe(false);
    });

    it('dims non matching tasks in dim mode and filters them in only mode', () => {
        const focusedTask = { assignee: '张三' };
        const otherTask = { assignee: '李四' };

        expect(getAssigneeFocusClass(focusedTask, { assignee: '张三', mode: 'dim' })).toContain(
            ASSIGNEE_FOCUS_MATCH_CLASS
        );
        expect(getAssigneeFocusClass(otherTask, { assignee: '张三', mode: 'dim' })).toContain(
            ASSIGNEE_FOCUS_DIMMED_CLASS
        );
        expect(isTaskVisibleForAssigneeFocus(otherTask, { assignee: '张三', mode: 'only' })).toBe(
            false
        );
    });

    it('keeps parent context visible in only mode when a child matches focused assignee', () => {
        const parentTask = { id: 1, assignee: '' };
        const matchingChildTask = { id: 2, assignee: '张三' };
        const unrelatedParentTask = { id: 3, assignee: '' };
        const ganttApi = {
            getChildren: vi.fn((id) => (id === 1 ? [2] : [])),
            getTask: vi.fn((id) => (id === 2 ? matchingChildTask : null)),
        };
        const focus = { assignee: '张三', mode: 'only' };

        expect(isTaskVisibleForAssigneeFocus(parentTask, focus, ganttApi)).toBe(true);
        expect(isTaskVisibleForAssigneeFocus(unrelatedParentTask, focus, ganttApi)).toBe(false);
    });

    it('does not treat missing child records as unassigned descendants', () => {
        const parentTask = { id: 1, assignee: '李四' };
        const ganttApi = {
            getChildren: vi.fn(() => [2]),
            getTask: vi.fn(() => null),
        };

        expect(
            isTaskVisibleForAssigneeFocus(
                parentTask,
                { assignee: '__unassigned__', mode: 'only' },
                ganttApi
            )
        ).toBe(false);
    });

    it('renders escaped compact assignee labels with overflow count', () => {
        const html = renderAssigneeFocusLabel({
            assignee: ['张三<script>', '李四', '王五'],
        });

        expect(html).toContain(ASSIGNEE_FOCUS_TAGGED_CLASS);
        expect(html).toContain('张三&lt;script&gt;');
        expect(html).toContain('+2');
        expect(html).not.toContain('<script>');
    });

    it('initializes toolbar control from current gantt tasks and refreshes on change', () => {
        const container = document.createElement('div');
        const ganttApi = {
            serialize: vi.fn(() => ({
                data: [{ assignee: '张三' }, { assignee: '李四/王五' }, { assignee: '' }],
            })),
            refreshData: vi.fn(),
            render: vi.fn(),
        };

        initAssigneeFocusControl(container, ganttApi);

        const select = container.querySelector('[data-assignee-focus-select]');
        expect([...select.options].map((option) => option.value)).toEqual([
            'all',
            '__unassigned__',
            '张三',
            '李四',
            '王五',
        ]);

        select.value = '李四';
        select.dispatchEvent(new Event('change', { bubbles: true }));

        expect(ganttApi.refreshData).toHaveBeenCalledTimes(1);
        expect(matchesAssigneeFocus(undefined, { assignee: '李四/王五' })).toBe(true);
    });

    it('switches between dim and only modes from toolbar buttons', () => {
        const container = document.createElement('div');
        const ganttApi = {
            serialize: vi.fn(() => ({ data: [{ assignee: '张三' }] })),
            refreshData: vi.fn(),
        };

        initAssigneeFocusControl(container, ganttApi);

        container.querySelector('[data-assignee-focus-select]').value = '张三';
        container
            .querySelector('[data-assignee-focus-select]')
            .dispatchEvent(new Event('change', { bubbles: true }));
        container.querySelector(`[data-assignee-focus-mode="${ASSIGNEE_FOCUS_ONLY_MODE}"]`).click();

        expect(isTaskVisibleForAssigneeFocus({ assignee: '李四' })).toBe(false);
        expect(isTaskVisibleForAssigneeFocus({ assignee: '张三' })).toBe(true);
        expect(ganttApi.refreshData).toHaveBeenCalled();
    });
});
