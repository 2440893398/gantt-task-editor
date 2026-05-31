/**
 * 反馈服务
 * - 手动反馈提交
 * - 自动错误上报
 * - 最近日志环形缓冲
 */

import { state } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { createFeedbackReplayAttachment, getFeedbackReplayContext } from './feedbackReplay.js';

const MAX_LOGS = 80;
const MAX_LOG_LENGTH = 1200;
const MAX_ATTACHMENT_SIZE = 4 * 1024 * 1024;
const AUTO_REPORT_COOLDOWN_MS = 60 * 1000;
const logs = [];

let originalConsole = null;
let lastAutoReportAt = 0;
let errorListenersInstalled = false;

function getFeedbackApiBase() {
    const base =
        import.meta.env.VITE_FEEDBACK_API_URL ||
        import.meta.env.VITE_SHARE_API_URL ||
        'https://gantt-share.your-worker.workers.dev';
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
            recordFeedbackLog(level, args);
            originalConsole[level].apply(console, args);
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
        url: window.location.href,
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

export async function submitFeedback(feedback) {
    const attachments = [...(feedback.attachments || [])];
    const replayAttachment = await createFeedbackReplayAttachment();

    if (replayAttachment) {
        attachments.push(replayAttachment);
    }

    const payload = {
        type: feedback.type || 'manual',
        title: feedback.title || '',
        description: feedback.description || '',
        contact: feedback.contact || '',
        attachments,
        context: getFeedbackContext({
            replay: getFeedbackReplayContext(),
            ...(feedback.context || {}),
        }),
    };

    let response;
    try {
        response = await fetch(`${getFeedbackApiBase()}/api/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        throw new Error(`FEEDBACK_NETWORK_ERROR: ${error.message}`);
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Feedback submit failed: ${response.status} ${errorText}`);
    }

    try {
        return await response.json();
    } catch (error) {
        throw new Error(`FEEDBACK_INVALID_RESPONSE: ${error.message}`);
    }
}

export async function reportRuntimeError(errorInfo) {
    const now = Date.now();
    if (now - lastAutoReportAt < AUTO_REPORT_COOLDOWN_MS) {
        return null;
    }
    lastAutoReportAt = now;

    return submitFeedback({
        type: 'auto_error',
        title: errorInfo.message || 'Runtime error',
        description: errorInfo.stack || errorInfo.reason || '',
        context: {
            error: errorInfo,
            auto: true,
        },
    });
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
