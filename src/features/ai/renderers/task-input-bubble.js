/**
 * 统一的任务输入气泡组件
 * 用于 polish(润色)、split(拆分)、mention(@引用) 三种场景
 * 使用相同的 HTML class 结构以保持视觉一致性
 */

import { i18n } from '../../../utils/i18n.js';

const MODE_LABELS = {
    polish: () => i18n.t('ai.inputBubble.polish') || '润色',
    split: () => i18n.t('ai.inputBubble.split') || '拆分',
    mention: () => i18n.t('ai.inputBubble.mention') || '引用'
};

const STATUS_MAP = {
    pending: '待开始',
    in_progress: '进行中',
    completed: '已完成',
    suspended: '已暂停'
};

const PRIORITY_MAP = {
    high: { label: '高', class: 'badge-error' },
    medium: { label: '中', class: 'badge-warning' },
    low: { label: '低', class: 'badge-info' }
};

/**
 * 渲染统一的任务输入气泡
 * @param {Object} taskData - 任务数据
 * @param {Object} options - { mode: 'polish' | 'split' | 'mention' }
 * @returns {string} HTML 字符串
 */
export function renderTaskInputBubble(taskData, options = {}) {
    const { mode = 'polish' } = options;
    const modeLabel = MODE_LABELS[mode] ? MODE_LABELS[mode]() : mode;

    const {
        text = '',
        priority,
        status,
        progress,
        start_date,
        end_date,
        subtasks
    } = taskData || {};

    const priorityInfo = priority ? PRIORITY_MAP[priority] : null;
    const statusLabel = status ? (STATUS_MAP[status] || status) : null;

    return `
        <div class="ai-task-input-bubble card card-compact bg-base-200/60 border border-base-300 shadow-sm">
            <div class="card-body p-3 gap-2">
                <!-- 模式标签 + 任务名 -->
                <div class="flex items-center gap-2">
                    <span class="badge badge-sm badge-outline badge-primary">${escapeHtml(modeLabel)}</span>
                    <span class="font-medium text-sm truncate flex-1">${escapeHtml(text)}</span>
                </div>

                <!-- 元数据标签行 -->
                <div class="flex flex-wrap items-center gap-1.5 text-xs">
                    ${statusLabel ? `<span class="badge badge-xs badge-ghost">${escapeHtml(statusLabel)}</span>` : ''}
                    ${priorityInfo ? `<span class="badge badge-xs ${priorityInfo.class}">${escapeHtml(priorityInfo.label)}</span>` : ''}
                    ${progress !== undefined && progress !== null ? `<span class="badge badge-xs badge-ghost">${progress}%</span>` : ''}
                    ${start_date ? `<span class="text-base-content/50">${escapeHtml(start_date)}</span>` : ''}
                    ${start_date && end_date ? `<span class="text-base-content/30">→</span>` : ''}
                    ${end_date ? `<span class="text-base-content/50">${escapeHtml(end_date)}</span>` : ''}
                </div>

                <!-- 子任务列表（如果有） -->
                ${subtasks && subtasks.length > 0 ? `
                    <div class="mt-1 space-y-1">
                        <div class="text-xs text-base-content/50">${i18n.t('ai.inputBubble.subtasks') || '子任务'} (${subtasks.length})</div>
                        <ul class="text-xs space-y-0.5 pl-3">
                            ${subtasks.map(sub => `
                                <li class="flex items-center gap-1.5">
                                    <span class="w-1.5 h-1.5 rounded-full ${sub.status === 'completed' ? 'bg-success' : 'bg-base-content/30'} flex-shrink-0"></span>
                                    <span class="truncate">${escapeHtml(sub.text || '')}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
