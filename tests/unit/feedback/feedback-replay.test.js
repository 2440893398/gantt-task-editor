// @vitest-environment jsdom
/**
 * [SCN-FWB-049] rrweb 回放缓冲：裁剪不得裁掉快照，提交后不得留着旧录像。
 *
 * 这两条是同一个交付物的两面（代码评审 2026-09-02 §4.1/§4.2）：
 * - 回放是反馈组件唯一的核心产出，一个「打开是黑屏」的附件等于没录；
 * - 录像是用户在一次提交里授权上传的东西，不该跟着后面每一次静默上报再传一遍。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const META = 4;
const FULL_SNAPSHOT = 2;
const INCREMENTAL = 3;

/** 一次 checkout 的头两条事件：Meta（带 isCheckout）+ FullSnapshot。 */
function feedCheckout(record, at) {
    record({ type: META, timestamp: at, data: { href: 'http://localhost/#/demo' } }, true);
    record({ type: FULL_SNAPSHOT, timestamp: at + 1, data: { node: { id: 1 } } }, false);
}

function feedIncrementals(record, count, at, payload = 'x') {
    for (let index = 0; index < count; index += 1) {
        record({ type: INCREMENTAL, timestamp: at + index, data: { source: 2, payload } }, false);
    }
}

describe('[SCN-FWB-049] 回放缓冲按 segment 裁剪', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('高频操作打满事件预算后，缓冲仍以 FullSnapshot 开头且可播', async () => {
        // 坏行为画像：旧实现把缓冲当平坦数组，超过 300 条就从头 splice。甘特图上拖拽
        // 几秒就能产生几百条增量事件，窗口起点随之落进增量事件中段——Replayer 没有
        // 快照可挂载，预览黑屏、上传的 JSON 也放不出来。
        const { recordFeedbackReplayEvent, getFeedbackReplayPreview, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');

        feedCheckout(recordFeedbackReplayEvent, 1000);
        feedIncrementals(recordFeedbackReplayEvent, 500, 1002);

        const preview = getFeedbackReplayPreview();
        expect(preview.events[0].type).toBe(META);
        expect(preview.events[1].type).toBe(FULL_SNAPSHOT);
        expect(preview.playable).toBe(true);
        expect(getFeedbackReplayContext().playable).toBe(true);
    });

    it('多段时整段丢弃最旧的，留下的那段仍从快照开头，并如实报告丢了几段', async () => {
        const { recordFeedbackReplayEvent, getFeedbackReplayPreview } =
            await import('../../../src/features/feedback/feedbackReplay.js');

        for (let segment = 0; segment < 5; segment += 1) {
            feedCheckout(recordFeedbackReplayEvent, 1000 + segment * 1000);
            feedIncrementals(recordFeedbackReplayEvent, 100, 1002 + segment * 1000);
        }

        const preview = getFeedbackReplayPreview();
        expect(preview.events[0].type).toBe(META);
        expect(preview.playable).toBe(true);
        // 300 条上限：整段丢弃后剩下的是最近的几段，而不是「最后 300 条」。
        expect(preview.eventCount).toBeLessThanOrEqual(306);
        expect(preview.droppedSegments).toBeGreaterThan(0);
    });

    it('字节预算超限时同样按段丢，绝不从段中间截断', async () => {
        const { recordFeedbackReplayEvent, createFeedbackReplayAttachment } =
            await import('../../../src/features/feedback/feedbackReplay.js');

        // 每段约 1.2MB，三段合计超过 2.5MB 的附件预算。
        const bulky = 'y'.repeat(600 * 1024);
        for (let segment = 0; segment < 3; segment += 1) {
            feedCheckout(recordFeedbackReplayEvent, 1000 + segment * 1000);
            feedIncrementals(recordFeedbackReplayEvent, 2, 1002 + segment * 1000, bulky);
        }

        const attachment = await createFeedbackReplayAttachment();
        expect(attachment).not.toBeNull();
        const payload = JSON.parse(
            Buffer.from(attachment.dataUrl.split(',')[1], 'base64').toString('utf8')
        );
        expect(payload.playable).toBe(true);
        expect(payload.events[0].type).toBe(META);
        expect(payload.droppedSegments).toBeGreaterThan(0);
        expect(attachment.size).toBeLessThanOrEqual(2.5 * 1024 * 1024);
    });

    it('没有快照的缓冲如实标记为不可播——不假装它能放', async () => {
        const { recordFeedbackReplayEvent, getFeedbackReplayPreview } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        feedIncrementals(recordFeedbackReplayEvent, 5, 1000);
        expect(getFeedbackReplayPreview().playable).toBe(false);
    });

    it('清空缓冲后计数归零', async () => {
        const { recordFeedbackReplayEvent, clearFeedbackReplayBuffer, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');

        feedCheckout(recordFeedbackReplayEvent, 1000);
        feedIncrementals(recordFeedbackReplayEvent, 10, 1002);
        expect(getFeedbackReplayContext().eventCount).toBe(12);

        clearFeedbackReplayBuffer();
        expect(getFeedbackReplayContext().eventCount).toBe(0);
        expect(getFeedbackReplayContext().droppedSegments).toBe(0);
    });
});

describe('[SCN-FWB-049] 录制接线：段边界由 rrweb 的 isCheckout 划', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('record 选项里按事件数 checkout，且 emit 直接接到缓冲上', async () => {
        // 声明性断言挡不住「参数没接上」：这里把 rrweb 换成桩，验证真的传了
        // checkoutEveryNth，并且拿到的 emit 回调认得 isCheckout。
        const captured = {};
        vi.doMock('@rrweb/record', () => ({
            record: (options) => {
                captured.options = options;
                return () => {};
            },
        }));

        const {
            startFeedbackReplayRecording,
            getFeedbackReplayPreview,
            stopFeedbackReplayRecording,
        } = await import('../../../src/features/feedback/feedbackReplay.js');

        expect(await startFeedbackReplayRecording()).toBe(true);
        expect(captured.options.checkoutEveryNth).toBe(100);
        expect(captured.options.checkoutEveryNms).toBe(60 * 1000);
        expect(captured.options.maskAllInputs).toBe(true);

        feedCheckout(captured.options.emit, 1000);
        feedIncrementals(captured.options.emit, 3, 1002);
        feedCheckout(captured.options.emit, 2000);
        const preview = getFeedbackReplayPreview();
        // 第二次 checkout 开了新段：两段共 4 + 2 条。
        expect(preview.eventCount).toBe(7);
        expect(preview.playable).toBe(true);
        stopFeedbackReplayRecording();
    });
});

describe('[SCN-FWB-049] 录制有时长上限与已知敏感区域（代码评审 §4.3）', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useRealTimers();
    });

    it('到达上限自动停止，并在 context 里说清楚是自停', async () => {
        // 坏行为：录制一旦开始就没有终点，直到页面关闭——用户点了「开始录制」然后
        // 忘了这回事，接下来一小时里所有与本次反馈无关的操作都在缓冲里。
        vi.useFakeTimers();
        const captured = {};
        vi.doMock('@rrweb/record', () => ({
            record: (options) => {
                captured.options = options;
                return () => {
                    captured.stopped = true;
                };
            },
        }));
        const { startFeedbackReplayRecording, getFeedbackReplayContext } =
            await import('../../../src/features/feedback/feedbackReplay.js');

        await startFeedbackReplayRecording();
        expect(getFeedbackReplayContext().enabled).toBe(true);
        expect(getFeedbackReplayContext().maxDurationMs).toBe(5 * 60 * 1000);

        vi.advanceTimersByTime(5 * 60 * 1000 + 10);
        expect(captured.stopped).toBe(true);
        const state = getFeedbackReplayContext();
        expect(state.enabled).toBe(false);
        expect(state.autoStopped).toBe(true);
        vi.useRealTimers();
    });

    it('录制选项里点名屏蔽 AI 配置弹窗、脱敏联系方式', async () => {
        const captured = {};
        vi.doMock('@rrweb/record', () => ({
            record: (options) => {
                captured.options = options;
                return () => {};
            },
        }));
        const { startFeedbackReplayRecording, stopFeedbackReplayRecording } =
            await import('../../../src/features/feedback/feedbackReplay.js');
        await startFeedbackReplayRecording();

        // maskAllInputs 只盖输入值，页面文本照录——密钥所在的整块必须 block。
        expect(captured.options.blockSelector).toContain('#ai_config_modal');
        expect(captured.options.maskTextSelector).toContain('#feedback-contact');
        stopFeedbackReplayRecording();
    });
});
