/**
 * 甘特图列配置
 */

import { state, isFieldEnabled } from '../../core/store.js';
import { INTERNAL_FIELDS } from '../../data/fields.js';
import { renderPriorityBadge, renderStatusBadge, renderAssignee, renderProgressBar } from './templates.js';
import { extractPlainText, escapeAttr } from '../../utils/dom.js';

/**
 * 获取本地化的列名称
 * @param {string} key - 列名键
 * @returns {string} 本地化的列名称
 */
function getColumnLabel(key) {
    // 如果 i18n 可用，使用本地化文本
    if (window.i18n && typeof window.i18n.t === 'function') {
        const translated = window.i18n.t(`columns.${key}`);
        // 如果翻译键不存在会返回键本身，则使用默认值
        if (translated !== `columns.${key}`) {
            return translated;
        }
    }
    // 默认中文
    const defaults = {
        text: '任务名称',
        start_date: '开始时间',
        duration: '工期(天)',
        progress: '进度',
        priority: '优先级',
        assignee: '负责人',
        status: '状态',
        summary: '概述'  // F-112
    };
    return defaults[key] || key;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 构建摘要单元格 HTML
 * @param {string} summaryHtml
 * @param {object} options
 * @param {string} options.emptyText
 * @returns {string}
 */
export function buildSummaryCell(summaryHtml, { emptyText = '-' } = {}) {
    const plainText = extractPlainText(summaryHtml || '');
    if (!plainText) {
        return `<span class="text-base-content/40 text-xs italic">${escapeHtml(emptyText)}</span>`;
    }

    const truncated = plainText.length > 50 ? `${plainText.substring(0, 50)}...` : plainText;
    return `
        <div class="gantt-summary-cell cursor-pointer" data-summary-html="${escapeAttr(summaryHtml || '')}">
            <span class="line-clamp-1 text-sm">${escapeHtml(truncated)}</span>
        </div>
    `;
}

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

    // Filter out disabled system fields and internal fields
    const visibleFields = state.fieldOrder.filter(fieldName => {
        if (INTERNAL_FIELDS.includes(fieldName)) return false;
        return isFieldEnabled(fieldName);
    });

    visibleFields.forEach(fieldName => {
        if (fieldName === "text") {
            columns.push({ name: "text", label: getColumnLabel("text"), tree: true, width: 200, resize: true });
        } else if (fieldName === "start_date") {
            columns.push({ name: "start_date", label: getColumnLabel("start_date"), align: "center", width: 90, resize: true });
        } else if (fieldName === "duration") {
            columns.push({ name: "duration", label: getColumnLabel("duration"), align: "center", width: 80, resize: true });
        } else if (fieldName === "progress") {
            columns.push({
                name: "progress", label: getColumnLabel("progress"), align: "center", width: 120, resize: true,
                template: function (task) {
                    return renderProgressBar(task);
                }
            });
        } else if (fieldName === "summary") {
            // F-112: 任务概述字段 - 纯文本显示 + 悬停弹窗
            columns.push({
                name: "summary",
                label: getColumnLabel("summary"),
                width: 200,
                resize: true,
                template: function (task) {
                    const emptyText = window.i18n?.t('summary.empty') || '无摘要';
                    return buildSummaryCell(task.summary || '', { emptyText });
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

                // 使用本地化列名，优先使用翻译，其次使用customField.label
                const label = getColumnLabel(fieldName);

                columns.push({
                    name: fieldName,
                    label: label,
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
