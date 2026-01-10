/**
 * 甘特图模板函数
 */

import { PRIORITY_COLORS, STATUS_COLORS, STATUS_ICONS } from '../../config/constants.js';

/**
 * 渲染优先级徽章
 * @param {string} value - 优先级值 (高/中/低)
 */
export function renderPriorityBadge(value) {
    if (!value) return '';
    const badgeClass = PRIORITY_COLORS[value] || '';
    return `<span class="priority-badge-gantt ${badgeClass}">${value}</span>`;
}

/**
 * 渲染状态徽章
 * @param {string} value - 状态值
 */
export function renderStatusBadge(value) {
    if (!value) return '';
    const badgeClass = STATUS_COLORS[value] || 'status-pending';
    const icon = STATUS_ICONS[value] || '';
    return `<span class="status-badge-gantt ${badgeClass}">${icon} ${value}</span>`;
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
