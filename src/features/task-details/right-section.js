/**
 * 任务详情面板 - 右侧属性面板 v2.0
 * 包含：状态、负责人、优先级、排期、工时、自定义字段
 */

import { i18n } from '../../utils/i18n.js';
import { formatDuration, parseDurationInput, exclusiveToInclusive, inclusiveToExclusive, isDayPrecision } from '../../utils/time-formatter.js';
import { state, isFieldEnabled, getFieldType, getSystemFieldOptions } from '../../core/store.js';
import undoManager from '../ai/services/undoManager.js';

import { showToast } from '../../utils/toast.js';
import { escapeAttr } from '../../utils/dom.js';
import { renderSelectHTML, setupSelect } from '../../components/common/dropdown.js';

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
    const showProgress = isFieldEnabled('progress');
    const showDuration = isFieldEnabled('duration');
    const showActualHours = isFieldEnabled('actual_hours');
    const showActualStart = isFieldEnabled('actual_start');
    const showActualEnd = isFieldEnabled('actual_end');

    // Show workload section if any of its fields are enabled
    const showWorkloadSection = showDuration || showActualHours;

    // Show actual dates if enabled
    const showActualDates = showActualStart || showActualEnd;

    return `
        <!-- 状态选择器 - 更紧凑 -->
        ${showStatus ? `
        <div class="mb-3">
            ${renderStatusSelect(task.status)}
        </div>
        ` : ''}

        <!-- 基本属性 -->
        <div class="space-y-2">
            ${renderAssigneeRow(task)}
            ${renderPriorityRow(task.priority)}
            ${showProgress ? renderProgressRow(task.progress) : ''}
        </div>


        <!-- 排期区块 -->
        <div class="border-t border-base-200/50 pt-4 mt-4">
            <h4 class="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wider">
                ${i18n.t('taskDetails.schedule') || '排期'}
            </h4>
            <div class="space-y-2">
                ${renderDateRow('start-date', i18n.t('taskDetails.planStart') || '开始', formatDateValue(task.start_date), 'calendar')}
                ${renderDateRow('end-date', i18n.t('taskDetails.planEnd') || '截止', formatDateValue(exclusiveToInclusive(getEndDate(task))), 'calendar-check')}
            </div>
            ${showActualDates ? `
            <div class="mt-2 pt-2 border-t border-base-200/30 space-y-2">
                ${showActualStart ? renderDateRow('actual-start', i18n.t('taskDetails.actualStart') || '实际开始', formatDateValue(task.actual_start), 'play', true) : ''}
                ${showActualEnd ? renderDateRow('actual-end', i18n.t('taskDetails.actualEnd') || '实际结束', formatDateValue(task.actual_end), 'stop', true) : ''}
            </div>
            ` : ''}
        </div>

        <!-- 工时区块 -->
        ${showWorkloadSection ? `
        <div class="border-t border-base-200/50 pt-4 mt-4">
            <h4 class="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wider">
                ${i18n.t('taskDetails.workload') || '工时'}
            </h4>
            <div class="space-y-2">
                ${showDuration ? renderDurationRow(task) : ''}
                ${showActualHours ? renderWorkloadRow('actual-hours', i18n.t('taskDetails.actualHours') || '实际', task.actual_hours, i18n.t('taskDetails.dayUnit') || '天', true) : ''}
            </div>
        </div>
        ` : ''}
        
        <!-- 前置任务区块 -->
        ${renderDependenciesSection(task)}


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
export function bindRightSectionEvents(panel, task, context = {}) {
    const draftTask = context.draftTask || task;
    const isDraftMode = !!context.isDraftMode;
    const mutateDraft = (mutator) => {
        if (typeof context.onDraftMutated === 'function') {
            context.onDraftMutated(mutator);
            return;
        }
        if (typeof mutator === 'function') {
            mutator(draftTask);
        }
    };

    const persistIfNeeded = () => {
        if (isDraftMode) return;
        gantt.updateTask(task.id);
        showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
    };

    const saveTaskState = () => {
        if (isDraftMode) return;
        if (undoManager.isApplyingHistoryOperation()) return;
        undoManager.saveState(task.id);
    };

    // 状态选择 (自定义下拉)
    bindDropdown(panel, 'task-status', (value) => {
        const nextStatus = value;
        let nextProgress = draftTask.progress;

        // 状态 → 进度 双向同步：
        // 标记为"已完成"时，进度自动设为 100%
        // 从"已完成"改为其他状态时，若进度是 100%，重置为 0%（避免状态与进度矛盾）
        if (value === 'completed' && draftTask.progress < 1) {
            nextProgress = 1;
        } else if (value !== 'completed' && draftTask.progress >= 1) {
            nextProgress = 0;
        }

        const progressChanged = (draftTask.progress || 0) !== (nextProgress || 0);
        if (draftTask.status === nextStatus && !progressChanged) return;

        saveTaskState();
        mutateDraft((target) => {
            target.status = nextStatus;
            target.progress = nextProgress;
        });
        if (!isDraftMode) {
            task.status = nextStatus;
            task.progress = nextProgress;
        }
        persistIfNeeded();

        // 进度发生变化时刷新面板（进度条 UI 同步）
        if (progressChanged && !isDraftMode) {
            import('./panel.js').then(({ refreshTaskDetailsPanel }) => {
                refreshTaskDetailsPanel();
            });
        }
    });

    // 负责人 (支持文本或下拉)
    const assigneeType = getFieldType('assignee');
    const assigneeOptions = getSystemFieldOptions('assignee');

    if ((assigneeType === 'select' || assigneeType === 'multiselect') && assigneeOptions && assigneeOptions.length > 0) {
        // Portal 下拉模式 - 选项多时不会被父容器裁切
        const isMulti = assigneeType === 'multiselect';
        const normalizedOptions = assigneeOptions.map(opt => ({ value: opt, label: opt }));
        setupSelect('task-assignee', normalizedOptions, draftTask.assignee, (value) => {
            if (draftTask.assignee === value) return;
            saveTaskState();
            mutateDraft((target) => {
                target.assignee = value;
            });
            if (!isDraftMode) {
                task.assignee = value;
            }
            persistIfNeeded();
        }, { isMulti });
    } else {
        // Text input mode
        const assigneeInput = panel.querySelector('#task-assignee-input');
        if (assigneeInput) {
            assigneeInput.addEventListener('blur', () => {
                if (draftTask.assignee !== assigneeInput.value) {
                    saveTaskState();
                    mutateDraft((target) => {
                        target.assignee = assigneeInput.value;
                    });
                    if (!isDraftMode) {
                        task.assignee = assigneeInput.value;
                    }
                    persistIfNeeded();
                }
            });
        }
    }

    const assigneeLock = panel.querySelector('#task-parent-assignee-lock');
    if (assigneeLock) {
        assigneeLock.addEventListener('change', () => {
            const nextLocked = !!assigneeLock.checked;
            if (!!draftTask.parent_assignee_locked === nextLocked) return;
            saveTaskState();
            mutateDraft((target) => {
                target.parent_assignee_locked = nextLocked;
            });
            if (!isDraftMode) {
                task.parent_assignee_locked = nextLocked;
            }
            persistIfNeeded();
        });
    }


    // 优先级 (自定义下拉)
    bindDropdown(panel, 'task-priority', (value) => {
        if (draftTask.priority === value) return;
        saveTaskState();
        mutateDraft((target) => {
            target.priority = value;
        });
        if (!isDraftMode) {
            task.priority = value;
        }
        persistIfNeeded();
    });

    // 日期字段
    bindDateInput(panel, '#task-start-date', draftTask, 'start_date', false, { task, isDraftMode, saveTaskState, mutateDraft });
    bindDateInput(panel, '#task-end-date', draftTask, 'end_date', true, { task, isDraftMode, saveTaskState, mutateDraft });
    bindDateInput(panel, '#task-actual-start', draftTask, 'actual_start', false, { task, isDraftMode, saveTaskState, mutateDraft });
    bindDateInput(panel, '#task-actual-end', draftTask, 'actual_end', false, { task, isDraftMode, saveTaskState, mutateDraft });

    // 进度字段
    const progressInput = panel.querySelector('#task-progress-input');
    const progressSlider = panel.querySelector('#task-progress-slider');
    if (progressInput && progressSlider) {
        const updateProgress = (value) => {
            let val = parseFloat(value);
            if (isNaN(val)) val = 0;
            if (val < 0) val = 0;
            if (val > 100) val = 100;

            const nextProgress = val / 100;
            const nextStatus = val === 100
                ? 'completed'
                : (draftTask.status === 'completed' ? 'in_progress' : draftTask.status);
            if ((draftTask.progress || 0) === nextProgress && draftTask.status === nextStatus) {
                return;
            }

            saveTaskState();
            mutateDraft((target) => {
                target.progress = nextProgress;
            });
            if (!isDraftMode) {
                task.progress = nextProgress;
            }
            persistIfNeeded();

            // Sync inputs
            progressInput.value = val;
            progressSlider.value = val;

            // Auto-update status if 100%
            if (val === 100 && draftTask.status !== 'completed') {
                mutateDraft((target) => {
                    target.status = 'completed';
                });
                if (!isDraftMode) {
                    task.status = 'completed';
                    gantt.updateTask(task.id);
                    refreshTaskDetailsPanel();
                }
            } else if (val < 100 && draftTask.status === 'completed') {
                mutateDraft((target) => {
                    target.status = 'in_progress';
                });
                if (!isDraftMode) {
                    task.status = 'in_progress';
                    gantt.updateTask(task.id);
                    refreshTaskDetailsPanel();
                }
            }
        };

        progressInput.addEventListener('change', (e) => updateProgress(e.target.value));
        progressSlider.addEventListener('input', (e) => {
            progressInput.value = e.target.value;
        });
        progressSlider.addEventListener('change', (e) => updateProgress(e.target.value));
    }

    // 工时字段 (v1.5 增强：人性化提示 + 文本输入解析)
    const durationInput = panel.querySelector('#task-duration-input');
    const durationHint = panel.querySelector('#duration-hint');
    if (durationInput) {
        // 实时更新人性化提示
        durationInput.addEventListener('input', () => {
            const value = parseFloat(durationInput.value) || 0;
            if (durationHint) {
                durationHint.textContent = formatDuration(value);
            }
        });

        // 失焦时保存，支持文本输入解析（如 "4小时"、"1d 2h"）
        durationInput.addEventListener('blur', () => {
            let value = parseFloat(durationInput.value);

            // 如果不是纯数字，尝试解析文本输入
            if (isNaN(value)) {
                value = parseDurationInput(durationInput.value);
            }

            if (!isNaN(value) && value > 0) {
                if ((draftTask.duration || 0) === value && (draftTask.estimated_hours || 0) === value) {
                    return;
                }
                saveTaskState();
                mutateDraft((target) => {
                    target.duration = value;
                    target.estimated_hours = value;
                });
                if (!isDraftMode) {
                    task.duration = value;
                    task.estimated_hours = value;
                }
                durationInput.value = value; // 标准化显示
                if (durationHint) {
                    durationHint.textContent = formatDuration(value);
                }
                persistIfNeeded();
            }
        });
    }

    const actualHoursInput = panel.querySelector('#task-actual-hours-input');
    if (actualHoursInput) {
        actualHoursInput.addEventListener('blur', () => {
            const value = parseFloat(actualHoursInput.value);
            if (!isNaN(value) && value >= 0) {
                if ((draftTask.actual_hours || 0) === value) return;
                saveTaskState();
                mutateDraft((target) => {
                    target.actual_hours = value;
                });
                if (!isDraftMode) {
                    task.actual_hours = value;
                }
                persistIfNeeded();
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
    bindCustomFieldEvents(panel, draftTask, { task, isDraftMode });

    // 绑定前置任务事件
    bindDependencyEvents(panel, task);
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
function renderPropertyRow(id, label, value, iconType) {
    const iconSvg = getPropertyIcon(iconType);
    const displayValue = value || '';

    return `
        <div class="flex items-center justify-between py-2.5">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                ${iconSvg}
                <span>${label}</span>
            </div>
            <input type="text" 
                   id="task-${id}-input" 
                   class="input input-ghost input-xs w-24 text-right p-0" 
                   value="${escapeHtml(displayValue)}" 
                   placeholder="-" />
        </div>
    `;
}

/**
 * 渲染负责人行（支持动态类型）
 */
function renderAssigneeRow(task) {
    const currentValue = task?.assignee;
    const label = i18n.t('taskDetails.assignee') || '负责人';
    const iconSvg = getPropertyIcon('user');
    const isParentTask = !!(task?.id && gantt?.hasChild?.(task.id));
    const lockChecked = task?.parent_assignee_locked ? 'checked' : '';
    const lockLabel = i18n.t('taskDetails.parentAssigneeLock') || '锁定上级负责人';

    // Check if assignee field has a type override
    const effectiveType = getFieldType('assignee');
    const systemOptions = getSystemFieldOptions('assignee');

    if ((effectiveType === 'select' || effectiveType === 'multiselect') && systemOptions && systemOptions.length > 0) {
        // 使用 portal 渲染的下拉，避免选项过多时被父容器裁切
        const isMulti = effectiveType === 'multiselect';
        const options = systemOptions.map(opt => ({ value: opt, label: opt }));

        return `
            <div class="flex items-center justify-between py-2.5">
                <div class="flex items-center gap-2 text-sm text-base-content/70">
                    ${iconSvg}
                    <span>${label}</span>
                </div>
                <div class="w-32">
                    ${renderSelectHTML('task-assignee', currentValue, options, { placeholder: '-', isMulti, width: 'w-full' })}
                </div>
            </div>
            ${isParentTask ? `
            <div class="flex items-center justify-end -mt-1">
                <label class="label cursor-pointer gap-2 py-0">
                    <span class="label-text text-xs text-base-content/60">${lockLabel}</span>
                    <input id="task-parent-assignee-lock" type="checkbox" class="checkbox checkbox-xs" ${lockChecked}>
                </label>
            </div>
            ` : ''}
        `;
    } else {
        // Render as text input (default)
        return `
            <div class="flex items-center justify-between py-2.5">
                <div class="flex items-center gap-2 text-sm text-base-content/70">
                    ${iconSvg}
                    <span>${label}</span>
                </div>
                <input type="text" 
                       id="task-assignee-input" 
                       class="input input-ghost input-xs w-24 text-right p-0" 
                       value="${escapeHtml(currentValue || '')}" 
                       placeholder="-" />
            </div>
            ${isParentTask ? `
            <div class="flex items-center justify-end -mt-1">
                <label class="label cursor-pointer gap-2 py-0">
                    <span class="label-text text-xs text-base-content/60">${lockLabel}</span>
                    <input id="task-parent-assignee-lock" type="checkbox" class="checkbox checkbox-xs" ${lockChecked}>
                </label>
            </div>
            ` : ''}
        `;
    }
}

/**
 * 渲染优先级行
 */
function renderPriorityRow(currentPriority) {
    const label = i18n.t('taskDetails.priority') || '优先级';

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
        <div class="flex items-center justify-between py-2.5">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
                <span>${label}</span>
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
 * 渲染进度行
 */
function renderProgressRow(progress) {
    const value = Math.round((progress || 0) * 100);
    const label = i18n.t('taskDetails.progress') || '进度';

    return `
        <div class="flex items-center justify-between py-2.5">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                    <path d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                </svg>
                <span>${label}</span>
            </div>
            <div class="flex items-center gap-2 w-28">
                <input type="range" id="task-progress-slider" min="0" max="100" value="${escapeAttr(value)}" class="range range-xs range-primary flex-1" />
                <div class="relative w-10">
                    <input type="number"
                           id="task-progress-input"
                           class="input input-ghost input-xs w-full text-right p-0 pr-3"
                           value="${escapeAttr(value)}"
                           min="0" max="100" />
                    <span class="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-base-content/50">%</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * 渲染日期行
 */
function renderDateRow(id, label, value, iconType, isOptional = false) {
    const displayText = value || (isOptional ? (i18n.t('taskDetails.notStarted') || '未开始') : '-');
    const valueClass = value ? 'text-base-content' : 'text-base-content/40';
    const iconSvg = getDateIcon(iconType);

    return `
        <div class="flex items-center justify-between py-2.5">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                ${iconSvg}
                <span>${label}</span>
            </div>
            <div class="text-sm ${valueClass}">
                ${value ?
            `<input type="date" id="task-${id}" class="input input-ghost input-xs p-0 w-28 text-right" value="${value}" />` :
            `<span class="cursor-pointer hover:text-primary" data-date-field="${id}">${displayText}</span>`
        }
            </div>
        </div>
    `;
}

/**
 * 渲染工期行 (v1.5) - 带人性化提示
 */
function renderDurationRow(task) {
    const value = task.duration || task.estimated_hours || '';
    const displayValue = value !== undefined && value !== null ? value : '';
    const humanReadable = formatDuration(parseFloat(displayValue) || 0);
    const label = i18n.t('taskDetails.estimatedHours') || '预计';
    const unit = i18n.t('taskDetails.dayUnit') || '天';

    return `
        <div class="flex items-center justify-between py-2.5">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>${label}</span>
            </div>
            <div class="text-sm text-base-content flex flex-col items-end gap-0.5">
                <div class="flex items-center gap-1">
                    <input type="text"
                           id="task-duration-input"
                           class="input input-ghost input-xs w-20 text-right p-0"
                           value="${displayValue}"
                           placeholder="0" />
                    <span class="text-base-content/60">${unit}</span>
                </div>
                <span id="duration-hint" class="text-xs text-base-content/50">${humanReadable}</span>
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
        <div class="flex items-center justify-between py-2.5">
            <div class="flex items-center gap-2 text-sm text-base-content/70">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>${label}</span>
            </div>
            <div class="text-sm ${valueClass} flex items-center gap-1">
                <input type="number" 
                       id="task-${id}-input" 
                       class="input input-ghost input-xs w-14 text-right p-0" 
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
            <div class="flex items-center justify-between py-2.5">
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
            // 使用自定义下拉组件
            return renderSelectHTML(fieldId, value, field.options || [], {
                placeholder: '-',
                width: 'w-32', // 定宽以保持整洁
                isMulti: false
            });

        case 'multiselect':
            // 使用自定义多选组件
            // value 可能是 Array 或逗号分割的字符串，统一转为 Array
            let arrayValue = [];
            if (Array.isArray(value)) {
                arrayValue = value;
            } else if (typeof value === 'string' && value.trim()) {
                arrayValue = value.split(',').map(s => s.trim());
            }

            return renderSelectHTML(fieldId, arrayValue, field.options || [], {
                placeholder: '-',
                width: 'w-40',
                isMulti: true
            });

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
function bindDateInput(panel, selector, task, fieldName, isEndDate = false, options = {}) {
    const sourceTask = options.task || task;
    const isDraftMode = !!options.isDraftMode;
    const saveTaskState = typeof options.saveTaskState === 'function' ? options.saveTaskState : () => {};
    const mutateDraft = typeof options.mutateDraft === 'function'
        ? options.mutateDraft
        : (mutator) => {
            if (typeof mutator === 'function') {
                mutator(task);
            }
        };

    const input = panel.querySelector(selector);
    if (!input) return;

    input.addEventListener('change', () => {
        const nextTask = {
            start_date: task.start_date,
            end_date: task.end_date,
            duration: task.duration || 0
        };

        // <input type="date"> 返回 "YYYY-MM-DD"，用本地时区解析避免时区偏移
        const parts = input.value.split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return;
        const dateValue = new Date(parts[0], parts[1] - 1, parts[2]);
        if (isNaN(dateValue.getTime())) return;

        if (isEndDate) {
            // 用户从 <input type="date"> 选择的日期是"包含"的最后一天（inclusive）
            // DHTMLX 需要"排除"边界（exclusive），即 +1 天
            const exclusiveEnd = inclusiveToExclusive(dateValue);
            nextTask.end_date = exclusiveEnd;
            const startDate = nextTask.start_date;
            if (startDate) {
                // 用 DHTMLX 内部日历计算工作日数，与甘特条渲染保持一致
                const workDuration = gantt.calculateDuration(startDate, exclusiveEnd);
                if (workDuration > 0) {
                    nextTask.duration = workDuration;
                }
            }
        } else {
            nextTask[fieldName] = dateValue;
            // 若调整的是开始时间，同步更新 end_date（保持工期不变）
            if (fieldName === 'start_date' && nextTask.duration) {
                nextTask.end_date = gantt.calculateEndDate(dateValue, nextTask.duration);
            }
        }

        const prevStart = task.start_date ? new Date(task.start_date).getTime() : null;
        const prevEnd = task.end_date ? new Date(task.end_date).getTime() : null;
        const prevDuration = task.duration || 0;
        const nextStart = nextTask.start_date ? new Date(nextTask.start_date).getTime() : null;
        const nextEnd = nextTask.end_date ? new Date(nextTask.end_date).getTime() : null;
        const nextDuration = nextTask.duration || 0;
        if (prevStart === nextStart && prevEnd === nextEnd && prevDuration === nextDuration) {
            return;
        }

        saveTaskState();

        mutateDraft((target) => {
            target.start_date = nextTask.start_date;
            target.end_date = nextTask.end_date;
            target.duration = nextTask.duration;
        });

        if (!isDraftMode) {
            sourceTask.start_date = nextTask.start_date;
            sourceTask.end_date = nextTask.end_date;
            sourceTask.duration = nextTask.duration;
            gantt.updateTask(sourceTask.id);
        }
    });
}

/**
 * 绑定自定义字段事件
 */
function bindCustomFieldEvents(panel, task, options = {}) {
    const sourceTask = options.task || task;
    const isDraftMode = !!options.isDraftMode;

    const saveTaskState = () => {
        if (isDraftMode || undoManager.isApplyingHistoryOperation()) return;
        undoManager.saveState(sourceTask.id);
    };

    const persistIfNeeded = () => {
        if (isDraftMode) return;
        gantt.updateTask(sourceTask.id);
        showToast(i18n.t('message.saveSuccess'), 'success');
    };

    if (!state.customFields || state.customFields.length === 0) return;

    const userCustomFields = state.customFields.filter(
        field => !SYSTEM_FIELDS.includes(field.name)
    );

    userCustomFields.forEach(field => {
        const fieldId = `custom-field-${field.name}`;

        if (field.type === 'select') {
            setupSelect(fieldId, field.options || [], task[field.name], (val) => {
                if (task[field.name] === val) return;
                saveTaskState();
                task[field.name] = val;
                if (!isDraftMode) {
                    sourceTask[field.name] = val;
                }
                persistIfNeeded();
            }, { isMulti: false });

        } else if (field.type === 'multiselect') {
            // 解析初始值
            let initialValue = [];
            const rawVal = task[field.name];
            if (Array.isArray(rawVal)) {
                initialValue = rawVal;
            } else if (typeof rawVal === 'string' && rawVal.trim()) {
                initialValue = rawVal.split(',').map(s => s.trim());
            }

            setupSelect(fieldId, field.options || [], initialValue, (val) => {
                // 多选值保存为数组，如果后端需要字符串，可以在这里转换，
                // 但通常建议保持 state 为数组，仅在 DHTMLX 序列化时转字符串
                // 这里我们假设 DHTMLX 可以处理数组属性，或者我们需要转字符串？
                // 检查 renderSelectHTML 逻辑 -> 它接受数组。
                // 检查 bindSelect -> 它传递数组。
                // 我们在 task 上存储数组是最佳实践，但在 display template 中可能需要处理。
                const currentVal = Array.isArray(task[field.name]) ? task[field.name] : [];
                const nextVal = Array.isArray(val) ? val : [];
                const isSame = currentVal.length === nextVal.length && currentVal.every((item, index) => item === nextVal[index]);
                if (isSame) return;

                // 注意：DHTMLX Gantt 默认序列化可能不支持数组，
                // 如果导出到 Excel/JSON 可能需要处理。
                // 但此处我们先只更新状态。
                saveTaskState();
                task[field.name] = nextVal; // Store as array
                if (!isDraftMode) {
                    sourceTask[field.name] = nextVal;
                }
                persistIfNeeded();
            }, { isMulti: true, placeholder: i18n.t('form.selectPlaceholder') || '请选择' });

        } else {
            // 常规 input 处理
            const element = panel.querySelector(`#${fieldId}`);
            if (!element) return;

            element.addEventListener('blur', () => {
                let newValue = element.value;

                if (field.type === 'number') {
                    newValue = newValue ? parseFloat(newValue) : null;
                } else if (field.type === 'date') {
                    newValue = newValue ? new Date(newValue) : null;
                }

                if (task[field.name] !== newValue) {
                    saveTaskState();
                    task[field.name] = newValue;
                    if (!isDraftMode) {
                        sourceTask[field.name] = newValue;
                    }
                    persistIfNeeded();
                }
            });
        }
    });
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
 * 渲染下拉组件 HTML (Deprecating internal renderDropdownHTML in favor of imported component for custom fields,
 * but keeping this helper for Status/Priority if we don't refactor them yet.
 * Based on file review, renderStatusSelect and renderPriorityRow use renderDropdownHTML)
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
 * 绑定自定义下拉组件事件 (Internal one for Status/Priority)
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

/**
 * 渲染前置任务区块
 */
function renderDependenciesSection(task) {
    const links = task.$target || [];

    let html = `
        <div class="border-t border-base-200/50 pt-3 mt-3">
            <h4 class="text-xs font-medium text-base-content/50 mb-2 uppercase tracking-wider">
                ${i18n.t('taskDetails.predecessors') || '前置任务'}
            </h4>
            <div class="space-y-1" id="predecessors-list">
    `;

    if (links.length > 0) {
        links.forEach(linkId => {
            const link = gantt.getLink(linkId);
            if (!link) return;

            const sourceTask = gantt.getTask(link.source);
            if (!sourceTask) return;

            const linkTypeLabel = getLinkTypeLabel(link.type);

            html += `
                <div class="flex items-center justify-between py-2 group">
                    <div class="flex items-center gap-2 text-sm text-base-content/70 overflow-hidden">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        <span class="truncate" title="${escapeHtml(sourceTask.text)}">${escapeHtml(sourceTask.text)}</span>
                        <span class="text-xs bg-base-200 px-1 rounded text-base-content/50 ml-1">${linkTypeLabel}</span>
                    </div>
                    <button class="btn btn-ghost btn-xs btn-square text-base-content/30 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity delete-link-btn" 
                            data-link-id="${linkId}" title="${i18n.t('form.delete')}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            `;
        });
    } else {
        html += `<div class="text-sm text-base-content/40 py-1">${i18n.t('taskDetails.noPredecessors') || '无前置任务'}</div>`;
    }

    // 添加依赖按钮
    html += `
            </div>
            <div class="mt-2">
                 <button type="button" id="add-predecessor-btn"
                        class="btn btn-ghost btn-xs w-full justify-center gap-1.5
                               text-base-content/50 border border-dashed border-base-300/50
                               hover:border-primary/50 hover:text-primary transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                    </svg>
                    ${i18n.t('taskDetails.addPredecessor') || '添加依赖'}
                </button>
            </div>
        </div>
    `;

    return html;
}

/**
 * 绑定依赖管理事件
 */
function bindDependencyEvents(panel, task) {
    // 删除链接
    panel.querySelectorAll('.delete-link-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const linkId = e.currentTarget.dataset.linkId;
            if (linkId) {
                if (confirm(i18n.t('message.confirmDeleteLink') || 'Delete this link?')) {
                    gantt.deleteLink(linkId);
                    import('./panel.js').then(({ refreshTaskDetailsPanel }) => {
                        refreshTaskDetailsPanel();
                    });
                    showToast(i18n.t('message.deleteSuccess'), 'success');
                }
            }
        });
    });

    // 添加链接
    const addBtn = panel.querySelector('#add-predecessor-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const container = addBtn.parentElement;

            // Get potential predecessors
            const tasks = [];
            gantt.eachTask((t) => {
                if (t.id != task.id) {
                    tasks.push({ value: t.id, label: t.text });
                }
            });

            const selectId = 'new-predecessor-select';
            const wrapper = document.createElement('div');
            wrapper.className = "w-full";
            wrapper.id = selectId;
            container.innerHTML = '';
            container.appendChild(wrapper);
            wrapper.innerHTML = renderSelectHTML(selectId, null, tasks, { placeholder: i18n.t('taskDetails.selectTask') || '选择任务...', width: 'w-full' });

            setupSelect(selectId, tasks, null, (sourceId) => {
                if (sourceId) {
                    const link = { source: sourceId, target: task.id, type: "0" };
                    if (gantt.isLinkAllowed(link)) {
                        gantt.addLink(link);
                        import('./panel.js').then(({ refreshTaskDetailsPanel }) => {
                            refreshTaskDetailsPanel();
                        });
                        showToast(i18n.t('message.saveSuccess'), 'success');
                    } else {
                        import('./panel.js').then(({ refreshTaskDetailsPanel }) => {
                            refreshTaskDetailsPanel();
                        });
                        showToast(i18n.t('message.error') + ': Cyclic dependency or invalid link', 'error');
                    }
                }
            }, { placeholder: i18n.t('taskDetails.selectTask') || '选择任务...', width: 'w-full' });

            // Hack to auto-open dropdown not supported easily in setupSelect without modification.
            // User will just see the dropdown input field and can click it.
        });
    }
}

function getLinkTypeLabel(type) {
    switch (type) {
        case "0": return "FS";
        case "1": return "SS";
        case "2": return "FF";
        case "3": return "SF";
        default: return "FS";
    }
}
