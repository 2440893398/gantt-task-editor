/**
 * 统一的任务输入气泡组件
 * 用于 polish(润色)、split(拆分)、mention(@引用) 三种场景
 * 使用相同的 HTML class 结构以保持视觉一致性
 *
 * 设计规范 (ai-pencil.pen / sENfm):
 * - 背景: primary-strong (深蓝)
 * - 文字: 白色 (#FFF / 80% alpha)
 * - 标签: 半透明白底 pill 样式
 * - 4行布局: 标题行 → 优先级+日期行 → 工期+进度行 → 子任务行
 */

import { i18n } from '../../../utils/i18n.js';

/**
 * Safe i18n helper: returns fallback if key is missing
 * (i18n.t returns the key string on miss, which is truthy)
 */
function t(key, fallback) {
    const val = i18n.t(key);
    return (val && val !== key) ? val : fallback;
}

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
    high: '高',
    medium: '中',
    low: '低'
};

// SVG icon helpers (Lucide-style, 14×14, stroke=currentColor)
const ICONS = {
    clipboard: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>`,
    flag: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z"/></svg>`,
    calendar: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2"/></svg>`,
    percent: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 5L5 19M6.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM17.5 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/></svg>`,
    folder: `<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>`
};

/**
 * 渲染 pill 标签
 */
function pill(icon, text) {
    return `<span class="ai-task-pill">${icon ? icon : ''}${escapeHtml(text)}</span>`;
}

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
        duration,
        start_date,
        end_date,
        subtasks
    } = taskData || {};

    const priorityLabel = priority ? (PRIORITY_MAP[priority] || priority) : null;
    const statusLabel = status ? (STATUS_MAP[status] || status) : null;
    const subtaskCount = subtasks ? subtasks.length : 0;
    const subtaskLabel = subtaskCount > 0
        ? `${subtaskCount} ${t('ai.inputBubble.subtasks', '个子任务')}`
        : t('ai.inputBubble.noSubtasks', '暂无子任务');

    // Duration label
    const durationLabel = duration ? `${t('ai.inputBubble.duration', '工期')} ${duration} ${t('ai.inputBubble.days', '天')}` : null;

    // Progress label
    const progressLabel = (progress !== undefined && progress !== null) ? `${t('ai.inputBubble.progress', '进度')} ${progress}%` : null;

    // Date range
    const dateLabel = start_date
        ? (end_date ? `${escapeHtml(start_date)} → ${escapeHtml(end_date)}` : escapeHtml(start_date))
        : null;

    return `
        <div class="ai-task-input-bubble">
            <!-- Row 1: Icon + Task name + Status badge -->
            <div class="ai-task-row">
                <span class="ai-task-icon-box">${ICONS.clipboard}</span>
                <span class="ai-task-title">${escapeHtml(text)}</span>
                <span class="flex-1"></span>
                ${statusLabel ? `<span class="ai-task-pill">${escapeHtml(statusLabel)}</span>` : ''}
            </div>

            <!-- Row 2: Priority + Date range -->
            <div class="ai-task-row">
                ${priorityLabel ? pill(ICONS.flag, priorityLabel) : ''}
                ${dateLabel ? `<span class="ai-task-pill">${ICONS.calendar}${dateLabel}</span>` : ''}
            </div>

            <!-- Row 3: Duration + Progress -->
            <div class="ai-task-row">
                ${durationLabel ? pill(ICONS.clock, durationLabel) : ''}
                ${progressLabel ? pill(ICONS.percent, progressLabel) : ''}
            </div>

            <!-- Row 4: Subtasks -->
            <div class="ai-task-row">
                ${ICONS.folder}
                <span class="ai-task-meta-text">${escapeHtml(subtaskLabel)}</span>
            </div>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
