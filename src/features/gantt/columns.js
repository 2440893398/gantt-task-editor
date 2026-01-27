/**
 * 甘特图列配置
 */

import { state, isFieldEnabled } from '../../core/store.js';
import { INTERNAL_FIELDS, SYSTEM_FIELD_CONFIG } from '../../data/fields.js';

import { renderPriorityBadge, renderStatusBadge, renderAssignee, renderProgressBar } from './templates.js';
import { extractPlainText, escapeAttr } from '../../utils/dom.js';
import { formatDuration } from '../../utils/time-formatter.js';

/**
 * 获取本地化的列名称
 * @param {string} key - 列名键
 * @param {string} [customFieldLabel] - 自定义字段的标签（可选）
 * @returns {string} 本地化的列名称
 */
function getColumnLabel(key, customFieldLabel = null) {
    // 如果提供了自定义字段标签，优先使用
    if (customFieldLabel) {
        return customFieldLabel;
    }

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
            columns.push({
                name: "text",
                label: getColumnLabel("text"),
                tree: true,
                width: 200,
                resize: true,
                template: function (task) {
                    const text = task.text || '';
                    // Add title attribute for tooltip on hover
                    return `<span title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
                }
            });
        } else if (fieldName === "start_date") {
            columns.push({
                name: "start_date",
                label: getColumnLabel("start_date"),
                align: "center",
                width: 90,
                resize: true,
                template: function (task) {
                    const date = task.start_date;
                    if (!date) return '<span class="text-base-content/40">—</span>';
                    const formatted = gantt.templates.date_grid ? gantt.templates.date_grid(date) : date.toLocaleDateString();
                    return `<span title="${formatted}">${formatted}</span>`;
                }
            });
        } else if (fieldName === "duration") {
            columns.push({
                name: "duration",
                label: getColumnLabel("duration"),
                align: "center",
                width: 80,
                resize: true,
                template: function (task) {
                    const duration = task.duration || 0;
                    const formatted = formatDuration(duration);
                    return `<span title="${formatted}">${formatted}</span>`;
                }
            });
        } else if (fieldName === "progress") {
            columns.push({
                name: "progress", label: getColumnLabel("progress"), align: "center", width: 120, resize: true,
                template: function (task) {
                    return renderProgressBar(task);
                }
            });
        } else if (fieldName === "summary") {
            // F-112: 任务概述字段 - 省略显示 + 悬停展开
            columns.push({
                name: "summary",
                label: getColumnLabel("summary"),
                width: 200,
                resize: true,
                template: function (task) {
                    const html = task.summary || '';

                    // 空值处理
                    if (!html) {
                        return '<span class="text-base-content/40 text-xs italic">—</span>';
                    }

                    // 提取纯文本
                    const plainText = extractPlainText(html);

                    // 截断显示（最多50字符）
                    const truncated = plainText.length > 50
                        ? plainText.substring(0, 50) + '...'
                        : plainText;

                    return `<div class="gantt-summary-cell cursor-pointer"
                                 data-full-html="${escapeAttr(html)}"
                                 data-plain-text="${escapeAttr(plainText)}">
                                <span class="line-clamp-1 text-sm">${escapeHtml(truncated)}</span>
                            </div>`;
                }
            });
        } else {
            // Check if it's a custom field first
            const customField = state.customFields.find(f => f.name === fieldName);
            // Check if it's a system field
            const systemFieldConfig = SYSTEM_FIELD_CONFIG[fieldName];

            if (customField) {
                // Handle custom field (priority, status, assignee, user-defined fields)
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
                        const value = task[fieldName] || '';
                        if (!value) return '';
                        // Add title attribute for tooltip on hover
                        return `<span title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
                    };
                }

                // 使用本地化列名，优先使用翻译，其次使用customField.label
                const label = getColumnLabel(fieldName, customField.label);


                columns.push({
                    name: fieldName,
                    label: label,
                    align: "center",
                    width: customField.width || 100,
                    resize: true,
                    template: templateFn
                });
            } else if (systemFieldConfig) {
                // Handle system field (actual_start, actual_end, actual_hours, etc.)
                // Use the i18nKey from SYSTEM_FIELD_CONFIG for proper localization
                let label = fieldName;
                if (window.i18n && systemFieldConfig.i18nKey) {
                    const translated = window.i18n.t(systemFieldConfig.i18nKey);
                    if (translated !== systemFieldConfig.i18nKey) {
                        label = translated;
                    }
                }

                let templateFn;

                if (systemFieldConfig.type === 'date') {
                    // Date fields
                    templateFn = function (task) {
                        const value = task[fieldName];
                        if (!value) return '<span class="text-base-content/40">—</span>';
                        const date = new Date(value);
                        if (isNaN(date.getTime())) return '<span class="text-base-content/40">—</span>';
                        const formatted = date.toLocaleDateString();
                        return `<span title="${formatted}">${formatted}</span>`;
                    };
                } else if (systemFieldConfig.type === 'number') {
                    // Number fields
                    templateFn = function (task) {
                        const value = task[fieldName];
                        if (value === undefined || value === null) return '<span class="text-base-content/40">—</span>';
                        return `<span title="${value}">${value}</span>`;
                    };
                } else {
                    // Default: just display the value with tooltip
                    templateFn = function (task) {
                        const value = task[fieldName] || '';
                        if (!value) return '';
                        return `<span title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
                    };
                }

                columns.push({
                    name: fieldName,
                    label: label,
                    align: "center",
                    width: 100,
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
