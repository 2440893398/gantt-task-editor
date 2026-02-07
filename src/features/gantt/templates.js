/**
 * 甘特图模板函数
 */

import { PRIORITY_COLORS, STATUS_COLORS, STATUS_ICONS } from '../../config/constants.js';

/**
 * 获取枚举值的本地化翻译
 * @param {string} type - 枚举类型 (priority/status)
 * @param {string} value - 枚举值
 * @returns {string} 本地化的值
 */
function getLocalizedEnumValue(type, value) {
    if (!value) return '';
    if (window.i18n && typeof window.i18n.t === 'function') {
        const translated = window.i18n.t(`enums.${type}.${value}`);
        // 如果翻译存在则返回，否则返回原值
        if (translated !== `enums.${type}.${value}`) {
            return translated;
        }
    }
    return value;
}

/**
 * 渲染优先级徽章
 * @param {string} value - 优先级值 (高/中/低)
 */
export function renderPriorityBadge(value) {
    if (!value) return '';
    const badgeClass = PRIORITY_COLORS[value] || '';
    const displayValue = getLocalizedEnumValue('priority', value);
    return `<span class="priority-badge-gantt ${badgeClass}">${displayValue}</span>`;
}

/**
 * 渲染状态徽章（带圆点）
 * @param {string} value - 状态值
 */
export function renderStatusBadge(value) {
    if (!value) return '';
    
    // 状态配置映射
    const statusConfig = {
        'in_progress': { dotColor: '#0EA5E9' },
        'pending': { dotColor: '#94A3B8' },
        'completed': { dotColor: '#10B981' },
        'suspended': { dotColor: '#F59E0B' },
        'paused': { dotColor: '#F59E0B' }
    };
    
    const badgeClass = STATUS_COLORS[value] || 'status-pending';
    const config = statusConfig[value] || statusConfig['pending'];
    const displayValue = getLocalizedEnumValue('status', value);
    
    return `<span class="status-badge-gantt ${badgeClass}"><span class="status-dot-gantt" style="background-color: ${config.dotColor};"></span>${displayValue}</span>`;
}

/**
 * 渲染负责人
 * @param {string} value - 负责人姓名
 */
export function renderAssignee(value) {
    if (!value) return '';
    const initial = value.charAt(0);
    return `<span class="assignee-cell-gantt"><span class="assignee-avatar-gantt">${initial}</span><span class="assignee-name-gantt">${value}</span></span>`;
}

/**
 * 渲染进度条
 * @param {Object} task - 任务对象
 */
export function renderProgressBar(task) {
    const progress = Math.round(task.progress * 100);
    let progressClass = 'low';
    if (progress > 70) progressClass = 'high';
    else if (progress > 30) progressClass = 'medium';
    return `<div class="progress-cell-gantt"><div class="progress-bar-gantt"><div class="progress-bar-fill-gantt ${progressClass}" style="width: ${progress}%"></div></div><span class="progress-text-gantt">${progress}%</span></div>`;
}
