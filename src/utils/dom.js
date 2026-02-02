/**
 * DOM 操作辅助函数
 */
import { i18n } from './i18n.js';

// 用于通知选项变化的回调
let onOptionsChangeCallback = null;

/**
 * 设置选项变化回调
 * @param {Function} callback - 回调函数
 */
export function setOnOptionsChangeCallback(callback) {
    onOptionsChangeCallback = callback;
}

/**
 * 触发选项变化通知
 */
function notifyOptionsChange() {
    if (onOptionsChangeCallback) {
        onOptionsChangeCallback();
    }
}

/**
 * 添加选项输入框
 * @param {string} value - 选项默认值
 */
export function addOptionInput(value = '') {
    const optionsList = document.getElementById('options-list');
    const optionDiv = document.createElement('div');
    optionDiv.className = 'flex gap-2 mb-2';

    optionDiv.innerHTML = `
        <input type="text" value="${value}" placeholder="${i18n.t('fieldManagement.optionValue')}" class="input input-sm input-bordered flex-1 text-sm">
        <button type="button" class="btn btn-sm btn-error text-white remove-option-btn">${i18n.t('fieldManagement.remove')}</button>
    `;

    // 绑定输入变化事件
    const input = optionDiv.querySelector('input');
    input.addEventListener('input', notifyOptionsChange);
    input.addEventListener('blur', notifyOptionsChange);

    // 绑定删除事件
    optionDiv.querySelector('.remove-option-btn').addEventListener('click', function () {
        optionDiv.remove();
        notifyOptionsChange();
    });

    optionsList.appendChild(optionDiv);

    // 添加后通知变化
    notifyOptionsChange();
}

/**
 * 字段验证
 * @param {Object} field - 字段配置
 * @param {any} value - 字段值
 * @returns {Object} 验证结果 { valid: boolean, message?: string }
 */
export function validateField(field, value) {
    if (field.required && !value) {
        return { valid: false, message: i18n.t('validation.required') };
    }
    if (field.type === 'number' && value && isNaN(value)) {
        return { valid: false, message: i18n.t('validation.number') };
    }
    return { valid: true };
}

/**
 * 从 HTML 字符串提取纯文本
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本内容
 */
export function extractPlainText(html) {
    if (!html || typeof html !== 'string') return '';

    const temp = document.createElement('div');
    temp.innerHTML = html;

    const text = temp.textContent || temp.innerText || '';
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * 转义 HTML 属性值
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeAttr(str) {
    if (str == null || str === '') return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 转义 HTML 内容
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 显示摘要富文本弹窗
 * @param {HTMLElement} cell - 触发单元格元素
 * @param {string} html - 富文本HTML内容
 * @returns {HTMLElement} 弹窗元素
 */
export function showSummaryPopover(cell, html) {
    hideSummaryPopover();

    const popover = document.createElement('div');
    popover.className = 'summary-popover bg-base-100 border border-base-300 rounded-xl shadow-xl text-base-content';

    const rect = cell.getBoundingClientRect();
    popover.style.position = 'absolute';
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 8}px`;
    popover.style.zIndex = '1000';

    document.body.appendChild(popover);

    const popoverRect = popover.getBoundingClientRect();
    if (popoverRect.right > window.innerWidth) {
        popover.style.left = `${window.innerWidth - popoverRect.width - 16}px`;
    }
    if (popoverRect.bottom > window.innerHeight) {
        popover.style.top = `${rect.top - popoverRect.height - 8}px`;
    }

    return popover;
}

/**
 * 隐藏摘要富文本弹窗
 */
export function hideSummaryPopover() {
    const popover = document.getElementById('summary-popover');
    if (popover) {
        popover.remove();
    }
}
