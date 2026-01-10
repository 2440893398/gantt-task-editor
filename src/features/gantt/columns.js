/**
 * 甘特图列配置
 */

import { state } from '../../core/store.js';
import { renderPriorityBadge, renderStatusBadge, renderAssignee, renderProgressBar } from './templates.js';

/**
 * 更新甘特图列配置
 */
export function updateGanttColumns() {
    const columns = [];

    // Checkbox 选择列
    columns.push({
        name: "buttons",
        label: '<input type="checkbox" id="select-all-checkbox" style="cursor: pointer;">',
        width: 40,
        align: "center",
        template: function (task) {
            const checked = state.selectedTasks.has(task.id) ? "checked" : "";
            return `<input type="checkbox" class="gantt-checkbox-selection" data-task-id="${task.id}" ${checked} style="cursor: pointer;">`;
        }
    });

    state.fieldOrder.forEach(fieldName => {
        if (fieldName === "text") {
            columns.push({ name: "text", label: "任务名称", tree: true, width: 200, resize: true });
        } else if (fieldName === "start_date") {
            columns.push({ name: "start_date", label: "开始时间", align: "center", width: 90, resize: true });
        } else if (fieldName === "duration") {
            columns.push({ name: "duration", label: "工期(天)", align: "center", width: 80, resize: true });
        } else if (fieldName === "progress") {
            columns.push({
                name: "progress", label: "进度", align: "center", width: 120, resize: true,
                template: function (task) {
                    return renderProgressBar(task);
                }
            });
        } else {
            const customField = state.customFields.find(f => f.name === fieldName);
            if (customField) {
                let templateFn;
                if (fieldName === 'priority') {
                    templateFn = function (task) {
                        return renderPriorityBadge(task[fieldName]);
                    };
                } else if (fieldName === 'status') {
                    templateFn = function (task) {
                        return renderStatusBadge(task[fieldName]);
                    };
                } else if (fieldName === 'assignee') {
                    templateFn = function (task) {
                        return renderAssignee(task[fieldName]);
                    };
                } else {
                    templateFn = function (task) {
                        return task[fieldName] || '';
                    };
                }

                columns.push({
                    name: fieldName,
                    label: customField.label,
                    align: "center",
                    width: customField.width || 100,
                    resize: true,
                    template: templateFn
                });
            }
        }
    });

    columns.push({ name: "add", label: "", width: 44 });

    gantt.config.columns = columns;

    if (gantt.$container) {
        gantt.render();
    }
}
