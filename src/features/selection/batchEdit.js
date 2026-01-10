/**
 * 批量编辑功能
 */

import { state } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { updateSelectedTasksUI } from './selectionManager.js';

/**
 * 打开批量编辑面板
 */
export function openBatchEditPanel() {
    if (state.selectedTasks.size === 0) {
        showToast('请先选择要编辑的任务', 'error', 3000);
        return;
    }

    const panel = document.getElementById('batch-edit-panel');
    panel.classList.add('open');

    document.getElementById('batch-selected-count').textContent = state.selectedTasks.size;

    // 填充字段选择下拉框
    const select = document.getElementById('batch-field-select');
    select.innerHTML = '<option value="">请选择字段</option>';

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
        showToast('请选择要修改的字段', 'error', 3000);
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

    showToast(`已成功修改 ${updateCount} 个任务`, 'success');
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
            inputHTML = `<input type="text" class="form-control" placeholder="请输入${field.label}">`;
        } else if (field.type === 'number') {
            inputHTML = `<input type="number" class="form-control" placeholder="请输入${field.label}">`;
        } else if (field.type === 'select') {
            inputHTML = `<select class="form-control"><option value="">请选择</option>`;
            field.options.forEach(option => {
                inputHTML += `<option value="${option}">${option}</option>`;
            });
            inputHTML += `</select>`;
        } else if (field.type === 'multiselect') {
            inputHTML = `<select class="form-control" multiple style="min-height: 100px;">`;
            field.options.forEach(option => {
                inputHTML += `<option value="${option}">${option}</option>`;
            });
            inputHTML += `</select>`;
        }

        inputContainer.innerHTML = inputHTML;
    });
}
