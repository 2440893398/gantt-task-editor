/**
 * UndoManager - 撤回栈管理器 (F-201)
 *
 * 背景: dhtmlx-gantt 的 undo 插件只跟踪 UI 交互，不跟踪 gantt.updateTask() API 调用。
 * 因此需要实现独立的撤回栈管理，专门用于 AI 应用修改的撤回/重做功能。
 *
 * 功能:
 * - 维护 undo/redo 历史栈
 * - 在 AI 应用修改前保存任务状态快照
 * - 支持撤回/重做操作
 */

// 撤回栈最大保存条数
const MAX_HISTORY_SIZE = 50;

// undo 历史栈
let undoStack = [];

// redo 历史栈
let redoStack = [];

/**
 * 保存任务状态快照
 * @param {string|number} taskId - 任务 ID
 * @returns {boolean} 是否保存成功
 */
export function saveState(taskId) {
    if (typeof gantt === 'undefined' || !taskId) {
        console.warn('[UndoManager] Cannot save state: gantt not available or taskId missing');
        return false;
    }

    try {
        const task = gantt.getTask(taskId);
        if (!task) {
            console.warn('[UndoManager] Cannot save state: task not found', taskId);
            return false;
        }

        // 深拷贝任务状态（保存完整任务数据，不只是 text 字段）
        const snapshot = {
            taskId: taskId,
            timestamp: Date.now(),
            // 深拷贝任务对象，排除内部属性
            taskData: JSON.parse(JSON.stringify({
                text: task.text,
                start_date: task.start_date,
                end_date: task.end_date,
                duration: task.duration,
                progress: task.progress,
                priority: task.priority,
                status: task.status,
                assignee: task.assignee,
                summary: task.summary,
                parent: task.parent,
                open: task.open,
                // 包含任何其他自定义字段
                ...Object.keys(task).reduce((acc, key) => {
                    // 排除以 $ 或 _ 开头的内部属性
                    if (!key.startsWith('$') && !key.startsWith('_') &&
                        !['id', 'start_date', 'end_date'].includes(key)) {
                        acc[key] = task[key];
                    }
                    return acc;
                }, {})
            }))
        };

        // 处理日期序列化
        if (task.start_date instanceof Date) {
            snapshot.taskData.start_date = task.start_date.toISOString();
        }
        if (task.end_date instanceof Date) {
            snapshot.taskData.end_date = task.end_date.toISOString();
        }

        // 添加到 undo 栈
        undoStack.push(snapshot);

        // 限制栈大小
        if (undoStack.length > MAX_HISTORY_SIZE) {
            undoStack.shift();
        }

        // 新的修改会清空 redo 栈
        redoStack = [];

        console.log('[UndoManager] State saved for task', taskId, 'Stack size:', undoStack.length);
        return true;
    } catch (e) {
        console.error('[UndoManager] Failed to save state:', e);
        return false;
    }
}

/**
 * 执行撤回操作
 * @returns {boolean} 是否撤回成功
 */
export function undo() {
    if (undoStack.length === 0) {
        console.log('[UndoManager] Nothing to undo');
        return false;
    }

    if (typeof gantt === 'undefined') {
        console.warn('[UndoManager] Cannot undo: gantt not available');
        return false;
    }

    try {
        // 弹出最近的快照
        const snapshot = undoStack.pop();
        const { taskId, taskData } = snapshot;

        // 获取当前任务状态（用于 redo）
        const currentTask = gantt.getTask(taskId);
        if (!currentTask) {
            console.warn('[UndoManager] Cannot undo: task not found', taskId);
            return false;
        }

        // 保存当前状态到 redo 栈
        const currentSnapshot = {
            taskId: taskId,
            timestamp: Date.now(),
            taskData: JSON.parse(JSON.stringify({
                text: currentTask.text,
                start_date: currentTask.start_date instanceof Date
                    ? currentTask.start_date.toISOString()
                    : currentTask.start_date,
                end_date: currentTask.end_date instanceof Date
                    ? currentTask.end_date.toISOString()
                    : currentTask.end_date,
                duration: currentTask.duration,
                progress: currentTask.progress,
                priority: currentTask.priority,
                status: currentTask.status,
                assignee: currentTask.assignee,
                summary: currentTask.summary,
                parent: currentTask.parent,
                open: currentTask.open
            }))
        };
        redoStack.push(currentSnapshot);

        // 恢复任务状态
        restoreTaskState(currentTask, taskData);

        // 更新甘特图
        gantt.updateTask(taskId);

        console.log('[UndoManager] Undo executed for task', taskId);
        return true;
    } catch (e) {
        console.error('[UndoManager] Undo failed:', e);
        return false;
    }
}

/**
 * 执行重做操作
 * @returns {boolean} 是否重做成功
 */
export function redo() {
    if (redoStack.length === 0) {
        console.log('[UndoManager] Nothing to redo');
        return false;
    }

    if (typeof gantt === 'undefined') {
        console.warn('[UndoManager] Cannot redo: gantt not available');
        return false;
    }

    try {
        // 弹出最近的 redo 快照
        const snapshot = redoStack.pop();
        const { taskId, taskData } = snapshot;

        // 获取当前任务状态（用于 undo）
        const currentTask = gantt.getTask(taskId);
        if (!currentTask) {
            console.warn('[UndoManager] Cannot redo: task not found', taskId);
            return false;
        }

        // 保存当前状态到 undo 栈
        const currentSnapshot = {
            taskId: taskId,
            timestamp: Date.now(),
            taskData: JSON.parse(JSON.stringify({
                text: currentTask.text,
                start_date: currentTask.start_date instanceof Date
                    ? currentTask.start_date.toISOString()
                    : currentTask.start_date,
                end_date: currentTask.end_date instanceof Date
                    ? currentTask.end_date.toISOString()
                    : currentTask.end_date,
                duration: currentTask.duration,
                progress: currentTask.progress,
                priority: currentTask.priority,
                status: currentTask.status,
                assignee: currentTask.assignee,
                summary: currentTask.summary,
                parent: currentTask.parent,
                open: currentTask.open
            }))
        };
        undoStack.push(currentSnapshot);

        // 恢复任务状态
        restoreTaskState(currentTask, taskData);

        // 更新甘特图
        gantt.updateTask(taskId);

        console.log('[UndoManager] Redo executed for task', taskId);
        return true;
    } catch (e) {
        console.error('[UndoManager] Redo failed:', e);
        return false;
    }
}

/**
 * 恢复任务状态
 * @param {Object} task - 任务对象
 * @param {Object} taskData - 保存的任务数据
 */
function restoreTaskState(task, taskData) {
    // 恢复各个字段
    if (taskData.text !== undefined) task.text = taskData.text;
    if (taskData.duration !== undefined) task.duration = taskData.duration;
    if (taskData.progress !== undefined) task.progress = taskData.progress;
    if (taskData.priority !== undefined) task.priority = taskData.priority;
    if (taskData.status !== undefined) task.status = taskData.status;
    if (taskData.assignee !== undefined) task.assignee = taskData.assignee;
    if (taskData.summary !== undefined) task.summary = taskData.summary;
    if (taskData.parent !== undefined) task.parent = taskData.parent;
    if (taskData.open !== undefined) task.open = taskData.open;

    // 恢复日期（需要转换为 Date 对象）
    if (taskData.start_date) {
        task.start_date = new Date(taskData.start_date);
    }
    if (taskData.end_date) {
        task.end_date = new Date(taskData.end_date);
    }
}

/**
 * 检查是否可以撤回
 * @returns {boolean}
 */
export function canUndo() {
    return undoStack.length > 0;
}

/**
 * 检查是否可以重做
 * @returns {boolean}
 */
export function canRedo() {
    return redoStack.length > 0;
}

/**
 * 获取撤回栈大小
 * @returns {number}
 */
export function getUndoStackSize() {
    return undoStack.length;
}

/**
 * 获取重做栈大小
 * @returns {number}
 */
export function getRedoStackSize() {
    return redoStack.length;
}

/**
 * 清空所有历史记录
 */
export function clearHistory() {
    undoStack = [];
    redoStack = [];
    console.log('[UndoManager] History cleared');
}

// 导出默认对象
export default {
    saveState,
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoStackSize,
    getRedoStackSize,
    clearHistory
};
