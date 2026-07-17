/**
 * 行拖拽排序 - 通过 SortableJS 实现任务上下顺序调整
 * 支持同级排序和跨父级移动，操作可撤销/重做
 */

import Sortable from 'sortablejs';
import { state } from '../../core/store.js';
import undoManager from './history/undoManager.js';
import { showToast } from '../../utils/toast.js';
import { recalculateParentChain } from './scheduler.js';

const DROP_INDICATOR_CLASSES = [
    'row-drop-indicator-before',
    'row-drop-indicator-after',
    'row-drop-indicator-child',
];

function isRootParent(parentId) {
    return parentId === null || parentId === undefined || parentId === 0 || parentId === '0';
}

function isSameTaskId(firstId, secondId) {
    return String(firstId) === String(secondId);
}

function getTaskSafe(taskId) {
    if (typeof gantt === 'undefined' || typeof gantt.getTask !== 'function') {
        return null;
    }

    try {
        return gantt.getTask(taskId);
    } catch {
        return null;
    }
}

function getLinkedSuccessorIds(taskId) {
    if (typeof gantt === 'undefined' || typeof gantt.getLinks !== 'function') {
        return new Set();
    }

    const links = gantt.getLinks();
    const successors = new Set();
    links.forEach((link) => {
        if (String(link.source) === String(taskId)) {
            successors.add(String(link.target));
        }
    });

    return successors;
}

function hasAncestorInSet(taskId, ancestorIds) {
    if (isRootParent(taskId) || !ancestorIds || ancestorIds.size === 0) return false;

    const visited = new Set();
    let current = taskId;

    while (!isRootParent(current)) {
        const currentId = String(current);
        if (visited.has(currentId)) return false;
        visited.add(currentId);

        if (ancestorIds.has(currentId)) return true;

        const task = getTaskSafe(current);
        current = task?.parent ?? 0;
    }

    return false;
}

function normalizeParent(parentId) {
    return isRootParent(parentId) ? 0 : parentId;
}

function isSameParent(firstParent, secondParent) {
    return String(normalizeParent(firstParent)) === String(normalizeParent(secondParent));
}

function getRowTaskId(row) {
    const taskId = row ? row.getAttribute('task_id') : null;
    if (taskId == null || taskId === '' || taskId === 'null' || taskId === 'undefined') {
        return null;
    }
    return getTaskSafe(taskId) ? taskId : null;
}

function clearDropIndicator(row) {
    if (!row) return;
    row.classList.remove(...DROP_INDICATOR_CLASSES);
}

function setDropIndicator(row, mode) {
    clearDropIndicator(row);
    if (!row || !mode) return;
    row.classList.add(`row-drop-indicator-${mode}`);
}

function getPointerRatioInRow(row, originalEvent) {
    if (!row || !originalEvent || !Number.isFinite(originalEvent.clientY)) {
        return null;
    }

    const rect = row.getBoundingClientRect();
    if (!rect.height) return null;

    return Math.max(0, Math.min(1, (originalEvent.clientY - rect.top) / rect.height));
}

function canDropAsChild(draggedTaskId, targetTaskId) {
    if (!draggedTaskId) return false;
    if (!targetTaskId || isSameTaskId(draggedTaskId, targetTaskId)) return false;

    return !!getTaskSafe(targetTaskId);
}

function resolveDropIntent(evt, draggedTaskId) {
    const relatedRow =
        evt.related && evt.related.closest ? evt.related.closest('.gantt_row') : null;
    if (!draggedTaskId || !getTaskSafe(draggedTaskId)) {
        return null;
    }
    const relatedTaskId = getRowTaskId(relatedRow);
    const relatedTask = getTaskSafe(relatedTaskId);
    if (!relatedTaskId || !relatedTask) {
        return null;
    }
    const pointerRatio = getPointerRatioInRow(relatedRow, evt.originalEvent);

    const isMiddleDrop =
        pointerRatio === null ? !evt.willInsertAfter : pointerRatio >= 0.25 && pointerRatio <= 0.75;

    if (
        isMiddleDrop &&
        canDropAsChild(draggedTaskId, relatedTaskId) &&
        !wouldCreateHierarchyCycle(draggedTaskId, relatedTaskId)
    ) {
        return {
            mode: 'child',
            row: relatedRow,
            targetTaskId: relatedTaskId,
            parent: relatedTaskId,
        };
    }

    return {
        mode:
            pointerRatio !== null && pointerRatio > 0.75
                ? 'after'
                : evt.willInsertAfter
                  ? 'after'
                  : 'before',
        row: relatedRow,
        targetTaskId: relatedTaskId,
        parent: relatedTask ? normalizeParent(relatedTask.parent) : null,
    };
}

function getActiveDropIntent(intent, draggedTaskId) {
    if (!intent) return null;
    if (!isSameTaskId(intent.draggedTaskId, draggedTaskId)) return null;
    if (intent.targetTaskId && isSameTaskId(intent.targetTaskId, draggedTaskId)) return null;
    return intent;
}

function inferDropParent(prevTaskId) {
    if (!prevTaskId) return 0;

    const prevTask = getTaskSafe(prevTaskId);
    if (!prevTask) return 0;

    if (gantt.hasChild && gantt.hasChild(prevTaskId)) {
        return prevTaskId;
    }

    return normalizeParent(prevTask.parent);
}

function getTargetSiblingIndex(rows, draggedTaskId, newParent) {
    const siblingRows = rows.filter((row) => {
        const taskId = getRowTaskId(row);
        if (!taskId) return false;
        if (isSameTaskId(taskId, draggedTaskId)) return true;

        const task = getTaskSafe(taskId);
        return task && isSameParent(task.parent, newParent);
    });

    const targetIndex = siblingRows.findIndex((row) =>
        isSameTaskId(getRowTaskId(row), draggedTaskId)
    );

    return targetIndex >= 0 ? targetIndex : siblingRows.length;
}

function getTargetIndexFromIntent(rows, draggedTaskId, intent, newParent) {
    if (!intent || intent.mode === 'child') {
        return intent ? 0 : getTargetSiblingIndex(rows, draggedTaskId, newParent);
    }

    const siblingRows = rows.filter((row) => {
        const taskId = getRowTaskId(row);
        if (!taskId) return false;
        if (isSameTaskId(taskId, draggedTaskId)) return true;

        const task = getTaskSafe(taskId);
        return task && isSameParent(task.parent, newParent);
    });

    const targetIndex = siblingRows.findIndex((row) =>
        isSameTaskId(getRowTaskId(row), intent.targetTaskId)
    );

    if (targetIndex < 0) {
        return getTargetSiblingIndex(rows, draggedTaskId, newParent);
    }

    const draggedIndex = siblingRows.findIndex((row) =>
        isSameTaskId(getRowTaskId(row), draggedTaskId)
    );
    if (intent.mode === 'before' && draggedIndex >= 0 && draggedIndex < targetIndex) {
        return Math.max(0, targetIndex - 1);
    }

    const shouldShiftAfterTarget =
        intent.mode === 'after' && (draggedIndex < 0 || draggedIndex > targetIndex);

    return targetIndex + (shouldShiftAfterTarget ? 1 : 0);
}

function moveTaskToDropPosition(draggedTask, newParent, targetIndex) {
    const parent = normalizeParent(newParent);

    if (typeof gantt.moveTask === 'function') {
        gantt.moveTask(draggedTask.id, targetIndex, parent);
        if (typeof gantt.updateTask === 'function') {
            gantt.updateTask(draggedTask.id);
        }
        return;
    }

    draggedTask.parent = parent;
    gantt.updateTask(draggedTask.id);
}

/**
 * 检测将 draggedTaskId 移动到 newParent 下是否会在层级链中形成循环
 * 包括将任务放到自己/后代下面，以及放到关联下游任务的层级路径中。
 */
export function wouldCreateHierarchyCycle(draggedTaskId, newParent) {
    if (isRootParent(newParent)) return false;

    if (hasAncestorInSet(newParent, new Set([String(draggedTaskId)]))) {
        return true;
    }

    const successors = getLinkedSuccessorIds(draggedTaskId);
    return hasAncestorInSet(newParent, successors);
}

/**
 * 采集当前所有任务的顺序快照（基于 DOM 中的实际显示顺序）
 * @returns {Array<{id, parent, sortorder}>}
 */
function captureOrderSnapshot() {
    const snapshot = [];
    // gantt.$grid_data 可能返回 JSHandle，需要通过 DOM 选择器获取实际元素
    let gridData = gantt.$grid_data;

    if (!gridData || !gridData.querySelector) {
        gridData = document.querySelector('.gantt_grid_data');
    }

    if (gridData) {
        // 从 DOM 中按显示顺序读取任务 ID
        const rows = gridData.querySelectorAll('.gantt_row[task_id]');
        rows.forEach((row, index) => {
            const taskId = getRowTaskId(row);
            if (!taskId) return;
            const task = getTaskSafe(taskId);
            if (!task) return;
            snapshot.push({
                id: task.id,
                parent: task.parent ?? 0,
                sortorder: index, // 用 DOM 中的位置作为 sortorder
            });
        });
    }

    // 如果没有 DOM（例如某些特殊场景），兜底用 eachTask
    if (snapshot.length === 0) {
        let index = 0;
        gantt.eachTask(function (task) {
            snapshot.push({
                id: task.id,
                parent: task.parent ?? 0,
                sortorder: index++,
            });
        });
    }

    return snapshot;
}

/**
 * 初始化行拖拽排序
 * 每次 gantt 重新渲染后调用此函数重新挂载 SortableJS
 */
export function initRowSortable() {
    // 销毁旧实例，避免重复挂载
    if (state.sortableInstance) {
        state.sortableInstance.destroy();
        state.sortableInstance = null;
    }

    // 挂载目标：左侧 grid 数据行容器
    // gantt.$grid_data 可能返回 JSHandle，需要通过 DOM 选择器获取实际元素
    let gridData = gantt.$grid_data;

    // 如果 gantt.$grid_data 不是有效的 DOM 元素，尝试通过选择器获取
    if (!gridData || !gridData.querySelector) {
        gridData = document.querySelector('.gantt_grid_data');
    }

    // 再次检查，如果还是没有，使用备选选择器
    if (!gridData || !gridData.querySelector) {
        gridData =
            document.querySelector('.gantt_task_grid .gantt_grid_data') ||
            document.querySelector('[class*="gantt_grid_data"]');
    }

    if (!gridData) {
        console.warn('[RowReorder] Grid data container not found');
        return;
    }

    console.log('[RowReorder] Initializing on:', gridData.className, gridData.id);

    let beforeSnapshot = null;
    let indicatorRow = null;
    let pendingDropIntent = null;

    try {
        const sortableInstance = Sortable.create(gridData, {
            handle: '.gantt-drag-handle',
            animation: 150,
            sort: true, // 启用排序检测，让 Sortable 计算位置变化
            ghostClass: 'row-drag-ghost',
            dragClass: 'row-dragging',
            chosenClass: 'row-drag-chosen', // 被拖起的行
            dragoverClass: 'row-drag-over', // 拖拽经过的目标行

            onStart() {
                pendingDropIntent = null;
                // 拖拽开始前捕获快照
                if (!undoManager.isApplyingHistoryOperation()) {
                    beforeSnapshot = captureOrderSnapshot();
                    console.log(
                        '[RowReorder] onStart snapshot:',
                        JSON.stringify(beforeSnapshot.slice(0, 5))
                    );
                }
            },

            onMove(evt) {
                const draggedTaskId = getRowTaskId(evt.dragged) || getRowTaskId(evt.item);
                const relatedRow =
                    evt.related && evt.related.closest ? evt.related.closest('.gantt_row') : null;
                const relatedTaskId = getRowTaskId(relatedRow);

                // Sortable can report the dragged row itself after it has moved the DOM
                // placeholder. That is not a new drop target, so keep the last valid
                // child/before/after intent instead of overwriting it with the old parent.
                if (
                    draggedTaskId &&
                    relatedTaskId &&
                    isSameTaskId(draggedTaskId, relatedTaskId) &&
                    pendingDropIntent &&
                    isSameTaskId(pendingDropIntent.draggedTaskId, draggedTaskId)
                ) {
                    return true;
                }

                const intent = resolveDropIntent(evt, draggedTaskId);
                if (!intent) {
                    if (indicatorRow) {
                        clearDropIndicator(indicatorRow);
                    }
                    indicatorRow = null;
                    pendingDropIntent = null;
                    return false;
                }
                const intentRow = intent.row;

                if (indicatorRow && indicatorRow !== intentRow) {
                    clearDropIndicator(indicatorRow);
                }

                if (intentRow) {
                    setDropIndicator(intentRow, intent.mode);
                    indicatorRow = intentRow;
                    pendingDropIntent = {
                        draggedTaskId,
                        mode: intent.mode,
                        targetTaskId: intent.targetTaskId,
                        parent: intent.parent,
                    };
                } else {
                    indicatorRow = null;
                    pendingDropIntent = null;
                }

                // 返回 true 允许 SortableJS 检测位置变化，由 onEnd 统一落到 Gantt 数据。
                return true;
            },

            onEnd(evt) {
                const { item, newIndex, oldIndex } = evt;

                console.log('[RowReorder] onEnd:', {
                    oldIndex,
                    newIndex,
                    changed: oldIndex !== newIndex,
                });

                // 清理指示器
                if (indicatorRow) {
                    clearDropIndicator(indicatorRow);
                    indicatorRow = null;
                }

                const draggedTaskId = item.getAttribute('task_id');
                if (!draggedTaskId) {
                    beforeSnapshot = null;
                    pendingDropIntent = null;
                    return;
                }

                const dropIntent = getActiveDropIntent(pendingDropIntent, draggedTaskId);

                // 如果位置没变且没有明确落点意图，不做任何处理
                if (oldIndex === newIndex && !dropIntent) {
                    console.log('[RowReorder] Position unchanged, skipping');
                    beforeSnapshot = null;
                    pendingDropIntent = null;
                    return;
                }

                // 若正在执行 undo/redo，忽略此次排序
                if (undoManager.isApplyingHistoryOperation()) {
                    beforeSnapshot = null;
                    pendingDropIntent = null;
                    return;
                }

                try {
                    // 获取新位置的上方兄弟行（用于推断 parent）
                    const allRows = Array.from(
                        gridData.querySelectorAll('.gantt_row[task_id]')
                    ).filter((row) => !!getRowTaskId(row));
                    const prevRow = newIndex > 0 ? allRows[newIndex - 1] : null;
                    const prevTaskId = getRowTaskId(prevRow);

                    // 获取被拖任务
                    const draggedTask = getTaskSafe(draggedTaskId);
                    if (!draggedTask) {
                        beforeSnapshot = null;
                        return;
                    }
                    const oldParent = normalizeParent(draggedTask.parent);

                    const newParent = dropIntent?.parent ?? inferDropParent(prevTaskId);

                    // 检测层级循环：被拖任务移动后是否会成为自己的后代
                    if (wouldCreateHierarchyCycle(draggedTaskId, newParent)) {
                        showToast('无法移动：目标位置会形成无效的任务层级', 'error');
                        gantt.render();
                        beforeSnapshot = null;
                        pendingDropIntent = null;
                        return;
                    }

                    const targetIndex = getTargetIndexFromIntent(
                        allRows,
                        draggedTaskId,
                        dropIntent,
                        newParent
                    );
                    moveTaskToDropPosition(draggedTask, newParent, targetIndex);
                    const movedTask = getTaskSafe(draggedTaskId);
                    const movedParent = normalizeParent(movedTask?.parent ?? newParent);
                    if (!isRootParent(oldParent)) {
                        recalculateParentChain(oldParent);
                    }
                    if (!isRootParent(movedParent) && !isSameParent(oldParent, movedParent)) {
                        recalculateParentChain(movedParent);
                    }

                    // 重新渲染 Gantt 以同步 DOM 和数据
                    gantt.render();

                    // 保存排序快照到 undo 栈
                    if (beforeSnapshot) {
                        const afterSnapshot = captureOrderSnapshot();
                        undoManager.saveReorderState(beforeSnapshot, afterSnapshot);
                    }
                } catch (e) {
                    console.error('[RowReorder] Failed to apply reorder:', e);
                    // 出错时刷新甘特图恢复原状
                    gantt.render();
                } finally {
                    if (indicatorRow) {
                        clearDropIndicator(indicatorRow);
                        indicatorRow = null;
                    }
                    beforeSnapshot = null;
                    pendingDropIntent = null;
                }
            },
        });

        state.sortableInstance = sortableInstance;
        console.log(
            '[RowReorder] Sortable instance created:',
            !!sortableInstance,
            sortableInstance
        );
    } catch (error) {
        console.error('[RowReorder] Failed to create Sortable instance:', error);
    }
}
