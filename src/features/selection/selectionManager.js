/**
 * 选择管理器
 */

import { state } from '../../core/store.js';

/**
 * 更新选中任务的 UI
 */
export function updateSelectedTasksUI() {
    const counter = document.getElementById('selected-tasks-counter');
    const count = state.selectedTasks.size;

    if (count > 0) {
        counter.classList.add('show');
        document.getElementById('selected-count').textContent = count;
    } else {
        counter.classList.remove('show');
    }

    // 使用多个延迟时间确保样式被正确应用
    applySelectionStyles();
    setTimeout(applySelectionStyles, 50);
    setTimeout(applySelectionStyles, 150);

    // 更新全选 Checkbox 状态
    const selectAll = document.getElementById('select-all-checkbox');
    if (selectAll) {
        const allTaskIds = [];
        gantt.eachTask(task => allTaskIds.push(task.id));
        const allSelected = allTaskIds.length > 0 && allTaskIds.every(id => state.selectedTasks.has(id));
        const someSelected = allTaskIds.some(id => state.selectedTasks.has(id));

        selectAll.checked = allSelected;
        selectAll.indeterminate = someSelected && !allSelected;
    }
}

/**
 * 应用选中样式
 */
export function applySelectionStyles() {
    // 首先清除所有选中样式
    document.querySelectorAll('.gantt_row.gantt-selected').forEach(row => {
        row.classList.remove('gantt-selected');
        row.style.backgroundColor = '';
        row.style.borderLeft = '';
    });
    document.querySelectorAll('.gantt_task_row.gantt-selected').forEach(row => {
        row.classList.remove('gantt-selected');
        row.style.backgroundColor = '';
    });

    // 遍历所有选中的任务并应用样式
    state.selectedTasks.forEach(taskId => {
        // 查找左侧表格行
        const gridRows = document.querySelectorAll(`.gantt_row[task_id="${taskId}"]`);
        gridRows.forEach(row => {
            row.classList.add('gantt-selected');
            row.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
            row.style.borderLeft = '3px solid #3b82f6';
            row.style.boxSizing = 'border-box';

            // 同步复选框状态
            const checkbox = row.querySelector('.gantt-checkbox-selection');
            if (checkbox) {
                checkbox.checked = true;
            }
        });

        // 查找右侧时间轴行
        const taskRows = document.querySelectorAll(`.gantt_task_row[task_id="${taskId}"]`);
        taskRows.forEach(row => {
            row.classList.add('gantt-selected');
            row.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
        });
    });

    // 更新未选中任务的复选框状态
    gantt.eachTask(function (task) {
        if (!state.selectedTasks.has(task.id)) {
            const checkbox = document.querySelector(`.gantt-checkbox-selection[data-task-id="${task.id}"]`);
            if (checkbox) {
                checkbox.checked = false;
            }
        }
    });
}
