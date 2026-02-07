/**
 * 任务详情面板 - 主面板组件 v2.0
 * 完全重新实现，基于设计规范 DESIGN_SPEC_任务详情页-v2.0
 */

import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { renderLeftSection, bindLeftSectionEvents } from './left-section.js';
import { renderRightSection, bindRightSectionEvents } from './right-section.js';
import { destroyRichTextEditor } from '../../components/rich-text-editor.js';
import { showConfirmDialog } from '../../components/common/confirm-dialog.js';

let currentPanel = null;
let currentTaskId = null;
let isFullscreen = false;
let parentTaskStack = [];

/**
 * 检查面板是否打开
 */
export function isTaskDetailsPanelOpen() {
    return currentPanel !== null;
}

/**
 * 获取当前打开的任务ID
 */
export function getCurrentTaskId() {
    return currentTaskId;
}

/**
 * 打开任务详情面板
 * @param {string|number} taskId - 任务ID
 */
export function openTaskDetailsPanel(taskId) {
    // 如果已有面板打开，先立即清理
    if (currentPanel) {
        // 立即清理，不等待动画
        const overlay = document.getElementById('task-details-overlay');
        destroyRichTextEditor();
        if (overlay) overlay.remove();
        currentPanel = null;
        document.removeEventListener('keydown', handleEscKey);
    }

    const task = gantt.getTask(taskId);
    if (!task) {
        showToast(i18n.t('message.error'), 'error');
        return;
    }

    currentTaskId = taskId;

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'task-details-overlay';
    overlay.className = 'fixed inset-0 bg-black/50 z-[5999] transition-opacity duration-300 opacity-0 flex items-center justify-center';
    overlay.addEventListener('click', (e) => {
        // 只有点击遮罩层本身才关闭，点击面板内部不关闭
        if (e.target === overlay) {
            closeTaskDetailsPanel();
        }
    });
    document.body.appendChild(overlay);

    // 创建面板容器 - 居中弹窗样式
    const panel = document.createElement('div');
    panel.id = 'task-details-panel';
    panel.className = `
        w-[1000px] max-w-[92vw] h-[88vh] max-h-[850px]
        bg-base-100 shadow-2xl rounded-xl
        z-[6000] flex flex-col
        transition-all duration-300 ease-out
        scale-95 opacity-0
    `;

    // 构建面板内容
    panel.innerHTML = buildPanelHTML(task);

    // 将面板添加到遮罩层中（居中显示）
    overlay.appendChild(panel);
    currentPanel = panel;

    // 绑定事件
    bindPanelEvents(panel, task);

    // 触发弹出动画
    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        panel.classList.remove('scale-95', 'opacity-0');
        panel.classList.add('scale-100', 'opacity-100');
    });

    // ESC 键关闭
    document.addEventListener('keydown', handleEscKey);

    // 禁止背景滚动
    document.body.style.overflow = 'hidden';
}

/**
 * 打开子任务面板（记录父任务，关闭时自动回到父任务）
 * @param {string|number} childTaskId - 子任务ID
 */
export function openChildTaskPanel(childTaskId) {
    if (currentTaskId) {
        parentTaskStack.push(currentTaskId);
    }
    openTaskDetailsPanel(childTaskId);
}

/**
 * 构建面板HTML
 */
function buildPanelHTML(task) {
    const isNewTask = !task.text;
    return `
        <!-- 头部 - 简洁风格 -->
        <div class="flex items-center justify-between px-5 py-3 border-b border-base-200/50 shrink-0 bg-base-100">
            <!-- 左侧：任务标识 -->
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                    </svg>
                </div>
                <h2 class="text-base font-medium text-base-content truncate max-w-[350px]" id="panel-task-title">
                    ${i18n.t('shortcuts.editTask') || '任务详情'}
                </h2>
                ${isNewTask ? '<span class="badge badge-sm badge-primary badge-outline">新建</span>' : ''}
            </div>

            <!-- 右侧：工具按钮 -->
            <div class="flex items-center gap-0.5">
                <button id="btn-fullscreen" class="btn btn-ghost btn-sm btn-square opacity-60 hover:opacity-100"
                        title="${i18n.t('taskDetails.fullscreen') || '全屏'}">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    </svg>
                </button>
                <div class="dropdown dropdown-end">
                    <button tabindex="0" class="btn btn-ghost btn-sm btn-square opacity-60 hover:opacity-100"
                            title="${i18n.t('taskDetails.more') || '更多'}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                        </svg>
                    </button>
                    <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-lg w-36 p-1.5 shadow-xl border border-base-200 z-10">
                        <li><a id="btn-delete-task" class="text-error text-sm rounded-md">
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                            ${i18n.t('form.delete') || '删除'}
                        </a></li>
                    </ul>
                </div>
                <div class="w-px h-4 bg-base-300 mx-1"></div>
                <button id="btn-close-panel" class="btn btn-ghost btn-sm btn-square opacity-60 hover:opacity-100"
                        title="${i18n.t('form.cancel') || '关闭'}">
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>

        <!-- 主体内容 - 双栏布局 -->
        <div class="flex flex-1 overflow-hidden">
            <!-- 左侧编辑区 -->
            <div id="task-details-left" class="flex-1 p-5 overflow-y-auto min-w-0">
                ${renderLeftSection(task)}
            </div>

            <!-- 右侧属性面板 -->
            <div id="task-details-right" class="w-[260px] shrink-0 p-5 overflow-y-auto bg-base-200/30 border-l border-base-200/50">
                ${renderRightSection(task)}
            </div>
        </div>
    `;
}

/**
 * 绑定面板事件
 */
function bindPanelEvents(panel, task) {
    // 关闭按钮
    panel.querySelector('#btn-close-panel')?.addEventListener('click', closeTaskDetailsPanel);

    // 全屏按钮
    panel.querySelector('#btn-fullscreen')?.addEventListener('click', toggleFullscreen);

    // 删除任务
    panel.querySelector('#btn-delete-task')?.addEventListener('click', () => {
        showDeleteConfirmModal(task);
    });

    // 绑定左侧区域事件
    bindLeftSectionEvents(panel, task);

    // 绑定右侧区域事件
    bindRightSectionEvents(panel, task);
}

/**
 * 切换全屏模式
 */
function toggleFullscreen() {
    if (!currentPanel) return;

    isFullscreen = !isFullscreen;

    if (isFullscreen) {
        currentPanel.classList.remove('w-[1000px]', 'max-w-[92vw]', 'h-[88vh]', 'max-h-[850px]', 'rounded-xl');
        currentPanel.classList.add('w-full', 'h-full', 'max-w-full', 'max-h-full', 'rounded-none');
    } else {
        currentPanel.classList.remove('w-full', 'h-full', 'max-w-full', 'max-h-full', 'rounded-none');
        currentPanel.classList.add('w-[1000px]', 'max-w-[92vw]', 'h-[88vh]', 'max-h-[850px]', 'rounded-xl');
    }
}

/**
 * 关闭任务详情面板
 */
export function closeTaskDetailsPanel() {
    if (!currentPanel) return;

    const overlay = document.getElementById('task-details-overlay');
    const panel = currentPanel;

    // 销毁富文本编辑器实例
    destroyRichTextEditor();

    // 触发关闭动画
    panel.classList.remove('scale-100', 'opacity-100');
    panel.classList.add('scale-95', 'opacity-0');
    if (overlay) overlay.classList.add('opacity-0');

    // 动画结束后移除元素
    setTimeout(() => {
        if (overlay) overlay.remove();
        currentPanel = null;
        currentTaskId = null;
        isFullscreen = false;

        // 如果有父任务，自动回到父任务
        if (parentTaskStack.length > 0) {
            const parentId = parentTaskStack.pop();
            openTaskDetailsPanel(parentId);
            return;
        }
    }, 300);

    document.removeEventListener('keydown', handleEscKey);

    // 恢复背景滚动
    document.body.style.overflow = '';
}

/**
 * 刷新面板内容
 */
export function refreshTaskDetailsPanel() {
    if (!currentPanel || !currentTaskId) return;

    const task = gantt.getTask(currentTaskId);
    if (!task) {
        closeTaskDetailsPanel();
        return;
    }

    // 更新标题
    const titleEl = currentPanel.querySelector('#panel-task-title');
    if (titleEl) {
        titleEl.textContent = task.text || i18n.t('taskDetails.newTask');
    }

    // 更新左侧内容
    const leftSection = currentPanel.querySelector('#task-details-left');
    if (leftSection) {
        leftSection.innerHTML = renderLeftSection(task);
        bindLeftSectionEvents(currentPanel, task);
    }

    // 更新右侧内容
    const rightSection = currentPanel.querySelector('#task-details-right');
    if (rightSection) {
        rightSection.innerHTML = renderRightSection(task);
        bindRightSectionEvents(currentPanel, task);
    }
}

/**
 * ESC 键处理
 */
function handleEscKey(e) {
    if (e.key === 'Escape') {
        closeTaskDetailsPanel();
    }
}

/**
 * 显示删除确认弹窗
 */
function showDeleteConfirmModal(task) {
    showConfirmDialog({
        icon: 'trash-2',
        variant: 'danger',
        title: i18n.t('message.confirmDeleteTitle') || '删除任务',
        message: i18n.t('message.confirmDelete') || '确定要删除此任务吗？此操作无法撤销。',
        confirmText: i18n.t('form.delete') || '删除',
        cancelText: i18n.t('form.cancel') || '取消',
        onConfirm: () => {
            gantt.deleteTask(task.id);
            closeTaskDetailsPanel();
            showToast(i18n.t('message.deleteSuccess') || '删除成功', 'success');
        }
    });
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
