// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockShowToast = vi.fn();
const mockStartReplayRecording = vi.fn();
const mockStopReplayRecording = vi.fn();
const mockSubmitFeedback = vi.fn();
let mockReplayEnabled = false;
let mockReplayEventCount = 0;

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
        eventCount: mockReplayEventCount,
    }),
    onFeedbackReplayStateChange: (listener) => {
        listener({ enabled: mockReplayEnabled, eventCount: mockReplayEventCount });
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

    it('[SCN-FWB-019] keeps the owner link visible so follow-ups stay on the same Issue', async () => {
        mockSubmitFeedback.mockResolvedValue({
            key: 'feedback:1',
            ownerUrl: 'https://worker.test/feedback#issue=feedback%3A1&capability=owner-token',
        });
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');

        openFeedbackDialog();
        document.getElementById('feedback-title').value = 'One Issue only';
        document.getElementById('feedback-form').dispatchEvent(new Event('submit'));
        await Promise.resolve();
        await Promise.resolve();

        const modal = document.getElementById('feedback-dialog-modal');
        const ownerLink = document.getElementById('feedback-owner-link');
        expect(modal.open).toBe(true);
        expect(document.getElementById('feedback-form')).toBeNull();
        expect(ownerLink.href).toBe(
            'https://worker.test/feedback#issue=feedback%3A1&capability=owner-token'
        );
        expect(ownerLink.textContent).toContain('查看处理进度');
    });

    it('[SCN-FWB-007] ignores a second submit while the first feedback request is pending', async () => {
        let finishSubmit;
        mockSubmitFeedback.mockReturnValue(
            new Promise((resolve) => {
                finishSubmit = resolve;
            })
        );
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');

        openFeedbackDialog();
        document.getElementById('feedback-title').value = 'Do not duplicate';
        const form = document.getElementById('feedback-form');
        form.dispatchEvent(new Event('submit'));
        form.dispatchEvent(new Event('submit'));
        await Promise.resolve();

        expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);

        finishSubmit({
            ownerUrl: 'https://worker.test/feedback#issue=feedback%3A1&capability=owner-token',
        });
        await Promise.resolve();
        await Promise.resolve();
    });
});

/**
 * [SCN-FWB-049] 附件闸与监听器生命周期（代码评审 2026-09-02 §4.6/§4.7）。
 */
describe('[SCN-FWB-049] 附件上限与 paste 监听器', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
        mockShowToast.mockReset();
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

    /** addFiles 是逐个 await 的循环；微任务刷一次不够，直接让出宏任务。 */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    function pasteFiles(count) {
        const files = Array.from({ length: count }, (_, index) => ({
            name: `paste-${index}.png`,
            size: 1024,
            type: 'image/png',
        }));
        const event = new Event('paste', { bubbles: true });
        event.clipboardData = { files };
        document.getElementById('feedback-form').dispatchEvent(event);
        return event;
    }

    it('[§4.6] 反复打开对话框不会累加 paste 监听器', async () => {
        // 坏行为：监听器挂在复用的 modal 上，打开 N 次就挂 N 个——粘一次图触发
        // N 次 FileReader，且每个旧处理器都握着自己那份含 base64 的附件数组与
        // 已被 innerHTML 重建掉的节点，谁都回收不了。
        let calls = 0;
        const fileToAttachment = vi.fn(async (file) => {
            calls += 1;
            return { name: file.name, type: file.type, size: file.size, dataUrl: 'data:,' };
        });
        const { openFeedbackDialog } = await (async () => {
            vi.doMock('../../../src/features/feedback/feedbackService.js', () => ({
                fileToAttachment,
                submitFeedback: mockSubmitFeedback,
            }));
            return import('../../../src/features/feedback/FeedbackDialog.js');
        })();

        openFeedbackDialog();
        openFeedbackDialog();
        openFeedbackDialog();

        pasteFiles(1);
        await flush();

        expect(calls).toBe(1);
    });

    it('[§4.7] 附件数量超过 5 个时拒绝并说明，而不是攒成一个必被 413 的请求', async () => {
        const fileToAttachment = vi.fn(async (file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: 'data:,',
        }));
        vi.doMock('../../../src/features/feedback/feedbackService.js', () => ({
            fileToAttachment,
            submitFeedback: mockSubmitFeedback,
        }));
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');
        openFeedbackDialog();

        pasteFiles(7);
        await flush();

        expect(fileToAttachment).toHaveBeenCalledTimes(5);
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('5'), 'error');
    });

    it('[§中-2] 有录像在缓冲时用户附件上限降为 4——录像要占一个服务端名额', async () => {
        // 坏行为画像：数量闸只闸用户附件。5 图 + 录像 = 6 > 服务端上限 5，
        // 整单 400，且最认真复现（又录像又贴满图）的用户必败。
        mockReplayEventCount = 12;
        const fileToAttachment = vi.fn(async (file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: 'data:,',
        }));
        vi.doMock('../../../src/features/feedback/feedbackService.js', () => ({
            fileToAttachment,
            submitFeedback: mockSubmitFeedback,
        }));
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');
        openFeedbackDialog();

        try {
            pasteFiles(5);
            await flush();
        } finally {
            mockReplayEventCount = 0;
        }

        expect(fileToAttachment).toHaveBeenCalledTimes(4);
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('4'), 'error');
    });

    it('[§4.7] 附件总量超过 8MB 时拒绝——单文件 4MB 的闸拦不住六张 3.9MB', async () => {
        const fileToAttachment = vi.fn(async (file) => ({
            name: file.name,
            type: file.type,
            size: 3.9 * 1024 * 1024,
            dataUrl: 'data:,',
        }));
        vi.doMock('../../../src/features/feedback/feedbackService.js', () => ({
            fileToAttachment,
            submitFeedback: mockSubmitFeedback,
        }));
        const { openFeedbackDialog } =
            await import('../../../src/features/feedback/FeedbackDialog.js');
        openFeedbackDialog();

        pasteFiles(4);
        await flush();

        // 3.9 + 3.9 = 7.8MB 放得下，第三张就超 8MB。
        expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('8MB'), 'error');
    });
});
