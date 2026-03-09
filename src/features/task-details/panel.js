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
import undoManager from '../ai/services/undoManager.js';

let currentPanel = null;
let currentTaskId = null;
let currentDraftTask = null;
let initialDraftTask = null;
let isFullscreen = false;
let parentTaskStack = [];
let isCreatingNewTask = false;
let pendingNewTaskPayload = null;

function cloneValue(value) {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

function isDateValue(value) {
    return value instanceof Date;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (isDateValue(a) && isDateValue(b)) {
        return a.getTime() === b.getTime();
    }
    if (typeof a !== typeof b) return false;
    if (a == null || b == null) return a === b;
    if (typeof a !== 'object') return a === b;

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
}

function getCurrentSourceTask() {
    if (currentTaskId == null || !gantt || typeof gantt.getTask !== 'function') {
        return null;
    }
    try {
        return gantt.getTask(currentTaskId);
    } catch {
        return null;
    }
}

function hasDraftChanges(sourceTask, draftTask) {
    if (!sourceTask || !draftTask) return false;
    const keys = new Set([...Object.keys(sourceTask), ...Object.keys(draftTask)]);
    for (const key of keys) {
        if (key === 'id') continue;
        if (!deepEqual(sourceTask[key], draftTask[key])) return true;
    }
    return false;
}

function applyDraftChanges(sourceTask, draftTask) {
    if (!sourceTask || !draftTask) return false;

    let changed = false;
    const keys = new Set([...Object.keys(sourceTask), ...Object.keys(draftTask)]);
    for (const key of keys) {
        if (key === 'id') continue;

        const nextValue = draftTask[key];
        if (!deepEqual(sourceTask[key], nextValue)) {
            sourceTask[key] = cloneValue(nextValue);
            changed = true;
        }
    }

    return changed;
}

function isDraftDirty() {
    if (!currentDraftTask) return false;
    if (isCreatingNewTask) {
        return hasDraftChanges(initialDraftTask, currentDraftTask);
    }
    return hasDraftChanges(getCurrentSourceTask(), currentDraftTask);
}

function resetDraftFromSource() {
    const sourceTask = getCurrentSourceTask();
    currentDraftTask = sourceTask ? cloneValue(sourceTask) : null;
    initialDraftTask = currentDraftTask ? cloneValue(currentDraftTask) : null;
}

function updateCurrentDraft(mutator) {
    if (!currentDraftTask || typeof mutator !== 'function') return;
    mutator(currentDraftTask);
}

function getBindingContext(panel) {
    return {
        draftTask: currentDraftTask,
        isDraftMode: true,
        onDraftMutated: (mutator) => {
            updateCurrentDraft(mutator);
            const panelTitle = panel.querySelector('#panel-task-title');
            if (panelTitle && currentDraftTask) {
                panelTitle.textContent = currentDraftTask.text || i18n.t('taskDetails.newTask');
            }
        }
    };
}

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
    if (currentPanel) {
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
    isCreatingNewTask = false;
    pendingNewTaskPayload = null;
    currentDraftTask = cloneValue(task);
    initialDraftTask = cloneValue(task);

    const overlay = document.createElement('div');
    overlay.id = 'task-details-overlay';
    overlay.className = 'fixed inset-0 bg-black/50 z-[5999] transition-opacity duration-300 opacity-0 flex items-center justify-center';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeTaskDetailsPanel();
        }
    });
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'task-details-panel';
    panel.className = `
        w-[1000px] max-w-[92vw] h-[88vh] max-h-[850px]
        bg-base-100 shadow-2xl rounded-xl
        z-[6000] flex flex-col
        transition-all duration-300 ease-out
        scale-95 opacity-0
    `;

    panel.innerHTML = buildPanelHTML(currentDraftTask);

    overlay.appendChild(panel);
    currentPanel = panel;

    bindPanelEvents(panel, task);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        panel.classList.remove('scale-95', 'opacity-0');
        panel.classList.add('scale-100', 'opacity-100');
    });

    document.addEventListener('keydown', handleEscKey);
    document.body.style.overflow = 'hidden';
}

function buildDraftTaskFromPayload(payload = {}) {
    const defaults = payload?.defaults || {};
    const fallbackStartDate = new Date();
    fallbackStartDate.setHours(0, 0, 0, 0);

    const startDate = defaults.start_date ? new Date(defaults.start_date) : fallbackStartDate;
    if (Number.isNaN(startDate.getTime())) {
        startDate.setTime(fallbackStartDate.getTime());
    }

    return {
        text: defaults.text || '',
        summary: defaults.summary || defaults.description || '',
        description: defaults.description || defaults.summary || '',
        start_date: startDate,
        duration: Number.isFinite(Number(defaults.duration)) ? Number(defaults.duration) : 1,
        progress: Number.isFinite(Number(defaults.progress)) ? Number(defaults.progress) : 0,
        parent: defaults.parent ?? 0,
        status: defaults.status || 'not_started',
        priority: defaults.priority || 'medium',
        assignee: defaults.assignee || '',
        schedule_mode: defaults.schedule_mode || 'start_duration'
    };
}

export function openNewTaskDetailsPanel(payload = {}) {
    if (currentPanel) {
        const overlay = document.getElementById('task-details-overlay');
        destroyRichTextEditor();
        if (overlay) overlay.remove();
        currentPanel = null;
        document.removeEventListener('keydown', handleEscKey);
    }

    currentTaskId = null;
    isCreatingNewTask = true;
    pendingNewTaskPayload = payload;
    const draftTask = buildDraftTaskFromPayload(payload);
    currentDraftTask = cloneValue(draftTask);
    initialDraftTask = cloneValue(draftTask);

    const overlay = document.createElement('div');
    overlay.id = 'task-details-overlay';
    overlay.className = 'fixed inset-0 bg-black/50 z-[5999] transition-opacity duration-300 opacity-0 flex items-center justify-center';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeTaskDetailsPanel();
        }
    });
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = 'task-details-panel';
    panel.className = `
        w-[1000px] max-w-[92vw] h-[88vh] max-h-[850px]
        bg-base-100 shadow-2xl rounded-xl
        z-[6000] flex flex-col
        transition-all duration-300 ease-out
        scale-95 opacity-0
    `;

    panel.innerHTML = buildPanelHTML(currentDraftTask);

    overlay.appendChild(panel);
    currentPanel = panel;

    bindPanelEvents(panel, currentDraftTask);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        panel.classList.remove('scale-95', 'opacity-0');
        panel.classList.add('scale-100', 'opacity-100');
    });

    document.addEventListener('keydown', handleEscKey);
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
        <div class="flex items-center justify-between px-5 py-3 border-b border-base-200/50 shrink-0 bg-base-100">
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

        <div class="flex flex-1 overflow-hidden">
            <div id="task-details-left" class="flex-1 p-5 overflow-y-auto min-w-0">
                ${renderLeftSection(task)}
            </div>

            <div id="task-details-right" class="w-[260px] shrink-0 p-5 overflow-y-auto bg-base-200/30 border-l border-base-200/50">
                ${renderRightSection(task)}
            </div>
        </div>

        <div class="flex items-center justify-end gap-2 px-5 py-3 border-t border-base-200/50 shrink-0 bg-base-100">
            <button id="btn-cancel-edit" type="button" class="btn btn-ghost btn-sm">
                ${i18n.t('form.cancel') || '取消'}
            </button>
            <button id="btn-confirm-save" type="button" class="btn btn-primary btn-sm">
                ${i18n.t('form.save') || '确认保存'}
            </button>
        </div>
    `;
}

/**
 * 绑定面板事件
 */
function bindPanelEvents(panel, task) {
    panel.querySelector('#btn-close-panel')?.addEventListener('click', () => closeTaskDetailsPanel());
    panel.querySelector('#btn-fullscreen')?.addEventListener('click', toggleFullscreen);
    panel.querySelector('#btn-delete-task')?.addEventListener('click', () => {
        showDeleteConfirmModal(task);
    });
    panel.querySelector('#btn-confirm-save')?.addEventListener('click', handleConfirmSave);
    panel.querySelector('#btn-cancel-edit')?.addEventListener('click', () => closeTaskDetailsPanel());

    const context = getBindingContext(panel);
    bindLeftSectionEvents(panel, task, context);
    bindRightSectionEvents(panel, task, context);
}

function handleConfirmSave() {
    if (isCreatingNewTask) {
        if (!currentDraftTask) {
            showToast(i18n.t('message.error') || '保存失败', 'error');
            return;
        }

        const taskToCreate = cloneValue(currentDraftTask);
        if (!String(taskToCreate.text || '').trim()) {
            taskToCreate.text = i18n.t('taskDetails.newTask') || '新任务';
        }

        const parentId = taskToCreate.parent ?? pendingNewTaskPayload?.defaults?.parent ?? 0;
        const createdTaskId = gantt.addTask(taskToCreate, parentId);
        const createdTask = gantt.getTask(createdTaskId);

        isCreatingNewTask = false;
        pendingNewTaskPayload = null;
        currentTaskId = createdTaskId;
        currentDraftTask = cloneValue(createdTask);
        initialDraftTask = cloneValue(createdTask);

        showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
        refreshTaskDetailsPanel();
        return;
    }

    const sourceTask = getCurrentSourceTask();
    if (!sourceTask || !currentDraftTask) {
        showToast(i18n.t('message.error') || '保存失败', 'error');
        return;
    }

    if (!hasDraftChanges(sourceTask, currentDraftTask)) {
        showToast(i18n.t('message.noChanges') || '没有可保存的变更', 'info');
        return;
    }

    if (!undoManager.isApplyingHistoryOperation()) {
        undoManager.saveState(sourceTask.id);
    }

    const changed = applyDraftChanges(sourceTask, currentDraftTask);
    if (changed) {
        gantt.updateTask(sourceTask.id);
        showToast(i18n.t('message.saveSuccess') || '保存成功', 'success');
        resetDraftFromSource();
        refreshTaskDetailsPanel();
    }
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
export function closeTaskDetailsPanel(options = {}) {
    if (!currentPanel) return;

    if (!options.force && isDraftDirty()) {
        showConfirmDialog({
            icon: 'alert-triangle',
            variant: 'warning',
            title: i18n.t('taskDetails.unsavedTitle') || '放弃未保存修改？',
            message: i18n.t('taskDetails.unsavedMessage') || '你有未保存的修改，确定要关闭吗？',
            confirmText: i18n.t('form.confirm') || '放弃修改',
            cancelText: i18n.t('form.cancel') || '继续编辑',
            onConfirm: () => closeTaskDetailsPanel({ force: true })
        });
        return;
    }

    const overlay = document.getElementById('task-details-overlay');
    const panel = currentPanel;

    destroyRichTextEditor();

    panel.classList.remove('scale-100', 'opacity-100');
    panel.classList.add('scale-95', 'opacity-0');
    if (overlay) overlay.classList.add('opacity-0');

    setTimeout(() => {
        if (overlay) overlay.remove();
        currentPanel = null;
        currentTaskId = null;
        currentDraftTask = null;
        initialDraftTask = null;
        isFullscreen = false;
        isCreatingNewTask = false;
        pendingNewTaskPayload = null;

        if (parentTaskStack.length > 0) {
            const parentId = parentTaskStack.pop();
            openTaskDetailsPanel(parentId);
        }
    }, 300);

    document.removeEventListener('keydown', handleEscKey);
    document.body.style.overflow = '';
}

/**
 * 刷新面板内容
 */
export function refreshTaskDetailsPanel() {
    if (!currentPanel || !currentTaskId) return;

    if (isDraftDirty()) {
        return;
    }

    const task = gantt.getTask(currentTaskId);
    if (!task) {
        closeTaskDetailsPanel({ force: true });
        return;
    }

    const titleEl = currentPanel.querySelector('#panel-task-title');
    if (titleEl) {
        titleEl.textContent = task.text || i18n.t('taskDetails.newTask');
    }

    resetDraftFromSource();

    const leftSection = currentPanel.querySelector('#task-details-left');
    if (leftSection) {
        leftSection.innerHTML = renderLeftSection(currentDraftTask);
        bindLeftSectionEvents(currentPanel, task, getBindingContext(currentPanel));
    }

    const rightSection = currentPanel.querySelector('#task-details-right');
    if (rightSection) {
        rightSection.innerHTML = renderRightSection(currentDraftTask);
        bindRightSectionEvents(currentPanel, task, getBindingContext(currentPanel));
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
            closeTaskDetailsPanel({ force: true });
            showToast(i18n.t('message.deleteSuccess') || '删除成功', 'success');
        }
    });
}

export const __test__ = {
    hasDraftChanges,
    applyDraftChanges,
    isDraftDirty,
    resetDraftFromSource,
    updateCurrentDraft,
    getDraftTask: () => currentDraftTask,
    setDraftTask: (value) => {
        currentDraftTask = value;
    }
};
