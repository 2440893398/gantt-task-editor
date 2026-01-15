/**
 * DOM 操作辅助函数
 */
import { i18n } from './i18n.js';

/**
 * 添加选项输入框
 * @param {string} value - 选项默认值
 */
export function addOptionInput(value = '') {
    const optionsList = document.getElementById('options-list');
    const optionDiv = document.createElement('div');
    optionDiv.style.marginBottom = '8px';
    optionDiv.style.display = 'flex';
    optionDiv.style.gap = '8px';
    optionDiv.innerHTML = `
        <input type="text" value="${value}" placeholder="${i18n.t('fieldManagement.optionValue')}" style="flex: 1; padding: 8px 12px; border: 1px solid #E5E7EB; border-radius: 6px; font-size: 13px;">
        <button type="button" class="remove-option-btn" style="padding: 6px 12px; background: #EF4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">${i18n.t('fieldManagement.remove')}</button>
    `;

    // 绑定删除事件
    optionDiv.querySelector('.remove-option-btn').addEventListener('click', function () {
        optionDiv.remove();
    });

    optionsList.appendChild(optionDiv);
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
