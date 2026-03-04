import { beforeEach, describe, expect, it, vi } from 'vitest';

const showConfirmDialogMock = vi.fn();
const showToastMock = vi.fn();
const saveStateMock = vi.fn();

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(() => null)
    }
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: showToastMock
}));

vi.mock('../../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: showConfirmDialogMock
}));

vi.mock('../../../src/components/rich-text-editor.js', () => ({
    destroyRichTextEditor: vi.fn()
}));

vi.mock('../../../src/features/task-details/left-section.js', () => ({
    renderLeftSection: vi.fn(() => '<div id="left-mock"></div>'),
    bindLeftSectionEvents: vi.fn()
}));

vi.mock('../../../src/features/task-details/right-section.js', () => ({
    renderRightSection: vi.fn(() => '<div id="right-mock"></div>'),
    bindRightSectionEvents: vi.fn()
}));

vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        saveState: saveStateMock,
        isApplyingHistoryOperation: vi.fn(() => false)
    }
}));

describe('task-details panel draft workflow', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        document.body.innerHTML = '';

        const taskStore = {
            1: {
                id: 1,
                text: 'Old title',
                assignee: 'Alice',
                start_date: new Date('2026-03-01'),
                end_date: new Date('2026-03-02'),
                duration: 1,
                progress: 0
            }
        };

        global.gantt = {
            getTask: vi.fn((id) => taskStore[id]),
            updateTask: vi.fn(),
            deleteTask: vi.fn()
        };
    });

    it('does not persist edits before confirm', async () => {
        const panel = await import('../../../src/features/task-details/panel.js');

        panel.openTaskDetailsPanel(1);
        panel.__test__.updateCurrentDraft((draft) => {
            draft.text = 'Draft title';
        });

        expect(global.gantt.updateTask).not.toHaveBeenCalled();
        expect(global.gantt.getTask(1).text).toBe('Old title');
    });

    it('commits draft once when confirm save is clicked', async () => {
        const panel = await import('../../../src/features/task-details/panel.js');

        panel.openTaskDetailsPanel(1);
        panel.__test__.updateCurrentDraft((draft) => {
            draft.text = 'Draft title';
            draft.assignee = 'Bob';
        });

        const confirmBtn = document.querySelector('#btn-confirm-save');
        expect(confirmBtn).toBeTruthy();
        confirmBtn.click();

        expect(saveStateMock).toHaveBeenCalledTimes(1);
        expect(global.gantt.updateTask).toHaveBeenCalledTimes(1);
        expect(global.gantt.getTask(1).text).toBe('Draft title');
        expect(global.gantt.getTask(1).assignee).toBe('Bob');
        expect(showToastMock).toHaveBeenCalled();
    });

    it('shows discard confirmation when closing dirty draft', async () => {
        const panel = await import('../../../src/features/task-details/panel.js');

        panel.openTaskDetailsPanel(1);
        panel.__test__.updateCurrentDraft((draft) => {
            draft.text = 'Unsaved change';
        });

        panel.closeTaskDetailsPanel();

        expect(showConfirmDialogMock).toHaveBeenCalledTimes(1);
        const args = showConfirmDialogMock.mock.calls[0][0];
        expect(args.title).toContain('放弃');
        expect(document.getElementById('task-details-overlay')).toBeTruthy();

        args.onConfirm();
        vi.runAllTimers();
        expect(document.getElementById('task-details-overlay')).toBeNull();
    });
});
