import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderSelectHTMLMock = vi.fn((elementId) => `<div id="${elementId}-trigger"></div>`);
const setupSelectMock = vi.fn();
const showToastMock = vi.fn();
const saveStateMock = vi.fn();

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn((key) => {
            if (key === 'duration.format.daysOnly') return '{days} 天';
            if (key === 'duration.format.hoursOnly') return '{hours} 小时';
            if (key === 'duration.format.full') return '{days} 天 {hours} 小时';
            return null;
        })
    },
    default: {
        t: vi.fn((key) => {
            if (key === 'duration.format.daysOnly') return '{days} 天';
            if (key === 'duration.format.hoursOnly') return '{hours} 小时';
            if (key === 'duration.format.full') return '{days} 天 {hours} 小时';
            return null;
        }),
        getLanguage: vi.fn(() => 'zh-CN')
    }
}));

vi.mock('../../../src/core/store.js', () => ({
    state: { customFields: [] },
    isFieldEnabled: vi.fn(() => true),
    getFieldType: vi.fn(() => 'text'),
    getSystemFieldOptions: vi.fn(() => [])
}));

vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        saveState: saveStateMock,
        isApplyingHistoryOperation: vi.fn(() => false)
    }
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: showToastMock
}));

vi.mock('../../../src/utils/dom.js', () => ({
    escapeAttr: vi.fn((v) => String(v ?? ''))
}));

vi.mock('../../../src/components/common/dropdown.js', () => ({
    renderSelectHTML: renderSelectHTMLMock,
    setupSelect: setupSelectMock
}));

describe('right-section schedule mode selector', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';

        global.gantt = {
            hasChild: vi.fn(() => false),
            updateTask: vi.fn(),
            calculateEndDate: vi.fn(() => new Date('2026-03-08')),
            calculateDuration: vi.fn(() => 5)
        };
    });

    it('renders compact selector and normalizes default mode to start_duration', async () => {
        const { renderRightSection } = await import('../../../src/features/task-details/right-section.js');

        const html = renderRightSection({
            id: 1,
            text: 'Task',
            start_date: new Date('2026-03-01'),
            end_date: new Date('2026-03-08'),
            duration: 5,
            progress: 0,
            schedule_mode: 'unexpected'
        });

        expect(html).toContain('task-schedule-mode-trigger');
        expect(renderSelectHTMLMock).toHaveBeenCalledWith(
            'task-schedule-mode',
            'start_duration',
            expect.any(Array),
            expect.objectContaining({
                width: 'w-32'
            })
        );
    });

    it('persists schedule mode changes in non-draft mode', async () => {
        const { bindRightSectionEvents } = await import('../../../src/features/task-details/right-section.js');

        const panel = document.createElement('div');
        const task = {
            id: 7,
            text: 'Task',
            start_date: new Date('2026-03-01'),
            end_date: new Date('2026-03-08'),
            duration: 5,
            progress: 0
        };

        bindRightSectionEvents(panel, task);

        const scheduleModeCall = setupSelectMock.mock.calls.find(([id]) => id === 'task-schedule-mode');
        expect(scheduleModeCall).toBeTruthy();

        const onChange = scheduleModeCall[3];
        onChange('start_end');

        expect(task.schedule_mode).toBe('start_end');
        expect(saveStateMock).toHaveBeenCalledWith(7);
        expect(global.gantt.updateTask).toHaveBeenCalledWith(7);
        expect(showToastMock).toHaveBeenCalled();
    });

    it('updates draft only and normalizes invalid value in draft mode', async () => {
        const { bindRightSectionEvents } = await import('../../../src/features/task-details/right-section.js');

        const panel = document.createElement('div');
        const task = {
            id: 9,
            text: 'Task',
            schedule_mode: 'start_end',
            start_date: new Date('2026-03-01'),
            end_date: new Date('2026-03-08'),
            duration: 5,
            progress: 0
        };
        const draftTask = { ...task };

        bindRightSectionEvents(panel, task, {
            isDraftMode: true,
            draftTask,
            onDraftMutated: (mutator) => mutator(draftTask)
        });

        const scheduleModeCall = setupSelectMock.mock.calls.find(([id]) => id === 'task-schedule-mode');
        expect(scheduleModeCall).toBeTruthy();

        const onChange = scheduleModeCall[3];
        onChange('invalid-mode');

        expect(draftTask.schedule_mode).toBe('start_duration');
        expect(task.schedule_mode).toBe('start_end');
        expect(saveStateMock).not.toHaveBeenCalled();
        expect(global.gantt.updateTask).not.toHaveBeenCalled();
        expect(showToastMock).not.toHaveBeenCalled();
    });
});
