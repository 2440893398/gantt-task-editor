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
        defaultTitle: '额度已用尽',
        messageKey: 'ai.error.quotaExceededMsg',
        defaultMessage: '当前模型免费额度已用完',
        actionKey: 'ai.error.quotaAction',
        defaultAction: '切换模型或充值'
    },
    invalid_api_key: {
        type: 'error',
        icon: '❌',
        titleKey: 'ai.error.invalidKey',
        defaultTitle: 'API Key 无效',
        messageKey: 'ai.error.invalidKeyMsg',
        defaultMessage: '请检查您的 API Key 是否正确配置，确保没有多余的空格',
        actionKey: 'ai.error.checkConfig',
        defaultAction: '检查配置'
    },
    rate_limit_exceeded: {
        type: 'warning',
        icon: '⏱️',
        titleKey: 'ai.error.rateLimit',
        defaultTitle: '请求过于频繁',
        messageKey: 'ai.error.rateLimitMsg',
        defaultMessage: '请稍后再试',
        actionKey: 'ai.error.waitRetry',
        defaultAction: '稍后重试'
    },
    model_not_found: {
        type: 'error',
        icon: '🔍',
        titleKey: 'ai.error.modelNotFound',
        defaultTitle: '模型不存在',
        messageKey: 'ai.error.modelNotFoundMsg',
        defaultMessage: '请求的模型未找到',
        actionKey: 'ai.error.selectOther',
        defaultAction: '选择其他模型'
    },
    network_error: {
        type: 'error',
        icon: '🌐',
        titleKey: 'ai.error.network',
        defaultTitle: '网络连接失败',
        messageKey: 'ai.error.networkMsg',
        defaultMessage: '无法连接到 AI 服务',
        actionKey: 'ai.error.checkNetwork',
        defaultAction: '检查网络或 Base URL'
    },
    context_length_exceeded: {
        type: 'warning',
        icon: '📏',
        titleKey: 'ai.error.contextLength',
        defaultTitle: '内容过长',
        messageKey: 'ai.error.contextLengthMsg',
        defaultMessage: '输入内容超出模型上下文限制',
        actionKey: 'ai.error.shortenInput',
        defaultAction: '缩短输入内容'
    },
    unknown: {
        type: 'error',
        icon: '❓',
        titleKey: 'ai.error.unknown',
        defaultTitle: '未知错误',
        messageKey: 'ai.error.unknownMsg',
        defaultMessage: '发生未知错误',
        actionKey: 'ai.error.viewDetails',
        defaultAction: '查看详情'
    }
};

/**
 * 解析 API 错误
 * @param {Error|Object} error - 错误对象
 * @returns {Object} 解析后的错误信息
 */
export function parseError(error) {
    let errorType = 'unknown';
    let originalError = null;

    // 提取错误信息
    const message = error?.message || error?.error?.message || String(error);
    originalError = error?.error || error;

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
        title: i18n.t(config.titleKey) || config.defaultTitle,
        message: i18n.t(config.messageKey) || config.defaultMessage,
        action: i18n.t(config.actionKey) || config.defaultAction,
        originalError: originalError
    };
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
                    ${i18n.t('ai.error.originalError') || '原始错误信息'}
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
                                    ${i18n.t('ai.error.viewDetails') || '查看详情'}
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
