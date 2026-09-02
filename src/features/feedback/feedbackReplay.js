/**
 * Feedback replay recorder.
 * Uses rrweb's maintained record package to keep a compact interaction trace.
 */

import { sanitizeFeedbackUrl, sanitizeReplayEvent } from './feedback-url.js';

const MAX_REPLAY_EVENTS = 300;
const MAX_REPLAY_BYTES = 2.5 * 1024 * 1024;
/**
 * 每 N 个增量事件让 rrweb 重新拍一次全量快照（= 一个新的 segment 起点）。
 * 只靠 `checkoutEveryNms` 不够：甘特图拖拽/滚动几秒就能打满事件预算，而这段时间里
 * 一个 60 秒的 checkout 窗口都还没到——缓冲里于是全是增量事件，没有可挂载的快照。
 */
const CHECKOUT_EVERY_N_EVENTS = 100;

/**
 * 录制时长上限（代码评审 2026-09-02 §4.3）。
 *
 * 之前录制一旦开始就没有终点，直到页面关闭——用户点了「开始录制」，然后忘了这回事，
 * 接下来一小时的所有操作（含与本次反馈无关的内容）都在缓冲里。Sentry Replay 有
 * 60 分钟会话上限；这里取 5 分钟：一次复现操作远用不了这么久，而超时自动停止比
 * 「一直录着」更容易解释。
 */
const MAX_RECORDING_MS = 5 * 60 * 1000;

/**
 * 已知敏感区域（§4.3）。`maskAllInputs` 只盖 input/textarea 的值，**页面文本不盖**：
 * AI 配置弹窗里的 base_url、模型名与旁边的提示文本都会以文本节点进快照。
 * 全量文本脱敏与「看得懂复现」的产品目标直接冲突，所以这里只点名两类：
 * - AI 配置弹窗：整块 block 掉（连结构都不录，里面除了密钥没有复现价值）；
 * - 反馈对话框自己的联系方式：文本脱敏（结构留着，值不留）。
 * 这条是取舍不是完备防线，写在这里是为了让下一个人知道边界在哪。
 */
const REPLAY_BLOCK_SELECTOR = '#ai_config_modal, [data-feedback-replay-block]';
const REPLAY_MASK_TEXT_SELECTOR = '#feedback-contact, [data-feedback-replay-mask]';

/** rrweb 事件类型（`@rrweb/types` 的 EventType）。这里只用到这三个。 */
const RRWEB_EVENT = Object.freeze({ FULL_SNAPSHOT: 2, INCREMENTAL: 3, META: 4 });

/**
 * 缓冲按 **segment** 组织（代码评审 2026-09-02 §4.1）。
 *
 * 旧实现是一个平坦数组，超过 300 条就从头 splice；`fitEventsToBudget` 超字节预算时
 * 再从头砍 15%。两处都不保证首条是 FullSnapshot——甘特图上拖几秒，窗口起点就落在
 * 增量事件中段，Replayer 没有快照可挂载：预览黑屏、上传的 JSON 也放不出来。
 * 而回放正是这个模块唯一的交付物。
 *
 * 现在每个 segment 以一次 checkout（Meta + FullSnapshot）开头，裁剪只在 **segment
 * 边界**上整段丢弃——留下的第一条永远是快照，剩下的永远是它之后的增量。
 * 这也是 rrweb 官方 buffer 模式与 Sentry Replay 的做法。
 */
let replaySegments = [];
let droppedSegmentCount = 0;
let checkoutScheduled = false;
let autoStopTimer = null;
/** 上一次录制是否因为到达时长上限而自动停止——UI 要能说清楚为什么停了。 */
let autoStopped = false;
const listeners = new Set();

let recordApi = null;
let stopRecording = null;
let startPromise = null;
let recordingStartedAt = null;
let recordingError = null;
let recordingEndedAt = null;

function getEventTime(event) {
    return event?.timestamp ? new Date(event.timestamp).toISOString() : null;
}

function measureBytes(value) {
    return new TextEncoder().encode(value).length;
}

function encodeBase64(value) {
    const bytes = new TextEncoder().encode(value);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
}

/** 展平当前缓冲。段内顺序即录制顺序，段之间也是。 */
function bufferedEvents() {
    return replaySegments.flat();
}

function bufferedEventCount() {
    return replaySegments.reduce((total, segment) => total + segment.length, 0);
}

/**
 * 「这段事件放得出来吗」——Replayer 需要在任何增量变更之前先有一份可挂载的 DOM
 * 快照。有快照但它前面已经有增量事件，同样播不了（那些增量引用的节点还不存在）。
 * 判定摆在 payload 与 context 里：宁可如实说「这次没录到可播的片段」，
 * 也不要交一个打开是黑屏、还查不出原因的附件。
 */
function isPlayable(events) {
    const snapshotIndex = events.findIndex((event) => event?.type === RRWEB_EVENT.FULL_SNAPSHOT);
    if (snapshotIndex < 0) return false;
    return !events.slice(0, snapshotIndex).some((event) => event?.type === RRWEB_EVENT.INCREMENTAL);
}

function buildReplayPayload(events, { droppedSegments = droppedSegmentCount } = {}) {
    return {
        kind: 'rrweb-replay',
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        // §1.9：hash 里是 capability token；录像与上下文走同一把净化。
        url: sanitizeFeedbackUrl(window.location.href),
        title: document.title,
        eventCount: events.length,
        startedAt: recordingStartedAt,
        endedAt: recordingEndedAt,
        firstEventAt: getEventTime(events[0]),
        lastEventAt: getEventTime(events[events.length - 1]),
        // 裁剪是有损的，且损失量对「为什么只看到最后十几秒」是唯一解释。
        droppedSegments,
        playable: isPlayable(events),
        events,
    };
}

export function getFeedbackReplayPreview() {
    return buildReplayPayload(bufferedEvents());
}

function emitReplayState() {
    const state = getFeedbackReplayContext();
    listeners.forEach((listener) => {
        listener(state);
    });
}

/**
 * 字节预算同样只在 segment 边界上裁剪。旧实现按 15% 从头砍，砍着砍着就把快照砍掉了，
 * 而剩下的那些增量事件对 Replayer 毫无意义——文件不小、还播不出来。
 */
function fitEventsToBudget() {
    const kept = replaySegments.map((segment) => segment.slice());
    let dropped = droppedSegmentCount;

    while (kept.length > 0) {
        const events = kept.flat();
        const json = JSON.stringify(buildReplayPayload(events, { droppedSegments: dropped }));
        if (measureBytes(json) <= MAX_REPLAY_BYTES) {
            return { events, json, droppedSegments: dropped };
        }

        kept.shift();
        dropped += 1;
    }

    return null;
}

/**
 * 单段自己就超过事件预算时，主动请 rrweb 重新起一段（而不是从段内头部丢事件——
 * 那会丢掉快照，正是本条要修的坏行为）。用 setTimeout 推到 emit 之外执行：
 * `takeFullSnapshot` 内部会重置样式表管理器并锁 mutation buffer，在它自己的 emit
 * 回调里重入不安全。
 */
function scheduleCheckout() {
    if (checkoutScheduled || !stopRecording || typeof recordApi?.takeFullSnapshot !== 'function') {
        return;
    }
    checkoutScheduled = true;
    setTimeout(() => {
        checkoutScheduled = false;
        try {
            recordApi.takeFullSnapshot(true);
        } catch {
            // 拍不出新快照就维持现状：旧段仍然可播，只是缓冲一直偏大。
        }
    }, 0);
}

function trimSegments() {
    while (bufferedEventCount() > MAX_REPLAY_EVENTS && replaySegments.length > 1) {
        replaySegments.shift();
        droppedSegmentCount += 1;
    }
    if (bufferedEventCount() > MAX_REPLAY_EVENTS) scheduleCheckout();
}

/**
 * rrweb 的 emit 回调。第二个参数 `isCheckout` 在一次 checkout 的**首条事件**
 * （Meta）上为 true——段边界只能由它划，靠事件类型猜会把普通的 Meta 也当成新段。
 */
export function recordFeedbackReplayEvent(event, isCheckout = false) {
    if (isCheckout || replaySegments.length === 0) {
        replaySegments.push([]);
    }
    // §1.9：Meta 事件带 href，而它正是每个 segment 的第一条——不在入缓冲时洗掉，
    // 凭据只是换了个地方跟着录像上传。
    replaySegments[replaySegments.length - 1].push(sanitizeReplayEvent(event));
    trimSegments();
}

/**
 * 提交成功后清空缓冲（代码评审 2026-09-02 §4.2）。
 *
 * 旧实现只在 `start` 时清空，于是一次提交之后的**每一次**运行时错误自动上报
 * （用户无感知）都会把那段与错误无关的完整录像再传一遍——用户对「这段录像随本次
 * 反馈上传」的授权被无限延伸。清空后必须立刻重拍快照，否则新缓冲会以增量事件开头，
 * 下一次提交又是一个播不了的附件。
 */
export function clearFeedbackReplayBuffer() {
    replaySegments = [];
    droppedSegmentCount = 0;
    if (stopRecording) scheduleCheckout();
    emitReplayState();
}

export function getFeedbackReplayContext() {
    const events = bufferedEvents();
    return {
        enabled: !!stopRecording,
        startedAt: recordingStartedAt,
        endedAt: recordingEndedAt,
        eventCount: events.length,
        segmentCount: replaySegments.length,
        droppedSegments: droppedSegmentCount,
        // §4.3：到点自停要能被说出来，否则用户只看到「怎么不录了」。
        maxDurationMs: MAX_RECORDING_MS,
        autoStopped,
        playable: isPlayable(events),
        firstEventAt: getEventTime(events[0]),
        lastEventAt: getEventTime(events[events.length - 1]),
        error: recordingError,
    };
}

export function onFeedbackReplayStateChange(listener) {
    listeners.add(listener);
    listener(getFeedbackReplayContext());
    return () => listeners.delete(listener);
}

export async function createFeedbackReplayAttachment() {
    if (bufferedEventCount() === 0) {
        return null;
    }

    if (stopRecording) {
        try {
            // 收尾快照走 `isCheckout=false`：它是当前这一段的结尾，不是新段的开头。
            // 传 true 会当场开一个只有快照、没有后续操作的空段，反而把有内容的那段
            // 挤出预算。
            recordApi?.takeFullSnapshot?.();
            await new Promise((resolve) => setTimeout(resolve, 0));
        } catch {
            // The cached incremental events are still useful if a final snapshot fails.
        }
    }

    const fitted = fitEventsToBudget();
    if (!fitted) {
        return null;
    }

    const payload = buildReplayPayload(fitted.events, { droppedSegments: fitted.droppedSegments });
    const json = JSON.stringify(payload);

    return {
        name: `feedback-rrweb-${Date.now()}.json`,
        type: 'application/json',
        size: measureBytes(json),
        dataUrl: `data:application/json;base64,${encodeBase64(json)}`,
    };
}

export async function startFeedbackReplayRecording() {
    if (stopRecording) {
        return true;
    }

    if (startPromise) {
        return startPromise;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }

    replaySegments = [];
    droppedSegmentCount = 0;
    autoStopped = false;
    recordingStartedAt = null;
    recordingEndedAt = null;
    recordingError = null;

    startPromise = startReplayRecording();
    const started = await startPromise;
    startPromise = null;
    return started;
}

export function stopFeedbackReplayRecording() {
    if (!stopRecording) {
        return false;
    }

    if (autoStopTimer) {
        clearTimeout(autoStopTimer);
        autoStopTimer = null;
    }

    try {
        recordApi?.takeFullSnapshot?.(true);
    } catch {
        // rrweb can reject snapshots during teardown; keep the existing event buffer.
    }

    stopRecording();
    stopRecording = null;
    recordingEndedAt = new Date().toISOString();
    emitReplayState();
    return true;
}

async function startReplayRecording() {
    try {
        const rrwebRecord = await import('@rrweb/record');
        const record = rrwebRecord.record || rrwebRecord.default;

        recordApi = record;
        recordingStartedAt = new Date().toISOString();
        recordingEndedAt = null;
        recordingError = null;
        stopRecording = record({
            emit: recordFeedbackReplayEvent,
            checkoutEveryNms: 60 * 1000,
            // 按事件数也要 checkout（§4.1）：时间窗口挡不住「几秒钟打满预算」的高频
            // 操作，而按条数裁剪时必须有足够密的段边界，才有整段可丢、且丢完仍可播。
            checkoutEveryNth: CHECKOUT_EVERY_N_EVENTS,
            maskAllInputs: true,
            // §4.3：已知敏感区域。maskAllInputs 只盖输入值，页面文本照录。
            blockSelector: REPLAY_BLOCK_SELECTOR,
            maskTextSelector: REPLAY_MASK_TEXT_SELECTOR,
            inlineImages: false,
            collectFonts: false,
            recordCanvas: false,
            slimDOMOptions: 'all',
            sampling: {
                mousemove: false,
                scroll: 150,
                media: 800,
                input: 'last',
            },
        });

        // §4.3：到点自动停。定时器在 stop 里清掉，避免停了之后还留一个待触发的回调。
        autoStopTimer = setTimeout(() => {
            autoStopTimer = null;
            if (!stopRecording) return;
            autoStopped = true;
            stopFeedbackReplayRecording();
        }, MAX_RECORDING_MS);

        emitReplayState();
        return !!stopRecording;
    } catch (error) {
        recordingError = error?.message || String(error);
        stopRecording = null;
        emitReplayState();
        return false;
    }
}
