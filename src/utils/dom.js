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
    optionDiv.className = 'flex gap-2 mb-2';

    optionDiv.innerHTML = `
        <input type="text" value="${value}" placeholder="${i18n.t('fieldManagement.optionValue')}" class="input input-sm input-bordered flex-1 text-sm">
        <button type="button" class="btn btn-sm btn-error text-white remove-option-btn">${i18n.t('fieldManagement.remove')}</button>
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
