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
 * - 支持 add/delete 操作快照 (扩展)
 */

// 撤回栈最大保存条数
const MAX_HISTORY_SIZE = 50;

// undo 历史栈
let undoStack = [];

// redo 历史栈
let redoStack = [];

/**
 * 分发 undoStackChange 事件
 */
function _dispatchChange() {
    if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('undoStackChange'));
    }
}

/**
 * 深拷贝任务对象，序列化日期，排除 $ / _ 前缀内部属性
 * @param {Object} task - gantt 任务对象
 * @returns {Object} 克隆后的纯数据对象
 */
function _cloneTask(task) {
    const cloned = {};
    for (const key of Object.keys(task)) {
        if (key.startsWith('$') || key.startsWith('_')) continue;
        const val = task[key];
        if (val instanceof Date) {
            cloned[key] = val.toISOString();
        } else {
            cloned[key] = val;
        }
    }
    return JSON.parse(JSON.stringify(cloned));
}

/**
 * 将 taskData 中的 ISO 日期字符串还原为 Date 对象
 * @param {Object} taskData - 快照数据
 * @returns {Object} 还原后的对象
 */
function _restoreDates(taskData) {
    const restored = { ...taskData };
    if (restored.start_date && typeof restored.start_date === 'string') {
        restored.start_date = new Date(restored.start_date);
    }
    if (restored.end_date && typeof restored.end_date === 'string') {
        restored.end_date = new Date(restored.end_date);
    }
    return restored;
}

/**
 * 保存任务状态快照（update 操作）
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

        const snapshot = {
            op: 'update',
            taskId: taskId,
            timestamp: Date.now(),
            taskData: _cloneTask(task)
        };

        // 添加到 undo 栈
        undoStack.push(snapshot);

        // 限制栈大小
        if (undoStack.length > MAX_HISTORY_SIZE) {
            undoStack.shift();
        }

        // 新的修改会清空 redo 栈
        redoStack = [];

        console.log('[UndoManager] State saved for task', taskId, 'Stack size:', undoStack.length);
        _dispatchChange();
        return true;
    } catch (e) {
        console.error('[UndoManager] Failed to save state:', e);
        return false;
    }
}

/**
 * 保存任务新增快照（add 操作）
 * 在调用 gantt.addTask() 之后立即调用此函数，以便撤回时能删除该任务
 * @param {string|number} taskId - 任务 ID
 * @returns {boolean} 是否保存成功
 */
export function saveAddState(taskId) {
    if (typeof gantt === 'undefined' || !taskId) {
        console.warn('[UndoManager] Cannot save add state: gantt not available or taskId missing');
        return false;
    }

    try {
        const task = gantt.getTask(taskId);
        if (!task) {
            console.warn('[UndoManager] Cannot save add state: task not found', taskId);
            return false;
        }

        const snapshot = {
            op: 'add',
            taskId: taskId,
            timestamp: Date.now(),
            taskData: _cloneTask(task)
        };

        undoStack.push(snapshot);

        if (undoStack.length > MAX_HISTORY_SIZE) {
            undoStack.shift();
        }

        redoStack = [];

        console.log('[UndoManager] Add state saved for task', taskId, 'Stack size:', undoStack.length);
        _dispatchChange();
        return true;
    } catch (e) {
        console.error('[UndoManager] Failed to save add state:', e);
        return false;
    }
}

/**
 * 保存任务删除快照（delete 操作）
 * 在调用 gantt.deleteTask() 之前调用此函数，以便撤回时能重新添加该任务
 * @param {string|number} taskId - 任务 ID
 * @returns {boolean} 是否保存成功
 */
export function saveDeleteState(taskId) {
    if (typeof gantt === 'undefined' || !taskId) {
        console.warn('[UndoManager] Cannot save delete state: gantt not available or taskId missing');
        return false;
    }

    try {
        const task = gantt.getTask(taskId);
        if (!task) {
            console.warn('[UndoManager] Cannot save delete state: task not found', taskId);
            return false;
        }

        const snapshot = {
            op: 'delete',
            taskId: taskId,
            timestamp: Date.now(),
            taskData: _cloneTask(task)
        };

        undoStack.push(snapshot);

        if (undoStack.length > MAX_HISTORY_SIZE) {
            undoStack.shift();
        }

        redoStack = [];

        console.log('[UndoManager] Delete state saved for task', taskId, 'Stack size:', undoStack.length);
        _dispatchChange();
        return true;
    } catch (e) {
        console.error('[UndoManager] Failed to save delete state:', e);
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
        const snapshot = undoStack.pop();
        const { op, taskId, taskData } = snapshot;

        if (op === 'add') {
            // 撤回"新增"操作 → 删除该任务
            redoStack.push(snapshot);
            gantt.deleteTask(taskId);
            console.log('[UndoManager] Undo add: deleted task', taskId);
            _dispatchChange();
            return true;
        }

        if (op === 'delete') {
            // 撤回"删除"操作 → 重新添加该任务
            redoStack.push(snapshot);
            const restored = _restoreDates(taskData);
            const parent = taskData.parent ?? 0;
            gantt.addTask(restored, parent);
            console.log('[UndoManager] Undo delete: re-added task', taskId);
            _dispatchChange();
            return true;
        }

        // op === 'update' 或旧格式快照（无 op 字段）
        const currentTask = gantt.getTask(taskId);
        if (!currentTask) {
            console.warn('[UndoManager] Cannot undo: task not found', taskId);
            return false;
        }

        // 保存当前状态到 redo 栈
        const currentSnapshot = {
            op: 'update',
            taskId: taskId,
            timestamp: Date.now(),
            taskData: _cloneTask(currentTask)
        };
        redoStack.push(currentSnapshot);

        // 恢复任务状态
        restoreTaskState(currentTask, taskData);

        // 更新甘特图
        gantt.updateTask(taskId);

        console.log('[UndoManager] Undo executed for task', taskId);
        _dispatchChange();
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
        const snapshot = redoStack.pop();
        const { op, taskId, taskData } = snapshot;

        if (op === 'add') {
            // 重做"新增"操作 → 重新添加任务，同时把当前删除状态压入 undoStack
            const addSnapshot = {
                op: 'add',
                taskId: taskId,
                timestamp: Date.now(),
                taskData: taskData
            };
            undoStack.push(addSnapshot);
            const restored = _restoreDates(taskData);
            const parent = taskData.parent ?? 0;
            gantt.addTask(restored, parent);
            console.log('[UndoManager] Redo add: re-added task', taskId);
            _dispatchChange();
            return true;
        }

        if (op === 'delete') {
            // 重做"删除"操作 → 再次删除任务，同时把当前添加状态压入 undoStack
            const deleteSnapshot = {
                op: 'delete',
                taskId: taskId,
                timestamp: Date.now(),
                taskData: taskData
            };
            undoStack.push(deleteSnapshot);
            gantt.deleteTask(taskId);
            console.log('[UndoManager] Redo delete: deleted task', taskId);
            _dispatchChange();
            return true;
        }

        // op === 'update' 或旧格式快照
        const currentTask = gantt.getTask(taskId);
        if (!currentTask) {
            console.warn('[UndoManager] Cannot redo: task not found', taskId);
            return false;
        }

        // 保存当前状态到 undo 栈
        const currentSnapshot = {
            op: 'update',
            taskId: taskId,
            timestamp: Date.now(),
            taskData: _cloneTask(currentTask)
        };
        undoStack.push(currentSnapshot);

        // 恢复任务状态
        restoreTaskState(currentTask, taskData);

        // 更新甘特图
        gantt.updateTask(taskId);

        console.log('[UndoManager] Redo executed for task', taskId);
        _dispatchChange();
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
    saveAddState,
    saveDeleteState,
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoStackSize,
    getRedoStackSize,
    clearHistory
};
