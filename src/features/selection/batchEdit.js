/**
 * 批量编辑功能
 */

import { state } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { updateSelectedTasksUI } from './selectionManager.js';
import { i18n } from '../../utils/i18n.js';

/**
 * 打开批量编辑面板
 */
export function openBatchEditPanel() {
    if (state.selectedTasks.size === 0) {
        showToast(i18n.t('message.noData'), 'error', 3000);
        return;
    }

    const panel = document.getElementById('batch-edit-panel');
    panel.classList.add('open');

    const countText = `ℹ️ 已选中 ${state.selectedTasks.size} 个任务`;
    const countNumber = String(state.selectedTasks.size);
    const textEl = document.getElementById('batch-selected-count-text');
    if (textEl) {
        textEl.textContent = countText;
    }
    const countEl = document.getElementById('batch-selected-count');
    if (countEl) {
        countEl.textContent = countNumber;
    }

    // 填充字段选择下拉框
    const select = document.getElementById('batch-field-select');
    select.innerHTML = `<option value="">${i18n.t('form.selectPlaceholder')}</option>`;

    state.customFields.forEach(field => {
        select.innerHTML += `<option value="${field.name}">${field.label}</option>`;
    });
}

/**
 * 关闭批量编辑面板
 */
export function closeBatchEditPanel() {
    document.getElementById('batch-edit-panel').classList.remove('open');
    document.getElementById('batch-field-select').value = '';
    document.getElementById('batch-field-input-container').style.display = 'none';
}

/**
 * 应用批量编辑
 */
export function applyBatchEdit() {
    const fieldName = document.getElementById('batch-field-select').value;
    if (!fieldName) {
        showToast(i18n.t('batchEdit.selectField'), 'error', 3000);
        return;
    }

    const field = state.customFields.find(f => f.name === fieldName);
    const inputContainer = document.getElementById('batch-field-input');
    let value;

    if (field.type === 'multiselect') {
        const select = inputContainer.querySelector('select');
        value = Array.from(select.selectedOptions).map(o => o.value).join(',');
    } else {
        const input = inputContainer.querySelector('input, select');
        value = input ? input.value : '';
    }

    // 应用到所有选中的任务
    let updateCount = 0;
    state.selectedTasks.forEach(taskId => {
        const task = gantt.getTask(taskId);
        task[fieldName] = value;
        gantt.updateTask(taskId);
        updateCount++;
    });

    showToast(i18n.t('message.updateSuccess', { count: updateCount }), 'success');
    closeBatchEditPanel();
    state.selectedTasks.clear();
    updateSelectedTasksUI();
}

/**
 * 初始化批量编辑事件
 */
export function initBatchEdit() {
    document.getElementById('batch-edit-btn').addEventListener('click', openBatchEditPanel);
    document.getElementById('close-batch-edit').addEventListener('click', closeBatchEditPanel);
    document.getElementById('batch-cancel-btn').addEventListener('click', closeBatchEditPanel);
    document.getElementById('batch-apply-btn').addEventListener('click', applyBatchEdit);

    // 清除选择按钮
    document.getElementById('clear-selection-btn').addEventListener('click', function () {
        state.selectedTasks.clear();
        updateSelectedTasksUI();
    });

    // 批量编辑字段选择
    document.getElementById('batch-field-select').addEventListener('change', function () {
        const fieldName = this.value;
        const container = document.getElementById('batch-field-input-container');
        const inputContainer = document.getElementById('batch-field-input');
        const label = document.getElementById('batch-field-label');

        if (!fieldName) {
            container.style.display = 'none';
            return;
        }

        const field = state.customFields.find(f => f.name === fieldName);
        label.textContent = field.label;
        container.style.display = 'block';

        let inputHTML = '';

        if (field.type === 'text') {
            inputHTML = `<input type="text" class="form-control" placeholder="${field.label}">`;
        } else if (field.type === 'number') {
            inputHTML = `<input type="number" class="form-control" placeholder="${field.label}">`;
        } else if (field.type === 'select') {
            inputHTML = `<select class="form-control"><option value="">${i18n.t('form.selectPlaceholder')}</option>`;
            field.options.forEach(option => {
                // 如果字段有 i18nKey，则翻译选项值
                let displayValue = option;
                if (field.i18nKey) {
                    const translated = i18n.t(`${field.i18nKey}.${option}`);
                    if (translated !== `${field.i18nKey}.${option}`) {
                        displayValue = translated;
                    }
                }
                inputHTML += `<option value="${option}">${displayValue}</option>`;
            });
            inputHTML += `</select>`;
        } else if (field.type === 'multiselect') {
            inputHTML = `<select class="form-control" multiple style="min-height: 100px;">`;
            field.options.forEach(option => {
                // 如果字段有 i18nKey，则翻译选项值
                let displayValue = option;
                if (field.i18nKey) {
                    const translated = i18n.t(`${field.i18nKey}.${option}`);
                    if (translated !== `${field.i18nKey}.${option}`) {
                        displayValue = translated;
                    }
                }
                inputHTML += `<option value="${option}">${displayValue}</option>`;
            });
            inputHTML += `</select>`;
        }

        inputContainer.innerHTML = inputHTML;
    });
}
