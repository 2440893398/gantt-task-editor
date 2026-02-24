/**
 * AI 错误处理服务 (F-104)
 * 提供友好的错误解析和展示
 */

import { i18n } from '../../../utils/i18n.js';
import { showToast } from '../../../utils/toast.js';

/**
 * 错误类型映射表
 */
const ERROR_TYPES = {
    quota_exceeded: {
        type: 'warning',
        icon: '⚠️',
        titleKey: 'ai.error.quotaExceeded',
        defaultTitle: 'Quota exceeded',
        messageKey: 'ai.error.quotaExceededMsg',
        defaultMessage: 'The free quota for this model is exhausted',
        actionKey: 'ai.error.quotaAction',
        defaultAction: 'Switch model or upgrade plan'
    },
    invalid_api_key: {
        type: 'error',
        icon: '❌',
        titleKey: 'ai.error.invalidKey',
        defaultTitle: 'Invalid API key',
        messageKey: 'ai.error.invalidKeyMsg',
        defaultMessage: 'Please verify API key configuration and remove extra spaces',
        actionKey: 'ai.error.checkConfig',
        defaultAction: 'Check settings'
    },
    rate_limit_exceeded: {
        type: 'warning',
        icon: '⏱️',
        titleKey: 'ai.error.rateLimit',
        defaultTitle: 'Too many requests',
        messageKey: 'ai.error.rateLimitMsg',
        defaultMessage: 'Please try again later',
        actionKey: 'ai.error.waitRetry',
        defaultAction: 'Retry later'
    },
    model_not_found: {
        type: 'error',
        icon: '🔍',
        titleKey: 'ai.error.modelNotFound',
        defaultTitle: 'Model not found',
        messageKey: 'ai.error.modelNotFoundMsg',
        defaultMessage: 'Requested model was not found',
        actionKey: 'ai.error.selectOther',
        defaultAction: 'Choose another model'
    },
    network_error: {
        type: 'error',
        icon: '🌐',
        titleKey: 'ai.error.network',
        defaultTitle: 'Network connection failed',
        messageKey: 'ai.error.networkMsg',
        defaultMessage: 'Unable to connect to AI service',
        actionKey: 'ai.error.checkNetwork',
        defaultAction: 'Check network or Base URL'
    },
    context_length_exceeded: {
        type: 'warning',
        icon: '📏',
        titleKey: 'ai.error.contextLength',
        defaultTitle: 'Input too long',
        messageKey: 'ai.error.contextLengthMsg',
        defaultMessage: 'Input exceeds model context limit',
        actionKey: 'ai.error.shortenInput',
        defaultAction: 'Shorten input'
    },
    unknown: {
        type: 'error',
        icon: '❓',
        titleKey: 'ai.error.unknown',
        defaultTitle: 'Unknown error',
        messageKey: 'ai.error.unknownMsg',
        defaultMessage: 'An unknown error occurred',
        actionKey: 'ai.error.viewDetails',
        defaultAction: 'View details'
    }
};

function tr(key, fallback) {
    const value = i18n.t(key);
    return value === key ? fallback : value;
}

/**
 * 解析 API 错误
 * @param {Error|Object} error - 错误对象
 * @returns {Object} 解析后的错误信息
 */
export function parseError(error) {
    let errorType = 'unknown';
    const extracted = extractApiErrorInfo(error);
    const message = extracted.message || error?.message || error?.error?.message || String(error);
    const originalError = extracted.originalError || error?.error || error;

    // 根据错误内容判断类型
    if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid_api_key')) {
        errorType = 'invalid_api_key';
    } else if (message.includes('429') || message.includes('rate_limit') || message.includes('Rate limit')) {
        errorType = 'rate_limit_exceeded';
    } else if (message.includes('quota') || message.includes('insufficient_quota') || message.includes('billing')) {
        errorType = 'quota_exceeded';
    } else if (message.includes('model') && (message.includes('not found') || message.includes('does not exist'))) {
        errorType = 'model_not_found';
    } else if (message.includes('context_length') || message.includes('maximum context length')) {
        errorType = 'context_length_exceeded';
    } else if (message.includes('network') || message.includes('fetch') || message.includes('Failed to fetch') || message.includes('ECONNREFUSED')) {
        errorType = 'network_error';
    }

    const config = ERROR_TYPES[errorType];

    return {
        errorType,
        type: config.type,
        icon: config.icon,
        title: tr(config.titleKey, config.defaultTitle),
        message: message || tr(config.messageKey, config.defaultMessage),
        action: tr(config.actionKey, config.defaultAction),
        originalError: originalError
    };
}

function extractApiErrorInfo(error) {
    const candidates = [];

    if (!error) return { message: '', originalError: error };

    const push = (val) => {
        if (val !== undefined && val !== null) candidates.push(val);
    };

    push(error.error);
    push(error.cause);
    push(error.response);
    push(error.data);
    push(error.body);
    push(error);
    push(error.response?.error);
    push(error.response?.data);
    push(error.response?.body);
    push(error.cause?.error);
    push(error.cause?.response);
    push(error.cause?.data);

    for (const item of candidates) {
        if (!item) continue;

        if (typeof item === 'string') {
            const parsed = tryParseJson(item);
            if (parsed) {
                const fromParsed = extractApiErrorInfo(parsed);
                if (fromParsed.message) return fromParsed;
            }
            if (item.trim()) {
                return { message: item.trim(), originalError: error };
            }
            continue;
        }

        const nestedMessage = item?.error?.message
            || item?.data?.error?.message
            || item?.response?.data?.error?.message
            || item?.response?.error?.message;

        if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
            return { message: nestedMessage.trim(), originalError: item };
        }

        if (item instanceof Error) {
            const frameworkMessage = String(item.message || '');
            const isFrameworkWrapper = frameworkMessage.includes('AI_NoOutputGeneratedError')
                || frameworkMessage.includes('AI_APICallError')
                || frameworkMessage.includes('AI_');

            if (isFrameworkWrapper && item.cause) {
                continue;
            }
        }

        if (typeof item?.message === 'string' && item.message.trim()) {
            return { message: item.message.trim(), originalError: item };
        }
    }

    return { message: '', originalError: error };
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/**
 * 创建错误 Alert HTML
 * @param {Object} parsedError - 解析后的错误对象
 * @param {boolean} showDetails - 是否显示详情折叠
 * @returns {string} HTML 字符串
 */
export function createErrorAlertHTML(parsedError, showDetails = true) {
    const { type, icon, title, message, action, originalError } = parsedError;
    const alertClass = type === 'warning' ? 'alert-warning' : 'alert-error';

    let detailsHTML = '';
    if (showDetails && originalError) {
        const errorJson = typeof originalError === 'string'
            ? originalError
            : JSON.stringify(originalError, null, 2);

        detailsHTML = `
            <details class="collapse collapse-arrow mt-2">
                <summary class="collapse-title text-xs font-medium p-2 min-h-0 bg-base-300 rounded-lg">
                    ${tr('ai.error.originalError', 'Original error details')}
                </summary>
                <div class="collapse-content bg-base-300 rounded-b-lg">
                    <pre class="text-xs overflow-x-auto p-2 mt-0 whitespace-pre-wrap break-all">${escapeHtml(errorJson)}</pre>
                </div>
            </details>
        `;
    }

    return `
        <div class="alert ${alertClass} shadow-lg mb-4">
            <div class="flex-1">
                <div class="flex items-start gap-3">
                    <span class="text-xl flex-shrink-0 mt-0.5">${icon}</span>
                    <div class="flex-1 min-w-0">
                        <h4 class="font-semibold text-sm">${escapeHtml(title)}</h4>
                        <p class="text-xs opacity-80 mt-1">${escapeHtml(message)}</p>
                        <div class="flex gap-2 mt-3">
                            <button class="btn btn-xs btn-outline ai-error-action" data-action="config">
                                ${escapeHtml(action)}
                            </button>
                            ${showDetails ? `
                                <button class="btn btn-xs btn-ghost opacity-60 ai-error-toggle-details">
                                    ${tr('ai.error.viewDetails', 'View details')}
                                </button>
                            ` : ''}
                        </div>
                        ${detailsHTML}
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * 显示错误 Toast
 * @param {Object} parsedError - 解析后的错误对象
 * @param {number} duration - 显示时长（毫秒）
 */
export function showErrorToast(parsedError, duration = 5000) {
    const { icon, title, message, type } = parsedError;
    const toastType = type === 'warning' ? 'warning' : 'error';
    showToast(`${icon} ${title}: ${message}`, toastType, duration);
}

/**
 * 处理 AI 调用错误
 * @param {Error} error - 原始错误
 * @param {Object} options - { showAlert, alertContainer, showToast }
 * @returns {Object} 解析后的错误对象
 */
export function handleAiError(error, options = {}) {
    const {
        showAlertCard = false,
        alertContainer = null,
        showToastMsg = true
    } = options;

    const parsedError = parseError(error);

    console.error('[AI Error Handler]', parsedError.errorType, error);

    if (showToastMsg) {
        showErrorToast(parsedError);
    }

    if (showAlertCard && alertContainer) {
        const alertHTML = createErrorAlertHTML(parsedError);
        alertContainer.innerHTML = alertHTML;
        alertContainer.classList.remove('hidden');

        // 绑定详情切换
        const toggleBtn = alertContainer.querySelector('.ai-error-toggle-details');
        const details = alertContainer.querySelector('details');
        if (toggleBtn && details) {
            toggleBtn.addEventListener('click', () => {
                details.open = !details.open;
            });
        }

        // 绑定操作按钮
        const actionBtn = alertContainer.querySelector('.ai-error-action');
        if (actionBtn) {
            actionBtn.addEventListener('click', async () => {
                const { openAiConfigModal } = await import('../components/AiConfigModal.js');
                openAiConfigModal();
            });
        }
    }

    return parsedError;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    if (typeof text !== 'string') {
        text = String(text);
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export default {
    parseError,
    createErrorAlertHTML,
    showErrorToast,
    handleAiError,
    ERROR_TYPES
};
