/**
 * 任务详情面板 - 右侧属性面板 v2.0
 * 包含：状态、负责人、优先级、排期、工时、自定义字段
 */

import { i18n } from '../../utils/i18n.js';
import { state, isFieldEnabled, getFieldType } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { escapeAttr } from '../../utils/dom.js';

// 系统默认字段 - 这些字段在面板中有固定展示位置，不应在自定义字段区域重复显示
const SYSTEM_FIELDS = [
    'text', 'priority', 'assignee', 'status', 'summary', 'description',
    'start_date', 'end_date', 'duration', 'progress',
    'actual_start', 'actual_end', 'actual_hours', 'estimated_hours',
    'parent', 'id', 'open', 'type', 'render', '$level', '$open', '$virtual'
];

// 状态配置
const STATUS_CONFIG = [
    { value: 'in_progress', color: 'primary', icon: '●' },
    { value: 'pending', color: 'base-300', icon: '○' },
    { value: 'completed', color: 'success', icon: '●' },
    { value: 'suspended', color: 'error', icon: '●' }
];

// 优先级配置
const PRIORITY_CONFIG = {
    high: { color: 'error', label: 'High' },
    medium: { color: 'warning', label: 'Medium' },
    low: { color: 'info', label: 'Low' }
};

/**
 * 渲染右侧属性面板
 * @param {Object} task - 任务对象
 * @returns {string} HTML 字符串
 */
export function renderRightSection(task) {
    // Check which sections should be visible based on field enabled status
    const showStatus = isFieldEnabled('status');
    const showDuration = isFieldEnabled('duration');
    const showActualHours = isFieldEnabled('actual_hours');

    // Show workload section if any of its fields are enabled
    const showWorkloadSection = showDuration || showActualHours;

    return `
        <!-- 状态选择器 - 更紧凑 -->
        ${showStatus ? `
        <div class="mb-3">
            ${renderStatusSelect(task.status)}
        </div>
        ` : ''}

        <!-- 基本属性 -->
        <div class="space-y-4">
            ${renderAssigneeField(task)}
            ${renderPriorityRow(task.priority)}
        </div>

        <!-- 排期区块 -->
        <div class="border-t border-base-200/50 pt-3 mt-3">
            <h4 class="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wider">
                ${i18n.t('taskDetails.schedule') || '排期'}
            </h4>
            <div class="space-y-4">
                ${renderDateRow('start-date', i18n.t('taskDetails.planStart') || '开始', formatDateValue(task.start_date), 'calendar')}
                ${renderDateRow('end-date', i18n.t('taskDetails.planEnd') || '截止', formatDateValue(getEndDate(task)), 'calendar-check')}
            </div>
        </div>

        <!-- 工时区块 -->
        ${showWorkloadSection ? `
        <div class="border-t border-base-200/50 pt-3 mt-3">
            <h4 class="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wider">
                ${i18n.t('taskDetails.workload') || '工时'}
            </h4>
            <div class="space-y-4">
                ${showDuration ? renderWorkloadRow('duration', i18n.t('taskDetails.estimatedHours') || '预计', task.duration || task.estimated_hours, i18n.t('taskDetails.dayUnit') || '天') : ''}
                ${showActualHours ? renderWorkloadRow('actual-hours', i18n.t('taskDetails.actualHours') || '实际', task.actual_hours, i18n.t('taskDetails.dayUnit') || '天', true) : ''}
            </div>
        </div>
        ` : ''}

        <!-- 自定义字段区块 -->
        ${renderCustomFieldsSection(task)}

        <!-- 添加字段按钮 -->
        <div class="pt-3 mt-3">
            <button type="button" id="add-field-btn"
                    class="btn btn-ghost btn-xs w-full justify-center gap-1.5
                           text-base-content/50 border border-dashed border-base-300/50
                           hover:border-primary/50 hover:text-primary transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                ${i18n.t('taskDetails.addField') || '添加字段'}
            </button>
        </div>
    `;
}

/**
 * 绑定右侧区域事件
 * @param {HTMLElement} panel - 面板元素
 * @param {Object} task - 任务对象
 */
export function bindRightSectionEvents(panel, task) {
    // 状态选择 (自定义下拉)
    bindDropdown(panel, 'task-status', (value) => {
        task.status = value;
        gantt.updateTask(task.id);
        showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
    });

    // 负责人
    const assigneeFieldType = getFieldType('assignee');
    const assigneeInput = panel.querySelector('[data-field="assignee"]');
    if (assigneeInput) {
        const handler = () => {
            let newValue = '';
            if (assigneeFieldType === 'multiselect') {
                newValue = Array.from(assigneeInput.selectedOptions || []).map(opt => opt.value).join(',');
            } else {
                newValue = assigneeInput.value;
            }
            if (task.assignee !== newValue) {
                task.assignee = newValue;
                gantt.updateTask(task.id);
            }
        };
        const eventName = assigneeFieldType === 'text' ? 'blur' : 'change';
        assigneeInput.addEventListener(eventName, handler);
    }

    // 优先级 (自定义下拉)
    bindDropdown(panel, 'task-priority', (value) => {
        task.priority = value;
        gantt.updateTask(task.id);
        showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
    });

    // 日期字段
    bindDateInput(panel, '#task-start-date', task, 'start_date');
    bindDateInput(panel, '#task-end-date', task, 'end_date', true);
    bindDateInput(panel, '#task-actual-start', task, 'actual_start');
    bindDateInput(panel, '#task-actual-end', task, 'actual_end');

    // 工时字段
    const durationInput = panel.querySelector('#task-duration-input');
    if (durationInput) {
        durationInput.addEventListener('blur', () => {
            const value = parseFloat(durationInput.value);
            if (!isNaN(value) && value > 0) {
                task.duration = value;
                task.estimated_hours = value;
                gantt.updateTask(task.id);
            }
        });
    }

    const actualHoursInput = panel.querySelector('#task-actual-hours-input');
    if (actualHoursInput) {
        actualHoursInput.addEventListener('blur', () => {
            const value = parseFloat(actualHoursInput.value);
            if (!isNaN(value) && value >= 0) {
                task.actual_hours = value;
                gantt.updateTask(task.id);
            }
        });
    }

    // 添加字段按钮
    const addFieldBtn = panel.querySelector('#add-field-btn');
    if (addFieldBtn) {
        addFieldBtn.addEventListener('click', () => {
            // 打开字段管理
            if (typeof window.openFieldManagementPanel === 'function') {
                window.openFieldManagementPanel();
            } else {
                showToast(i18n.t('message.featureNotReady') || '功能开发中', 'info');
            }
        });
    }

    // 绑定自定义字段事件
    bindCustomFieldEvents(panel, task);
}

/**
 * 绑定自定义字段事件
 */
function bindCustomFieldEvents(panel, task) {
    if (!state.customFields || state.customFields.length === 0) return;

    // 过滤掉系统字段
    const userCustomFields = state.customFields.filter(
        field => !SYSTEM_FIELDS.includes(field.name)
    );

    userCustomFields.forEach(field => {
        const element = panel.querySelector(`#custom-field-${field.name}`);
        if (!element) return;

        if (field.type === 'select') {
            element.addEventListener('change', () => {
                task[field.name] = element.value;
                gantt.updateTask(task.id);
                showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
            });
        } else {
            element.addEventListener('blur', () => {
                let newValue = element.value;

                // 类型转换
                if (field.type === 'number') {
                    newValue = newValue ? parseFloat(newValue) : null;
                } else if (field.type === 'date') {
                    newValue = newValue ? new Date(newValue) : null;
                } else if (field.type === 'multiselect') {
                    newValue = newValue ? newValue.split(',').map(s => s.trim()).filter(Boolean) : [];
                }

                if (task[field.name] !== newValue) {
                    task[field.name] = newValue;
                    gantt.updateTask(task.id);
                    showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
                }
            });
        }
    });
}

/**
 * 渲染状态选择器（带彩色圆点）
 */
function renderStatusSelect(currentStatus) {
    const options = STATUS_CONFIG.map(s => ({
        value: s.value,
        label: i18n.t(`enums.status.${s.value}`) || s.value,
        color: s.color,
        icon: s.icon
    }));

    const renderLabel = (opt) => `
        <span class="w-2.5 h-2.5 rounded-full bg-${opt.color} shadow-sm"></span>
        <span class="font-medium">${opt.label}</span>
    `;

    return renderDropdownHTML('task-status', options, currentStatus, renderLabel, '选择状态');
}

/**
 * 渲染属性行
 */
function renderPropertyRow(id, label, value, iconType, { required = false, system = false, disabled = false } = {}) {
    const iconSvg = getPropertyIcon(iconType);
    const displayValue = value || '';
    const requiredMark = required ? '<span class="text-error text-xs">*</span>' : '';
    const systemBadge = system ? `<span class="badge badge-sm badge-ghost" data-i18n="taskDetails.systemField">${i18n.t('taskDetails.systemField') || '系统'}</span>` : '';
    const disabledText = disabled ? `<div class="text-xs text-base-content/60 mt-1" data-i18n="taskDetails.fieldDisabled">${i18n.t('taskDetails.fieldDisabled') || '此字段已禁用'}</div>` : '';
    const inputClass = disabled ? 'input input-bordered input-sm w-28 text-right input-disabled' : 'input input-bordered input-sm w-28 text-right';
    const disabledAttr = disabled ? 'disabled' : '';

    return `
        <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                ${iconSvg}
                <span>${label}</span>
                ${requiredMark}
                ${systemBadge}
            </div>
            <div class="flex flex-col items-end">
                <input type="text" 
                       id="task-${id}-input" 
                       class="${inputClass}" 
                       value="${escapeHtml(displayValue)}" 
                       placeholder="-" 
                       ${disabledAttr} />
                ${disabledText}
            </div>
        </div>
    `;
}

/**
 * 渲染负责人字段（根据字段类型动态输出）
 */
export function renderAssigneeField(task) {
    const fieldType = getFieldType('assignee');
    const fieldLabel = i18n.t('taskDetails.assignee') || '负责人';
    const isDisabled = !isFieldEnabled('assignee');
    const isSystemField = true;
    const isRequired = true;
    const value = task.assignee || '';

    const fieldDef = state.customFields.find(f => f.name === 'assignee');
    const options = fieldDef?.options || [];

    const requiredMark = isRequired ? '<span class="text-error text-xs">*</span>' : '';
    const systemBadge = isSystemField ? `<span class="badge badge-sm badge-ghost" data-i18n="taskDetails.systemField">${i18n.t('taskDetails.systemField') || '系统'}</span>` : '';
    const disabledText = isDisabled ? `<div class="text-xs text-base-content/60 mt-1" data-i18n="taskDetails.fieldDisabled">${i18n.t('taskDetails.fieldDisabled') || '此字段已禁用'}</div>` : '';
    const disabledAttr = isDisabled ? 'disabled' : '';

    let inputHtml = '';

    if (fieldType === 'select') {
        inputHtml = `
            <select class="select select-bordered w-full"
                    data-field="assignee"
                    ${disabledAttr}>
                <option value="">-</option>
                ${options.map(opt => {
                    const optValue = escapeAttr(opt);
                    const optLabel = escapeHtml(opt);
                    const selected = value === opt ? 'selected' : '';
                    return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
                }).join('')}
            </select>
        `;
    } else if (fieldType === 'multiselect') {
        const selectedValues = value ? value.split(',').map(v => v.trim()) : [];
        inputHtml = `
            <select class="select select-bordered w-full"
                    data-field="assignee"
                    multiple
                    ${disabledAttr}>
                ${options.map(opt => {
                    const optValue = escapeAttr(opt);
                    const optLabel = escapeHtml(opt);
                    const selected = selectedValues.includes(opt) ? 'selected' : '';
                    return `<option value="${optValue}" ${selected}>${optLabel}</option>`;
                }).join('')}
            </select>
        `;
    } else {
        inputHtml = `
            <input type="text"
                   class="input input-bordered w-full"
                   value="${escapeHtml(value)}"
                   data-field="assignee"
                   ${disabledAttr}>
        `;
    }

    return `
        <div class="form-control mb-4">
            <label class="label">
                <span class="label-text">${fieldLabel}</span>
                <span class="flex gap-2 items-center">
                    ${requiredMark}
                    ${systemBadge}
                </span>
            </label>
            ${inputHtml}
            ${disabledText}
        </div>
    `;
}

/**
 * 渲染优先级行
 */
function renderPriorityRow(currentPriority) {
    const label = i18n.t('taskDetails.priority') || '优先级';
    const requiredMark = '<span class="text-error text-xs">*</span>';
    const systemBadge = `<span class="badge badge-sm badge-ghost" data-i18n="taskDetails.systemField">${i18n.t('taskDetails.systemField') || '系统'}</span>`;

    const options = Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => ({
        value,
        label: i18n.t(`enums.priority.${value}`) || cfg.label,
        colorClass: getPriorityColorClass(value)
    }));

    const renderLabel = (opt) => `
        <span class="${opt.colorClass ? `px-2 py-0.5 rounded text-xs ${opt.colorClass}` : ''}">
            ${opt.label}
        </span>
    `;

    return `
        <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                <span>${label}</span>
                ${requiredMark}
                ${systemBadge}
            </div>
            <div class="w-28">
                ${renderDropdownHTML('task-priority', options, currentPriority, renderLabel, '-', true)}
            </div>
        </div>
    `;
}

function getPriorityColorClass(priority) {
    const priorityColors = {
        high: 'bg-error/15 text-error border border-error/20',
        medium: 'bg-warning/15 text-warning border border-warning/20',
        low: 'bg-info/15 text-info border border-info/20'
    };
    return priorityColors[priority] || 'text-base-content/70';
}

/**
 * 渲染日期行
 */
function renderDateRow(id, label, value, iconType, isOptional = false) {
    const displayText = value || (isOptional ? (i18n.t('taskDetails.notStarted') || '未开始') : '-');
    const valueClass = value ? 'text-base-content' : 'text-base-content/40';
    const iconSvg = getDateIcon(iconType);
    const inputId = `task-${id}`;
    const quickLabel = i18n.t('taskDetails.quickDate') || '今天';

    return `
        <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                ${iconSvg}
                <span>${label}</span>
            </div>
            <div class="text-sm ${valueClass} flex items-center gap-1">
                <input type="date"
                       id="${inputId}"
                       class="input input-bordered input-sm w-32 text-right"
                       value="${value || ''}"
                       placeholder="${displayText}" />
                <button type="button"
                        class="btn btn-xs btn-ghost"
                        data-quick-date="${inputId}">
                    ${quickLabel}
                </button>
            </div>
        </div>
    `;
}

/**
 * 渲染工时行
 */
function renderWorkloadRow(id, label, value, unit, isOptional = false) {
    const displayValue = value !== undefined && value !== null ? value : '';
    const placeholder = isOptional ? '0' : '-';
    const valueClass = value ? 'text-base-content' : 'text-base-content/40';

    return `
        <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>${label}</span>
            </div>
            <div class="text-sm ${valueClass} flex items-center gap-1">
                <input type="number" 
                       id="task-${id}-input" 
                       class="input input-bordered input-sm w-20 text-right" 
                       value="${displayValue}" 
                       step="0.5" 
                       min="0" 
                       placeholder="${placeholder}" />
                <span class="text-base-content/60">${unit}</span>
            </div>
        </div>
    `;
}

/**
 * 渲染自定义字段区块
 */
function renderCustomFieldsSection(task) {
    if (!state.customFields || state.customFields.length === 0) {
        return '';
    }

    // 过滤掉系统字段，只显示真正的用户自定义字段
    const userCustomFields = state.customFields.filter(
        field => !SYSTEM_FIELDS.includes(field.name)
    );

    if (userCustomFields.length === 0) {
        return '';
    }

    let html = `
        <div class="border-t border-base-200 pt-4 mt-4" id="custom-fields-section">
            <h4 class="text-xs font-medium text-base-content/60 mb-3 uppercase tracking-wider">
                ${i18n.t('taskDetails.customFields') || '自定义字段'}
            </h4>
    `;

    userCustomFields.forEach(field => {
        const icon = field.icon || '📝';
        const value = task[field.name] || '';
        const fieldId = `custom-field-${field.name}`;

        html += `
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center gap-2 text-sm text-base-content/70">
                    <span>${icon}</span>
                    <span>${field.label}</span>
                </div>
                <div class="text-sm text-base-content">
                    ${renderCustomFieldInput(field, value, fieldId)}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

/**
 * 渲染自定义字段输入控件
 */
function renderCustomFieldInput(field, value, fieldId) {
    // 通用输入样式
    const inputBaseClass = `
        h-7 min-h-0 px-2 text-right text-sm
        bg-transparent hover:bg-base-200/50
        border border-transparent hover:border-base-300/50
        rounded-md
        focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30
        transition-all duration-200
    `.trim();

    switch (field.type) {
        case 'select':
            const options = (field.options || []).map(opt => {
                const optValue = typeof opt === 'string' ? opt : opt.value;
                const optLabel = field.i18nKey
                    ? (i18n.t(`${field.i18nKey}.${optValue}`) !== `${field.i18nKey}.${optValue}`
                        ? i18n.t(`${field.i18nKey}.${optValue}`)
                        : optValue)
                    : (typeof opt === 'string' ? opt : opt.label || opt.value);
                const selected = value === optValue ? 'selected' : '';
                return `<option value="${escapeHtml(optValue)}" ${selected}>${escapeHtml(optLabel)}</option>`;
            }).join('');
            return `
                <div class="relative">
                    <select id="${fieldId}" data-field="${field.name}"
                            class="select h-7 min-h-0 px-2 pr-6
                                   bg-transparent hover:bg-base-200/50
                                   border border-transparent hover:border-base-300/50
                                   rounded-md text-sm text-right
                                   focus:outline-none focus:ring-2 focus:ring-primary/20
                                   transition-all duration-200 cursor-pointer
                                   appearance-none">
                        <option value="">-</option>
                        ${options}
                    </select>
                    <div class="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path d="M19 9l-7 7-7-7"/>
                        </svg>
                    </div>
                </div>
            `;

        case 'multiselect':
            return `
                <input type="text" id="${fieldId}" data-field="${field.name}"
                       class="${inputBaseClass} w-28"
                       value="${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}"
                       placeholder="-" />
            `;

        case 'number':
            return `
                <input type="number" id="${fieldId}" data-field="${field.name}"
                       class="${inputBaseClass} w-20"
                       value="${value !== undefined && value !== null ? value : ''}"
                       placeholder="-" />
            `;

        case 'date':
            const dateValue = value ? formatDateValue(new Date(value)) : '';
            return `
                <input type="date" id="${fieldId}" data-field="${field.name}"
                       class="${inputBaseClass} w-32"
                       value="${dateValue}" />
            `;

        case 'text':
        default:
            return `
                <input type="text" id="${fieldId}" data-field="${field.name}"
                       class="${inputBaseClass} w-28"
                       value="${escapeHtml(value)}"
                       placeholder="-" />
            `;
    }
}

/**
 * 绑定日期输入事件
 */
function bindDateInput(panel, selector, task, fieldName, isEndDate = false) {
    const input = panel.querySelector(selector);
    if (!input) return;

    const quickBtn = panel.querySelector(`[data-quick-date="${input.id}"]`);
    if (quickBtn) {
        quickBtn.addEventListener('click', () => {
            const today = new Date();
            const iso = today.toISOString().split('T')[0];
            input.value = iso;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    input.addEventListener('change', () => {
        const dateValue = new Date(input.value);
        if (isNaN(dateValue.getTime())) return;

        if (isEndDate) {
            // 计算工期
            const startDate = task.start_date;
            if (startDate) {
                const duration = Math.ceil((dateValue - startDate) / (1000 * 60 * 60 * 24));
                if (duration > 0) {
                    task.duration = duration;
                }
            }
        } else {
            task[fieldName] = dateValue;
        }

        if ((fieldName === 'actual_start' || fieldName === 'actual_end') && !validateDateRange(task)) {
            return;
        }

        gantt.updateTask(task.id);
    });
}

/**
 * 验证实际日期范围
 * @param {Object} task
 * @returns {boolean}
 */
export function validateDateRange(task) {
    if (task.actual_start && task.actual_end) {
        const startDate = new Date(task.actual_start);
        const endDate = new Date(task.actual_end);
        if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && startDate > endDate) {
            showToast(i18n.t('taskDetails.dateRangeError') || '实际开始时间不能晚于实际结束时间', 'warning');
            return false;
        }
    }
    return true;
}

/**
 * 获取属性图标
 */
function getPropertyIcon(type) {
    const icons = {
        user: '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        flag: '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>'
    };
    return icons[type] || icons.user;
}

/**
 * 获取日期图标
 */
function getDateIcon(type) {
    const icons = {
        calendar: '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        'calendar-check': '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>',
        play: '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
        stop: '<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>'
    };
    return icons[type] || icons.calendar;
}

/**
 * 格式化日期值为 YYYY-MM-DD
 */
function formatDateValue(date) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

/**
 * 获取结束日期
 */
function getEndDate(task) {
    if (task.end_date) return task.end_date;
    if (task.start_date && task.duration) {
        const start = new Date(task.start_date);
        start.setDate(start.getDate() + task.duration);
        return start;
    }
    return null;
}

/**
 * 渲染下拉组件 HTML
 * @param {string} id - 组件ID前缀
 * @param {Array} options - 选项数组
 * @param {string} currentValue - 当前值
 * @param {Function} renderLabelFn - 标签渲染函数
 * @param {string} placeholder - 占位符
 * @param {boolean} isCompact - 是否紧凑模式
 */
function renderDropdownHTML(id, options, currentValue, renderLabelFn, placeholder = '-', isCompact = false) {
    const selected = options.find(o => o.value === currentValue);
    const labelContent = selected ? renderLabelFn(selected) : `<span class="text-base-content/50">${placeholder}</span>`;

    const wrapperClass = isCompact
        ? "custom-dropdown relative group right-align" // Priority uses right-align
        : "custom-dropdown relative group w-full";

    const triggerClass = isCompact
        ? "flex items-center justify-end gap-1 px-2 py-1 text-sm hover:bg-base-200 rounded cursor-pointer transition-colors"
        : "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm bg-base-200/50 hover:bg-base-200 border border-transparent hover:border-base-300/50 rounded-lg transition-all cursor-pointer";

    return `
    <div class="${wrapperClass}" id="${id}-wrapper">
        <div id="${id}-trigger" class="${triggerClass}" tabindex="0">
            <div class="flex items-center gap-2 overflow-hidden justify-end">
                ${labelContent}
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-base-content/40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 9l-7 7-7-7"/></svg>
        </div>
        <div id="${id}-menu" class="hidden absolute top-full ${isCompact ? 'right-0 w-32' : 'left-0 right-0'} mt-1 p-1 
                                    bg-base-100 rounded-lg shadow-xl border border-base-200 
                                    z-50 max-h-60 overflow-y-auto transform origin-top transition-all">
            ${options.map(opt => `
                <div class="dropdown-item flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer hover:bg-base-200 text-sm ${opt.value === currentValue ? 'bg-primary/10 text-primary' : 'text-base-content'}" data-value="${opt.value}">
                    ${renderLabelFn(opt)}
                </div>
            `).join('')}
        </div>
    </div>
    `;
}

/**
 * 绑定自定义下拉组件事件
 */
function bindDropdown(panel, id, onSelect) {
    const wrapper = panel.querySelector(`#${id}-wrapper`);
    const trigger = panel.querySelector(`#${id}-trigger`);
    const menu = panel.querySelector(`#${id}-menu`);

    if (!wrapper || !trigger || !menu) return;

    // Toggle
    const toggle = (e) => {
        if (e) e.stopPropagation();

        // 关闭面板内其他所有打开的下拉
        panel.querySelectorAll('.custom-dropdown .block').forEach(el => {
            if (el !== menu) {
                el.classList.add('hidden');
                el.classList.remove('block');
            }
        });

        menu.classList.toggle('hidden');
        menu.classList.toggle('block');
    };

    trigger.addEventListener('click', toggle);
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });

    // Selection
    menu.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = item.dataset.value;
            onSelect(value);
            menu.classList.add('hidden');
            menu.classList.remove('block');

            // Update Trigger UI
            const selectedContent = item.innerHTML;
            const contentDiv = trigger.querySelector('div');
            if (contentDiv) contentDiv.innerHTML = selectedContent;

            // Highlight selected item
            menu.querySelectorAll('.dropdown-item').forEach(i => {
                i.classList.remove('bg-primary/10', 'text-primary');
                i.classList.add('text-base-content');
            });
            item.classList.remove('text-base-content');
            item.classList.add('bg-primary/10', 'text-primary');
        });
    });

    // Close on click outside (document level)
    const closeHandler = (e) => {
        if (!wrapper.contains(e.target)) {
            menu.classList.add('hidden');
            menu.classList.remove('block');
        }
    };

    // Check if we already attach a global listener to document?
    // It's safer to attach it once. But here we might attach multiple times if we open multiple panels?
    // Panel is modal, so we can attach to document. But we need to remove it when panel closes?
    // Since we don't have a destroy hook here effortlessly, we can just let it be or attach to panel click?
    // Panel click works if overlay covers everything.
    // Ideally, `closeHandler` should be removed.
    // For now, we rely on the fact that `bindDropdown` is called when panel opens.
    // We can attach `click` to document body.
    // To avoid leaks, we can check if the element still exists.
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 0);
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
