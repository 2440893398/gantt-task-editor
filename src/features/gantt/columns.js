/**
 * 甘特图列配置
 */

import { state, isFieldEnabled, getViewMode } from '../../core/store.js';
import { INTERNAL_FIELDS, SYSTEM_FIELD_CONFIG } from '../../data/fields.js';

import { renderPriorityBadge, renderStatusBadge, renderAssignee, renderProgressBar } from './templates.js';
import { extractPlainText, escapeAttr } from '../../utils/dom.js';
import { formatDuration, exclusiveToInclusive, isDayPrecision } from '../../utils/time-formatter.js';
import { applySavedColumnWidths, loadColumnWidthPrefs } from './column-widths.js';
import { buildNewTaskPayload, getTaskByAnyId } from './new-task-payload.js';
import { i18n } from '../../utils/i18n.js';
import { showConfirmDialog } from '../../components/common/confirm-dialog.js';
import { showToast } from '../../utils/toast.js';

let taskActionHandlersBound = false;

const TASK_ACTION_ICONS = {
    addChild: '<svg class="gantt-task-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
    edit: '<svg class="gantt-task-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.7 2.3a1 1 0 0 1 1.4 0l.6.6a1 1 0 0 1 0 1.4l-7.7 7.7-2.8.8.8-2.8zM9.9 4.1l2 2"/></svg>',
    delete: '<svg class="gantt-task-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4.5h9M6.2 4.5V3.2h3.6v1.3M5.2 6.2v5.6M8 6.2v5.6M10.8 6.2v5.6M4.8 4.5l.6 8.5h5.2l.6-8.5"/></svg>'
};

/**
 * 获取本地化的列名称
 * @param {string} key - 列名键
 * @param {string} [customFieldLabel] - 自定义字段的标签（可选）
 * @returns {string} 本地化的列名称
 */
function getColumnLabel(key, customFieldLabel = null) {
    // 如果 i18n 可用，使用本地化文本
    if (window.i18n && typeof window.i18n.t === 'function') {
        const translated = window.i18n.t(`columns.${key}`);
        // 如果翻译键不存在会返回键本身，则使用默认值
        if (translated !== `columns.${key}`) {
            return translated;
        }
    }

    // 自定义字段标签兜底
    if (customFieldLabel) {
        return customFieldLabel;
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
        description: '描述'
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

const RICH_TEXT_PREVIEW_LIMIT = 40;

function hasHtmlMarkup(value) {
    return /<\s*\/?\s*[a-z][^>]*>/i.test(String(value || ''));
}

function richContentScore(value) {
    const content = String(value || '');
    if (!content.trim()) return -1;

    let score = 0;

    if (hasHtmlMarkup(content)) score += 100;
    if (/<\s*(p|div|ul|ol|li|blockquote|pre|h[1-6]|br)\b/i.test(content)) score += 400;
    if (/<\s*(strong|b|em|i|u|s|code|span)\b/i.test(content)) score += 120;
    if (/&lt;\s*\/?\s*(p|div|ul|ol|li|blockquote|pre|h[1-6]|br)\b/i.test(content)) score += 300;
    if (/\n/.test(content)) score += 20;

    score += Math.min(content.length, 2000) / 2000;

    return score;
}

function resolveRichTextField(task, preferredField) {
    const candidateFields = Array.from(new Set([
        preferredField,
        preferredField === 'summary' ? 'description' : 'summary',
        preferredField === 'description' ? 'summary' : 'description'
    ]));

    let bestField = preferredField;
    let bestHtml = String(task?.[preferredField] || '');
    let bestScore = richContentScore(bestHtml);

    candidateFields.forEach((field) => {
        const value = String(task?.[field] || '');
        const score = richContentScore(value);
        if (score > bestScore) {
            bestScore = score;
            bestField = field;
            bestHtml = value;
        }
    });

    return { field: bestField, html: bestHtml };
}

function truncatePlainText(text, maxLength = RICH_TEXT_PREVIEW_LIMIT) {
    const safeText = String(text || '').trim();
    if (safeText.length <= maxLength) return safeText;
    return `${safeText.slice(0, maxLength)}...`;
}

function renderRichTextPreviewCell(task, preferredField) {
    const { field, html } = resolveRichTextField(task, preferredField);

    if (!html) {
        return '<span class="text-base-content/40 text-xs italic">—</span>';
    }

    const plainText = extractPlainText(html);
    if (!plainText) {
        return '<span class="text-base-content/40 text-xs italic">—</span>';
    }

    const truncated = truncatePlainText(plainText);
    return `<div class="gantt-summary-cell gantt-richtext-cell cursor-pointer"
                 data-task-id="${escapeAttr(task?.id)}"
                 data-rich-field="${escapeAttr(field)}"
                 data-full-html="${escapeAttr(html)}"
                 data-plain-text="${escapeAttr(plainText)}">
                <span class="line-clamp-1 text-sm">${escapeHtml(truncated)}</span>
            </div>`;
}

/**
 * 统一甘特表格日期显示格式
 * 优先使用 dhtmlx 的 date_grid 模板，保证 start/end 一致
 */
function formatGridDate(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    if (gantt?.templates?.date_grid) {
        return gantt.templates.date_grid(date);
    }

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function ensureTaskActionHandlersBound() {
    if (taskActionHandlersBound) return;

    document.addEventListener('click', (event) => {
        const actionBtn = event.target.closest('.gantt-task-action-btn');
        if (!actionBtn) return;

        event.preventDefault();
        event.stopPropagation();

        const taskId = actionBtn.dataset.taskId;
        const action = actionBtn.dataset.action;
        if (!taskId || !action) return;

        if (action === 'edit') {
            const task = getTaskByAnyId(gantt, taskId);
            const resolvedTaskId = task?.id ?? taskId;
            if (typeof window.openTaskDetailsPanel === 'function') {
                window.openTaskDetailsPanel(resolvedTaskId);
            }
            return;
        }

        if (action === 'add-child') {
            const parentTask = getTaskByAnyId(gantt, taskId);
            if (!parentTask) return;

            const payload = buildNewTaskPayload({
                source: 'grid-action-add-child',
                parentTaskId: parentTask.id,
                parentTask,
                parentId: parentTask.id,
                startDate: parentTask.start_date,
                text: '',
                duration: 1,
                progress: 0
            });

            if (typeof window.openNewTaskDetailsPanel === 'function') {
                window.openNewTaskDetailsPanel(payload);
                return;
            }

            if (typeof gantt.addTask === 'function') {
                const createdTaskId = gantt.addTask(payload.defaults, payload.defaults.parent);
                if (typeof window.openTaskDetailsPanel === 'function') {
                    window.openTaskDetailsPanel(createdTaskId);
                }
            }
            return;
        }

        if (action === 'quick-add') {
            const baseTask = getTaskByAnyId(gantt, taskId);
            if (!baseTask) return;

            const payload = buildNewTaskPayload({
                source: 'grid-column-add',
                parentTaskId: baseTask.parent ?? 0,
                parentId: baseTask.parent ?? 0,
                startDate: baseTask.start_date,
                text: '',
                duration: 1,
                progress: 0
            });

            if (typeof window.openNewTaskDetailsPanel === 'function') {
                window.openNewTaskDetailsPanel(payload);
                return;
            }

            if (typeof gantt.addTask === 'function') {
                const createdTaskId = gantt.addTask(payload.defaults, payload.defaults.parent);
                if (typeof window.openTaskDetailsPanel === 'function') {
                    window.openTaskDetailsPanel(createdTaskId);
                }
            }
            return;
        }

        if (action === 'delete') {
            const task = getTaskByAnyId(gantt, taskId);
            if (!task) return;

            showConfirmDialog({
                icon: 'trash-2',
                variant: 'danger',
                title: i18n.t('message.confirmDeleteTitle') || '删除任务',
                message: i18n.t('message.confirmDelete') || '确定要删除此任务吗？此操作无法撤销。',
                confirmText: i18n.t('form.delete') || '删除',
                cancelText: i18n.t('form.cancel') || '取消',
                onConfirm: () => {
                    gantt.deleteTask(task.id);
                    showToast(i18n.t('message.deleteSuccess') || '删除成功', 'success');
                }
            });
        }
    });

    taskActionHandlersBound = true;
}

function renderTaskActionsCell(task) {
    const editLabel = i18n.t('shortcuts.editTask') || '编辑';
    const addChildLabel = i18n.t('taskDetails.addSubtask') || '添加子任务';
    const deleteLabel = i18n.t('form.delete') || '删除';
    const taskId = escapeAttr(task.id);
    const shouldShowAddChild = shouldRenderAddChildAction();
    const labels = shouldShowAddChild ? `${addChildLabel}/${editLabel}/${deleteLabel}` : `${editLabel}/${deleteLabel}`;
    return `<div class="gantt-task-actions-cell" role="group" aria-label="${labels}">
        ${shouldShowAddChild
        ? `<button type="button" class="gantt-task-action-btn gantt-task-action-add-child" data-action="add-child" data-task-id="${taskId}" title="${addChildLabel}" aria-label="${addChildLabel}">${TASK_ACTION_ICONS.addChild}</button>`
        : ''}
        <button type="button" class="gantt-task-action-btn gantt-task-action-edit" data-action="edit" data-task-id="${taskId}" title="${editLabel}" aria-label="${editLabel}">${TASK_ACTION_ICONS.edit}</button>
        <button type="button" class="gantt-task-action-btn gantt-task-action-delete" data-action="delete" data-task-id="${taskId}" title="${deleteLabel}" aria-label="${deleteLabel}">${TASK_ACTION_ICONS.delete}</button>
    </div>`;
}

function shouldRenderAddChildAction() {
    if (typeof getViewMode !== 'function') return false;
    const mode = getViewMode();
    return mode === 'table' || mode === 'gantt';
}

/**
 * 更新甘特图列配置
 */
export function updateGanttColumns() {
    const columns = [];

    // Checkbox 选择列 - 宽度38px匹配设计稿
    columns.push({
        name: "buttons",
        label: '<input type="checkbox" id="select-all-checkbox" style="cursor: pointer;">',
        width: 38,
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
                width: "*",
                min_width: 240,
                resize: true,
                template: function (task) {
                    const text = task.text || '';
                    let html = '';

                    // 拖拽排序手柄（悬停时显示）
                    html += `<span class="gantt-drag-handle" title="${i18n.t('gantt.dragToReorder') || '拖动调整顺序'}">⠿</span>`;

                    // 如果是项目（父任务），添加项目编号徽章
                    if (task.type === 'project' || (task.parent === 0 && gantt.hasChild(task.id))) {
                        const projectNum = task.project_number || task.id;
                        html += `<span class="project-id-badge-gantt">#${projectNum}</span>`;
                    }

                    // Add title attribute for tooltip on hover
                    html += `<span title="${escapeAttr(text)}">${escapeHtml(text)}</span>`;
                    return html;
                }
            });
        } else if (fieldName === "start_date") {
            columns.push({
                name: "start_date",
                label: getColumnLabel("start_date"),
                align: "center",
                width: 80,
                min_width: 80,
                resize: true,
                template: function (task) {
                    const date = task.start_date;
                    if (!date) return '<span class="text-base-content/40">—</span>';
                    const formatted = formatGridDate(date);
                    return `<span title="${formatted}">${formatted}</span>`;
                }
            });
        } else if (fieldName === "duration") {
            columns.push({
                name: "duration",
                label: getColumnLabel("duration"),
                align: "center",
                width: 56,
                min_width: 56,
                resize: true,
                template: function (task) {
                    const duration = task.duration || 0;
                    const formatted = formatDuration(duration);
                    return `<span title="${formatted}">${formatted}</span>`;
                }
            });
        } else if (fieldName === "progress") {
            columns.push({
                name: "progress", label: getColumnLabel("progress"), align: "center", width: 100, min_width: 84, resize: true,
                template: function (task) {
                    return renderProgressBar(task);
                }
            });
        } else if (fieldName === "description") {
            // 描述字段：显示富文本摘要，悬浮展示完整 tooltip 预览
            columns.push({
                name: "description",
                label: getColumnLabel("description"),
                width: 100,
                min_width: 100,
                resize: true,
                template: function (task) {
                    return renderRichTextPreviewCell(task, 'description');
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
                        if (fieldName === 'description') {
                            return renderRichTextPreviewCell(task, fieldName);
                        }
                        const value = task[fieldName] || '';
                        if (!value) return '';
                        // Add title attribute for tooltip on hover
                        return `<span title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
                    };
                }

                // 使用本地化列名，优先使用翻译，其次使用customField.label
                const label = getColumnLabel(fieldName, customField.label);

                // 根据设计稿设置特定字段的宽度（紧凑模式，悬浮显示全文）
                let width = customField.width || 72;
                if (fieldName === 'priority') width = 64;
                else if (fieldName === 'assignee') width = 72;
                else if (fieldName === 'status') width = 72;

                columns.push({
                    name: fieldName,
                    label: label,
                    align: "center",
                    width: width,
                    min_width: Math.max(Math.min(width, 100), 72),
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
                    // end_date is stored as DHTMLX exclusive boundary; convert to inclusive for display
                    const isExclusiveEnd = fieldName === 'end_date';
                    templateFn = function (task) {
                        let value = task[fieldName];
                        if (!value) return '<span class="text-base-content/40">—</span>';
                        if (isExclusiveEnd) value = exclusiveToInclusive(value instanceof Date ? value : new Date(value));
                        const formatted = formatGridDate(value);
                        if (!formatted) return '<span class="text-base-content/40">—</span>';
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
                        if (fieldName === 'description') {
                            return renderRichTextPreviewCell(task, fieldName);
                        }
                        const value = task[fieldName] || '';
                        if (!value) return '';
                        return `<span title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
                    };
                }

                columns.push({
                    name: fieldName,
                    label: label,
                    align: "center",
                    width: 72,
                    min_width: 72,
                    resize: true,
                    template: templateFn
                });
            }
        }

    });

    // 添加列 - 打开草稿编辑面板（不立即创建）
    columns.push({
        name: 'quick_add',
        label: '',
        width: 44,
        min_width: 44,
        template: function (task) {
            const taskId = escapeAttr(task.id);
            const addLabel = i18n.t('taskDetails.addSubtask') || '添加';
            return `<button type="button" class="gantt-task-action-btn gantt-grid-add-btn" data-action="quick-add" data-task-id="${taskId}" title="${addLabel}" aria-label="${addLabel}">${TASK_ACTION_ICONS.addChild}</button>`;
        }
    });

    columns.push({
        name: 'actions',
        label: i18n.t('shortcuts.taskOperations') || '操作',
        align: 'center',
        width: 96,
        min_width: 96,
        resize: false,
        template: function (task) {
            return renderTaskActionsCell(task);
        }
    });

    gantt.config.columns = applySavedColumnWidths(columns, loadColumnWidthPrefs());

    if (gantt.$container) {
        ensureTaskActionHandlersBound();
        gantt.render();
    }
}

/**
 * 设置甘特纯视图的列配置（仅任务名称列，用于 gantt-only 模式）
 */
export function setGanttOnlyColumns() {
    gantt.config.columns = [
        {
            name: "text",
            label: getColumnLabel("text"),
            tree: true,
            width: "*",
            min_width: 180,
            resize: true,
            template: function (task) {
                const text = task.text || '';
                let html = '';
                if (task.type === 'project' || (task.parent === 0 && gantt.hasChild(task.id))) {
                    const projectNum = task.project_number || task.id;
                    html += `<span class="project-id-badge-gantt">#${projectNum}</span>`;
                }
                html += `<span title="${escapeAttr(text)}">${escapeHtml(text)}</span>`;
                return html;
            }
        },
        {
            name: 'actions',
            label: i18n.t('shortcuts.taskOperations') || '操作',
            align: 'center',
            width: 96,
            min_width: 96,
            resize: false,
            template: function (task) {
                return renderTaskActionsCell(task);
            }
        }
    ];

    gantt.config.columns = applySavedColumnWidths(gantt.config.columns, loadColumnWidthPrefs());

    if (gantt.$container) {
        ensureTaskActionHandlersBound();
        gantt.render();
    }
}
