// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToast = vi.fn();
const mockStartReplayRecording = vi.fn();
const mockStopReplayRecording = vi.fn();
const mockSubmitFeedback = vi.fn();
let mockReplayEnabled = false;

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: (key) => {
            const values = {
                'feedback.typeBug': 'Bug',
                'feedback.typeImprovement': 'Optimization',
                'feedback.typeRequirement': 'Requirement',
                'feedback.typeOther': 'Other',
                'feedback.typeUnclear': 'Not sure',
            };
            return values[key];
        },
    },
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: mockShowToast,
}));

vi.mock('../../../src/features/feedback/feedbackReplay.js', () => ({
    getFeedbackReplayContext: () => ({
        enabled: mockReplayEnabled,
        eventCount: 0,
    }),
    onFeedbackReplayStateChange: (listener) => {
        listener({ enabled: mockReplayEnabled, eventCount: 0 });
        return vi.fn();
    },
    startFeedbackReplayRecording: mockStartReplayRecording,
    stopFeedbackReplayRecording: mockStopReplayRecording,
}));

vi.mock('../../../src/features/feedback/feedbackService.js', () => ({
    fileToAttachment: vi.fn(),
    submitFeedback: mockSubmitFeedback,
}));

describe('FeedbackDialog', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
        mockShowToast.mockReset();
        mockReplayEnabled = false;
        mockStartReplayRecording.mockReset();
        mockStartReplayRecording.mockResolvedValue(true);
        mockStopReplayRecording.mockReset();
        mockStopReplayRecording.mockImplementation(() => {
            mockReplayEnabled = false;
            return true;
        });
        mockSubmitFeedback.mockReset();
        mockSubmitFeedback.mockResolvedValue({ key: 'feedback:1' });

        HTMLDialogElement.prototype.showModal = vi.fn(function () {
            this.open = true;
        });
        HTMLDialogElement.prototype.close = vi.fn(function () {
            this.open = false;
        });

        vi.stubGlobal('requestAnimationFrame', (callback) => {
            callback();
            return 1;
        });
    });

    it('shows visible confirmation when replay recording starts', async () => {
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');

        openFeedbackDialog();

        document.getElementById('feedback-start-replay-btn').click();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockStartReplayRecording).toHaveBeenCalledTimes(1);
        expect(mockShowToast).toHaveBeenCalledWith(
            '\u590d\u73b0\u5f55\u5236\u5df2\u5f00\u59cb',
            'success',
            4000
        );
    });

    it('renders business type options and submits the selected type', async () => {
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');

        openFeedbackDialog();

        const typeSelect = document.getElementById('feedback-type');
        const labels = Array.from(typeSelect.options).map((option) => option.textContent);
        expect(labels).toEqual(['Not sure', 'Bug', 'Optimization', 'Requirement', 'Other']);

        typeSelect.value = 'requirement';
        document.getElementById('feedback-title').value = 'Approval flow';
        document.getElementById('feedback-description').value = 'Need an approval step.';
        document.getElementById('feedback-form').dispatchEvent(new Event('submit'));
        await Promise.resolve();

        expect(mockSubmitFeedback).toHaveBeenCalledWith(
            expect.objectContaining({
                submittedType: 'requirement',
                title: 'Approval flow',
                description: 'Need an approval step.',
            })
        );
    });

    it('keeps draft fields after starting and finishing replay recording', async () => {
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');
        const { initFeedbackToolbarControl } =
            await import('../../../src/features/feedback/FeedbackToolbarControl.js');

        document.body.innerHTML = '<button id="feedback-btn" type="button"></button>';
        initFeedbackToolbarControl(openFeedbackDialog);
        mockStartReplayRecording.mockImplementation(async () => {
            mockReplayEnabled = true;
            return true;
        });
        openFeedbackDialog();

        document.getElementById('feedback-type').value = 'improvement';
        document.getElementById('feedback-title').value = 'Replay draft';
        document.getElementById('feedback-description').value = 'Steps before recording';
        document.getElementById('feedback-contact').value = 'user@example.com';

        document.getElementById('feedback-start-replay-btn').click();
        await Promise.resolve();
        await Promise.resolve();

        document.getElementById('feedback-btn').click();

        expect(document.getElementById('feedback-type').value).toBe('improvement');
        expect(document.getElementById('feedback-title').value).toBe('Replay draft');
        expect(document.getElementById('feedback-description').value).toBe(
            'Steps before recording'
        );
        expect(document.getElementById('feedback-contact').value).toBe('user@example.com');
    });

    it('allows title-only submissions by reusing title as description fallback', async () => {
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');

        openFeedbackDialog();

        document.getElementById('feedback-title').value = 'Small issue summary';
        document.getElementById('feedback-description').value = '';
        document.getElementById('feedback-form').dispatchEvent(new Event('submit'));
        await Promise.resolve();

        expect(mockSubmitFeedback).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Small issue summary',
                description: 'Small issue summary',
            })
        );
    });
});
