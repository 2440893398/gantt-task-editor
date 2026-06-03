// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToast = vi.fn();
const mockStartReplayRecording = vi.fn();

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: () => undefined,
    },
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: mockShowToast,
}));

vi.mock('../../../src/features/feedback/feedbackReplay.js', () => ({
    getFeedbackReplayContext: () => ({
        enabled: false,
        eventCount: 0,
    }),
    startFeedbackReplayRecording: mockStartReplayRecording,
}));

vi.mock('../../../src/features/feedback/feedbackService.js', () => ({
    fileToAttachment: vi.fn(),
    submitFeedback: vi.fn(),
}));

describe('FeedbackDialog', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
        mockShowToast.mockReset();
        mockStartReplayRecording.mockReset();
        mockStartReplayRecording.mockResolvedValue(true);

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
});
