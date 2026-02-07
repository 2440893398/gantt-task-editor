/**
 * @ Mention 搜索组件
 * 用户在聊天输入框中输入 @ 时弹出任务搜索列表
 * 支持按任务名称和层级编号模糊搜索
 */

import { i18n } from '../../../utils/i18n.js';

/**
 * 模糊搜索任务列表
 * @param {Array} tasks - 任务列表 [{ id, text, hierarchy_id, status, priority, progress }]
 * @param {string} query - 搜索关键词
 * @returns {Array} 匹配的任务列表
 */
export function filterTasksForMention(tasks, query) {
    if (!query || !query.trim()) return [...tasks];

    const q = query.trim().toLowerCase();

    return tasks.filter(task => {
        const nameMatch = (task.text || '').toLowerCase().includes(q);
        const idMatch = (task.hierarchy_id || '').toLowerCase().includes(q);
        return nameMatch || idMatch;
    });
}

/**
 * 构建 referencedTasks 载荷
 * @param {Array} selectedTasks - 已选任务列表
 * @returns {Array} 精简的引用载荷
 */
export function buildReferencedTasksPayload(selectedTasks) {
    return selectedTasks.map(task => ({
        id: task.id,
        hierarchy_id: task.hierarchy_id,
        text: task.text
    }));
}

/**
 * 创建 Mention Composer 实例
 * @param {Object} options
 * @param {HTMLElement} options.containerEl - 挂载容器
 * @param {Function} options.getTaskList - 获取任务列表的回调
 * @param {Function} [options.onSelect] - 选中任务时的回调
 * @returns {Object} composer 实例
 */
export function createMentionComposer({ containerEl, getTaskList, onSelect }) {
    let popupEl = null;
    let selectedTasks = [];
    let chipsEl = null;
    let isPopupVisible = false;
    let currentQuery = '';
    let highlightedIndex = -1;

    function init() {
        // 创建 mention chips 容器
        chipsEl = document.createElement('div');
        chipsEl.className = 'mention-chips flex flex-wrap gap-1 mb-1 empty:hidden';
        containerEl.prepend(chipsEl);

        // 创建弹出层
        popupEl = document.createElement('div');
        popupEl.className = 'mention-popup hidden absolute bottom-full left-0 right-0 mb-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50';
        containerEl.style.position = 'relative';
        containerEl.appendChild(popupEl);
    }

    function destroy() {
        popupEl?.remove();
        chipsEl?.remove();
        popupEl = null;
        chipsEl = null;
        selectedTasks = [];
        isPopupVisible = false;
    }

    function handleInput(text) {
        // 检测 @ 触发
        const atIndex = text.lastIndexOf('@');
        if (atIndex === -1 || (atIndex > 0 && text[atIndex - 1] !== ' ' && atIndex !== 0)) {
            hidePopup();
            return;
        }

        // 提取 @ 后面的查询文本
        currentQuery = text.slice(atIndex + 1);
        showPopup(currentQuery);
    }

    function showPopup(query) {
        if (!popupEl) return;

        const tasks = getTaskList();
        const filtered = filterTasksForMention(tasks, query);

        // 排除已选任务
        const available = filtered.filter(t => !selectedTasks.some(s => s.id === t.id));

        if (available.length === 0) {
            popupEl.innerHTML = `<div class="p-3 text-xs text-base-content/50 text-center">${i18n.t('ai.mention.noResults') || '无匹配任务'}</div>`;
        } else {
            popupEl.innerHTML = available.map((task, idx) => `
                <div class="mention-item flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-base-200 text-sm ${idx === highlightedIndex ? 'bg-base-200' : ''}"
                     data-task-id="${task.id}">
                    <span class="mention-status-dot w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(task.status)}"></span>
                    <span class="badge badge-xs badge-outline font-mono">${escapeHtml(task.hierarchy_id)}</span>
                    <span class="flex-1 truncate">${escapeHtml(task.text)}</span>
                    <span class="badge badge-xs ${getPriorityBadge(task.priority)}">${escapeHtml(task.priority)}</span>
                </div>
            `).join('');

            // 绑定点击事件
            popupEl.querySelectorAll('.mention-item').forEach(el => {
                el.addEventListener('click', () => {
                    const taskId = parseInt(el.dataset.taskId, 10) || el.dataset.taskId;
                    const task = tasks.find(t => t.id === taskId);
                    if (task) selectTask(task);
                });
            });
        }

        popupEl.classList.remove('hidden');
        isPopupVisible = true;
    }

    function hidePopup() {
        if (!popupEl) return;
        popupEl.classList.add('hidden');
        isPopupVisible = false;
        highlightedIndex = -1;
    }

    function selectTask(task) {
        if (selectedTasks.some(t => t.id === task.id)) return;

        selectedTasks.push(task);
        renderChips();
        hidePopup();

        if (onSelect) onSelect(task);
    }

    function removeTask(taskId) {
        selectedTasks = selectedTasks.filter(t => t.id !== taskId);
        renderChips();
    }

    function renderChips() {
        if (!chipsEl) return;

        chipsEl.innerHTML = selectedTasks.map(task => `
            <span class="mention-chip badge badge-primary gap-1 text-xs">
                <span class="font-mono">${escapeHtml(task.hierarchy_id)}</span>
                <span class="truncate max-w-[120px]">${escapeHtml(task.text)}</span>
                <button class="mention-chip-remove btn btn-ghost btn-xs btn-circle w-4 h-4 min-h-0 p-0" data-task-id="${task.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                </button>
            </span>
        `).join('');

        // 绑定移除按钮
        chipsEl.querySelectorAll('.mention-chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = parseInt(btn.dataset.taskId, 10) || btn.dataset.taskId;
                removeTask(taskId);
            });
        });
    }

    function getSelectedTasks() {
        return [...selectedTasks];
    }

    function clearSelection() {
        selectedTasks = [];
        renderChips();
    }

    function buildPayload(text) {
        return {
            text,
            referencedTasks: buildReferencedTasksPayload(selectedTasks)
        };
    }

    function handleKeydown(e) {
        if (!isPopupVisible) return false;

        const items = popupEl?.querySelectorAll('.mention-item') || [];
        if (items.length === 0) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            updateHighlight(items);
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateHighlight(items);
            return true;
        }
        if (e.key === 'Enter' && highlightedIndex >= 0) {
            e.preventDefault();
            items[highlightedIndex]?.click();
            return true;
        }
        if (e.key === 'Escape') {
            hidePopup();
            return true;
        }
        return false;
    }

    function updateHighlight(items) {
        items.forEach((el, i) => {
            el.classList.toggle('bg-base-200', i === highlightedIndex);
        });
    }

    return {
        init,
        destroy,
        handleInput,
        handleKeydown,
        selectTask,
        removeTask,
        getSelectedTasks,
        clearSelection,
        buildPayload,
        get isPopupVisible() { return isPopupVisible; }
    };
}

// ---- Helpers ----

function getStatusColor(status) {
    const colors = {
        'completed': 'bg-success',
        'in_progress': 'bg-info',
        'pending': 'bg-warning',
        'suspended': 'bg-error'
    };
    return colors[status] || 'bg-base-content/30';
}

function getPriorityBadge(priority) {
    const badges = {
        'high': 'badge-error',
        'medium': 'badge-warning',
        'low': 'badge-info'
    };
    return badges[priority] || '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}
