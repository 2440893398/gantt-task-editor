import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: vi.fn(() => null) }
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../../../src/components/rich-text-editor.js', () => ({
    initRichTextEditor: vi.fn(),
    getEditorInstance: vi.fn(),
    getEditorText: vi.fn(),
    onContentChange: vi.fn(),
    setEditorContent: vi.fn(),
    markdownToHtml: vi.fn((text) => text)
}));

vi.mock('../../../src/features/ai/services/aiService.js', () => ({
    default: { invokeAgent: vi.fn() }
}));

vi.mock('../../../src/features/task-details/panel.js', () => ({
    refreshTaskDetailsPanel: vi.fn()
}));

describe('left-section subtasks normalization and apply', () => {
    beforeEach(() => {
        vi.resetModules();
        global.gantt = {
            hasChild: vi.fn(() => true),
            getChildren: vi.fn(() => ['s1', 's2']),
            deleteTask: vi.fn(),
            addTask: vi.fn(),
            getTask: vi.fn((id) => ({ id, text: id })),
            updateTask: vi.fn(),
            calculateEndDate: vi.fn(() => new Date('2026-02-10'))
        };
    });

    it('keeps description field when normalizing subtasks', async () => {
        const mod = await import('../../../src/features/task-details/left-section.js');
        const { normalizeSubtasks } = mod.__test__;

        const result = normalizeSubtasks({
            type: 'task_split',
            subtasks: [
                {
                    text: '拆分任务A',
                    description: '详细说明A',
                    duration: 2
                }
            ]
        });

        expect(result).toEqual([
            expect.objectContaining({
                text: '拆分任务A',
                description: '详细说明A',
                duration: 2
            })
        ]);
    });

    it('replaces existing subtasks before adding new ones', async () => {
        const mod = await import('../../../src/features/task-details/left-section.js');
        const { createSubtasks } = mod.__test__;

        createSubtasks(
            { id: 'parent-1', start_date: new Date('2026-02-01') },
            [
                { text: '新子任务1', description: '描述1', duration: 2 },
                { text: '新子任务2', description: '描述2', duration: 1 }
            ]
        );

        expect(global.gantt.deleteTask).toHaveBeenCalledTimes(2);
        expect(global.gantt.deleteTask).toHaveBeenNthCalledWith(1, 's1');
        expect(global.gantt.deleteTask).toHaveBeenNthCalledWith(2, 's2');
        expect(global.gantt.addTask).toHaveBeenCalledTimes(2);
        expect(global.gantt.addTask).toHaveBeenCalledWith(expect.objectContaining({
            parent: 'parent-1',
            text: '新子任务1',
            description: '描述1'
        }));
    });
});
