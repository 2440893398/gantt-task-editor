/**
 * 反馈服务
 * - 手动反馈提交
 * - 自动错误上报
 * - 最近日志环形缓冲
 */

import { state } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import {
    clearFeedbackReplayBuffer,
    createFeedbackReplayAttachment,
    getFeedbackReplayContext,
} from './feedbackReplay.js';
import { sanitizeFeedbackUrl } from './feedback-url.js';

const MAX_LOGS = 80;
const MAX_LOG_LENGTH = 1200;
const MAX_ATTACHMENT_SIZE = 4 * 1024 * 1024;
/** 与服务端 MAX_FEEDBACK_COMMENT_ATTACHMENTS 对齐：它数的是含录像的总数。 */
const MAX_SERVER_ATTACHMENT_COUNT = 5;
const AUTO_REPORT_COOLDOWN_MS = 60 * 1000;
/** §中-4：动态指纹的错误风暴每指纹窗口拦不住，全局速率上限是客户端最后一道闸。 */
const AUTO_REPORT_WINDOW_MS = 60 * 1000;
const AUTO_REPORT_MAX_PER_WINDOW = 5;
/** §4.4：提交超时。挂起的请求会让对话框永远停在「提交中」。 */
const SUBMIT_TIMEOUT_MS = 15 * 1000;
const logs = [];

let originalConsole = null;
/** §中-4：每指纹各有冷却窗口。只存「上一条」的话，交替指纹（同一根因同时触发
 * error 与 unhandledrejection）会把冷却整个绕空。窗口外条目在成功后顺手清理，有界。 */
const autoReportAtByFingerprint = new Map();
/** 全局窗口内成功上报的时间戳（滑动窗口）。 */
let autoReportSentAt = [];
let errorListenersInstalled = false;

function getFeedbackApiBase() {
    const base = import.meta.env.VITE_FEEDBACK_API_URL || import.meta.env.VITE_SHARE_API_URL || '';
    return base.replace(/\/+$/, '');
}

function redact(value) {
    if (typeof value !== 'string') return value;
    return value
        .replace(/sk-[a-zA-Z0-9_-]{12,}/g, 'sk-***')
        .replace(/Bearer\s+[a-zA-Z0-9._-]+/g, 'Bearer ***')
        .replace(/api[_-]?key["'\s:=]+[a-zA-Z0-9._-]+/gi, 'apiKey=***');
}

function normalizeLogArg(arg) {
    if (arg instanceof Error) {
        return {
            name: arg.name,
            message: redact(arg.message),
            stack: redact(arg.stack || ''),
        };
    }

    if (typeof arg === 'string') {
        return redact(arg).slice(0, MAX_LOG_LENGTH);
    }

    try {
        return redact(JSON.stringify(arg)).slice(0, MAX_LOG_LENGTH);
    } catch {
        return String(arg).slice(0, MAX_LOG_LENGTH);
    }
}

export function recordFeedbackLog(level, args) {
    logs.push({
        level,
        at: new Date().toISOString(),
        args: Array.from(args).map(normalizeLogArg),
    });

    if (logs.length > MAX_LOGS) {
        logs.splice(0, logs.length - MAX_LOGS);
    }
}

export function getRecentFeedbackLogs() {
    return logs.slice();
}

function patchConsole() {
    if (originalConsole) return;

    originalConsole = {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
    };

    for (const level of Object.keys(originalConsole)) {
        console[level] = (...args) => {
            // 代码评审 2026-09-02 §4.8：采集在前、原始调用在后，且采集抛错会连累
            // **宿主的每一次 console 调用**。遥测组件的第一纪律是「自己挂了不能带走
            // 宿主」——所以采集包在 try 里，原始调用放 finally。
            try {
                recordFeedbackLog(level, args);
            } catch {
                // 采集失败只损失几行日志，不该让业务代码的 console.log 抛异常。
            } finally {
                originalConsole[level].apply(console, args);
            }
        };
    }
}

function getTaskSummary() {
    if (typeof window === 'undefined' || !window.gantt) {
        return null;
    }

    try {
        const tasks = window.gantt.serialize?.()?.data || [];
        return {
            count: tasks.length,
            openTaskId:
                document.querySelector('[data-task-id]')?.getAttribute('data-task-id') || null,
        };
    } catch {
        return null;
    }
}

export function getFeedbackContext(extra = {}) {
    const project = state.projects.find((item) => item.id === state.currentProjectId);

    return {
        app: 'gantt-task-editor',
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        locale: i18n.getLanguage(),
        // §1.9：hash 里放着 owner capability token，原样上报等于把钥匙塞进 Issue。
        url: sanitizeFeedbackUrl(window.location.href),
        title: document.title,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        },
        browser: {
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            online: navigator.onLine,
        },
        project: project
            ? {
                  id: project.id,
                  name: project.name,
                  color: project.color,
              }
            : null,
        taskSummary: getTaskSummary(),
        logs: getRecentFeedbackLogs(),
        ...extra,
    };
}

export async function fileToAttachment(file) {
    if (!file) return null;
    if (file.size > MAX_ATTACHMENT_SIZE) {
        throw new Error('ATTACHMENT_TOO_LARGE');
    }

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

    return {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl,
    };
}

export async function submitFeedback(feedback, { includeReplay = true } = {}) {
    const attachments = [...(feedback.attachments || [])];
    // 录像只随用户**主动**提交上传。auto_error 走 includeReplay:false——用户点
    // 「录制复现」去重现一个会抛错的 bug 时，恰恰是抛错触发的自动上报会把他尚未
    // 授权提交的复现段静默传走并清空，等他手动提交时只剩清空之后那几秒。
    let replayAttachment = includeReplay ? await createFeedbackReplayAttachment() : null;
    // 上下文在收尾快照之后取，计数才与附件一致。
    const replayContext = getFeedbackReplayContext();
    // §中-5：录像因故缺席时必须留痕——`eventCount>0, playable:true` 却没有附件的
    // Issue 会误导排查者。有事件却拿不出附件，唯一原因是单段超字节预算被整体丢弃。
    let replayDropped =
        includeReplay && !replayAttachment && replayContext.eventCount > 0
            ? 'over_byte_budget'
            : '';
    if (replayAttachment && attachments.length >= MAX_SERVER_ATTACHMENT_COUNT) {
        // §中-2：服务端数的是总数，5 个用户附件 + 录像 = 6 会整单 400。用户自己
        // 挑的附件优先，录像让位；没上传就不清缓冲，下次名额够时还能带上。
        replayDropped = 'attachment_slots_exhausted';
        replayAttachment = null;
    }
    if (replayAttachment) {
        attachments.push(replayAttachment);
    }

    const payload = {
        type: feedback.sourceType || feedback.type || 'manual',
        sourceType: feedback.sourceType || feedback.type || 'manual',
        submittedType: feedback.submittedType || 'unclear',
        title: feedback.title || '',
        description: feedback.description || '',
        contact: feedback.contact || '',
        attachments,
        context: getFeedbackContext({
            replay: replayDropped
                ? { ...replayContext, attachmentDropped: replayDropped }
                : replayContext,
            ...(feedback.context || {}),
        }),
    };

    // §4.4：超时与 keepalive。没有超时的话，请求挂起时对话框会永远停在「提交中」；
    // auto_error 是页面卸载前最可能发生的一类上报，不带 keepalive 会随导航被丢弃。
    // keepalive 有 64KB 上限，所以只给不带附件的自动上报用。判定必须按 UTF-8 字节
    // （§中-3）：JSON.stringify 不转义 CJK，`body.length` 数的是 code unit，中文日志
    // 下 code unit 在限内而真实字节超限——浏览器对超限 keepalive 直接 TypeError，
    // 加了 keepalive 的上报反而必败。
    const body = JSON.stringify(payload);
    const useKeepalive =
        payload.sourceType === 'auto_error' &&
        attachments.length === 0 &&
        new TextEncoder().encode(body).length < 60 * 1024;

    let response;
    try {
        response = await fetch(`${getFeedbackApiBase()}/api/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body,
            signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
            ...(useKeepalive ? { keepalive: true } : {}),
        });
    } catch (error) {
        const reason = error?.name === 'TimeoutError' ? 'FEEDBACK_TIMEOUT' : error.message;
        throw new Error(`FEEDBACK_NETWORK_ERROR: ${reason}`);
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Feedback submit failed: ${response.status} ${errorText}`);
    }

    // 评审 §4.2：录像已经随这一条上传，缓冲就此清空。不清的话，此后每一次运行时
    // 错误的**静默**自动上报都会把这段与错误无关的录像再传一遍——用户对「这段录像
    // 随本次反馈上传」的授权被无限延伸。清空发生在服务端确认接收之后：提交失败时
    // 录像必须留着，否则用户重试一次就只剩下点「重试」那几秒。只有真的上传了录像
    // 才清（超预算被整体丢弃时附件为 null，那段录像并没有离开本机，不能销毁）。
    if (replayAttachment) {
        clearFeedbackReplayBuffer();
    }

    try {
        return await response.json();
    } catch (error) {
        throw new Error(`FEEDBACK_INVALID_RESPONSE: ${error.message}`);
    }
}

/** 同一个错误的身份：位置 + 文案。时间窗口挡不住「同一个错误每 61 秒来一次」。 */
function runtimeErrorFingerprint(errorInfo) {
    return [
        errorInfo?.kind || '',
        errorInfo?.message || '',
        errorInfo?.source || '',
        errorInfo?.line ?? '',
        errorInfo?.column ?? '',
    ].join('|');
}

export async function reportRuntimeError(errorInfo) {
    const now = Date.now();
    const fingerprint = runtimeErrorFingerprint(errorInfo);
    // §4.5：同一个错误在冷却窗口内只报一次；**不同**的错误不该被上一个的窗口吃掉。
    // 旧实现只看时间：首条上报之后 60 秒内的真实新错误全部静默丢弃，而同一个错误
    // 每 61 秒还会重复上报一次。
    const lastForFingerprint = autoReportAtByFingerprint.get(fingerprint) || 0;
    if (now - lastForFingerprint < AUTO_REPORT_COOLDOWN_MS) {
        return null;
    }
    // §中-4：指纹带动态 id/时间戳时每条都是「新错误」，上面的窗口拦不住——
    // 全局速率上限封顶持续风暴（窗口内不同的真实错误照报）。
    autoReportSentAt = autoReportSentAt.filter((at) => now - at < AUTO_REPORT_WINDOW_MS);
    if (autoReportSentAt.length >= AUTO_REPORT_MAX_PER_WINDOW) {
        return null;
    }

    const result = await submitFeedback(
        {
            type: 'auto_error',
            sourceType: 'auto_error',
            submittedType: 'bug',
            title: errorInfo.message || 'Runtime error',
            description: errorInfo.stack || errorInfo.reason || '',
            context: {
                error: errorInfo,
                auto: true,
            },
        },
        // 自动上报没有用户授权，任何时候都不携带录像、不触碰缓冲。
        { includeReplay: false }
    );

    // §4.5：**成功之后**才扣冷却。发送前就扣的话，第一条上报失败会连带把随后
    // 60 秒内的真实错误一起静默丢掉——最需要上报的那一刻反而最安静。
    const sentAt = Date.now();
    autoReportAtByFingerprint.set(fingerprint, sentAt);
    autoReportSentAt.push(sentAt);
    for (const [key, at] of autoReportAtByFingerprint) {
        if (sentAt - at >= AUTO_REPORT_COOLDOWN_MS) {
            autoReportAtByFingerprint.delete(key);
        }
    }
    return result;
}

export function initFeedbackMonitoring() {
    patchConsole();

    if (errorListenersInstalled) return;
    errorListenersInstalled = true;

    window.addEventListener('error', (event) => {
        const error = event.error;
        recordFeedbackLog('error', [error || event.message]);
        reportRuntimeError({
            kind: 'error',
            message: redact(event.message),
            source: event.filename,
            line: event.lineno,
            column: event.colno,
            stack: redact(error?.stack || ''),
        }).catch((reportError) => {
            originalConsole?.warn?.('[Feedback] Auto report failed:', reportError);
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        recordFeedbackLog('error', [reason]);
        reportRuntimeError({
            kind: 'unhandledrejection',
            message: redact(reason?.message || String(reason)),
            stack: redact(reason?.stack || ''),
            reason: redact(String(reason)),
        }).catch((reportError) => {
            originalConsole?.warn?.('[Feedback] Auto report failed:', reportError);
        });
    });
}
