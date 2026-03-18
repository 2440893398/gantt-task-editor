/**
 * 行拖拽排序 - 通过 SortableJS 实现任务上下顺序调整
 * 支持同级排序和跨父级移动，操作可撤销/重做
 */

import Sortable from 'sortablejs';
import { state } from '../../core/store.js';
import undoManager from '../ai/services/undoManager.js';

const CHILD_INDENT_THRESHOLD = 24;

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
            const taskId = row.getAttribute('task_id');
            if (!taskId) return;
            const task = gantt.getTask(taskId);
            if (!task) return;
            snapshot.push({
                id: task.id,
                parent: task.parent ?? 0,
                sortorder: index,  // 用 DOM 中的位置作为 sortorder
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

function clearDropIndicator(row) {
    if (!row?.classList) return;
    row.classList.remove('row-drop-indicator-before', 'row-drop-indicator-after', 'row-drop-indicator-child');
}

function getTaskIdFromRow(row) {
    return row?.getAttribute?.('task_id') || null;
}

function getTaskFromRow(row) {
    const taskId = getTaskIdFromRow(row);
    if (!taskId || typeof gantt?.getTask !== 'function') return null;
    return gantt.getTask(taskId);
}

function isDescendantTask(candidateParentId, draggedTaskId) {
    if (!candidateParentId || !draggedTaskId || typeof gantt?.getTask !== 'function') {
        return false;
    }

    let currentId = String(candidateParentId);
    const draggedId = String(draggedTaskId);

    while (currentId && currentId !== '0') {
        if (currentId === draggedId) {
            return true;
        }

        const currentTask = gantt.getTask(currentId);
        if (!currentTask) break;

        const nextParentId = currentTask.parent ?? 0;
        if (String(nextParentId) === currentId) break;
        currentId = nextParentId ? String(nextParentId) : '';
    }

    return false;
}

function getDropIntent(prevTask, draggedTaskId, dragStartX, clientX) {
    if (!prevTask) return 'root';

    const horizontalShift = dragStartX == null || !Number.isFinite(clientX)
        ? 0
        : clientX - dragStartX;

    const wantsChild = horizontalShift > CHILD_INDENT_THRESHOLD;
    if (!wantsChild) {
        return 'sibling';
    }

    if (String(prevTask.id) === String(draggedTaskId) || isDescendantTask(prevTask.id, draggedTaskId)) {
        return 'sibling';
    }

    return 'child';
}

function computeSiblingIndex(rows, item, newParent) {
    const targetIndex = rows.indexOf(item);
    if (targetIndex <= 0) return 0;

    let siblingIndex = 0;
    for (let index = 0; index < targetIndex; index += 1) {
        const rowTask = getTaskFromRow(rows[index]);
        if (!rowTask) continue;

        if (String(rowTask.parent ?? 0) === String(newParent ?? 0)) {
            siblingIndex += 1;
        }
    }

    return siblingIndex;
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
        gridData = document.querySelector('.gantt_task_grid .gantt_grid_data') 
            || document.querySelector('[class*="gantt_grid_data"]');
    }
    
    if (!gridData) {
        console.warn('[RowReorder] Grid data container not found');
        return;
    }
    
    console.log('[RowReorder] Initializing on:', gridData.className, gridData.id);

    let beforeSnapshot = null;
    let indicatorRow = null;
    let dragStartX = null;
    let currentDraggedTaskId = null;

    try {
        const sortableInstance = Sortable.create(gridData, {
            handle: '.gantt-drag-handle',
            animation: 150,
            forceFallback: true,
            fallbackClass: 'row-drag-fallback',
            fallbackOnBody: true,
            swapThreshold: 0.65,
            invertSwap: true,
            sort: true,                        // 启用排序检测，让 Sortable 计算位置变化
            ghostClass: 'row-drag-ghost',
            dragClass: 'row-dragging',
            chosenClass: 'row-drag-chosen',   // 被拖起的行
            dragoverClass: 'row-drag-over',   // 拖拽经过的目标行

            onStart(evt) {
                // 拖拽开始前捕获快照
                if (!undoManager.isApplyingHistoryOperation()) {
                    beforeSnapshot = captureOrderSnapshot();
                    console.log('[RowReorder] onStart snapshot:', JSON.stringify(beforeSnapshot.slice(0, 5)));
                }

                dragStartX = evt.originalEvent?.clientX ?? null;
                currentDraggedTaskId = evt.item?.getAttribute?.('task_id') || null;
            },

            onMove(evt) {
                const relatedRow = evt.related && evt.related.closest
                    ? evt.related.closest('.gantt_row')
                    : null;

                if (indicatorRow && indicatorRow !== relatedRow) {
                    clearDropIndicator(indicatorRow);
                }

                if (relatedRow) {
                    const relatedTask = getTaskFromRow(relatedRow);
                    const intent = getDropIntent(
                        relatedTask,
                        currentDraggedTaskId || evt.dragged?.getAttribute?.('task_id'),
                        dragStartX,
                        evt.originalEvent?.clientX,
                    );

                    clearDropIndicator(relatedRow);
                    if (intent === 'child') {
                        relatedRow.classList.add('row-drop-indicator-child');
                    } else {
                        relatedRow.classList.add(evt.willInsertAfter ? 'row-drop-indicator-after' : 'row-drop-indicator-before');
                    }
                    indicatorRow = relatedRow;
                } else {
                    indicatorRow = null;
                }

                return true;
            },

            onEnd(evt) {
                const { item, newIndex, oldIndex } = evt;
                const horizontalShift = dragStartX == null || !Number.isFinite(evt.originalEvent?.clientX)
                    ? 0
                    : evt.originalEvent.clientX - dragStartX;
                const hierarchyIntent = Math.abs(horizontalShift) > CHILD_INDENT_THRESHOLD;

                console.log('[RowReorder] onEnd:', { oldIndex, newIndex, changed: oldIndex !== newIndex });

                if (indicatorRow) {
                    clearDropIndicator(indicatorRow);
                    indicatorRow = null;
                }

                if (oldIndex === newIndex && !hierarchyIntent) {
                    console.log('[RowReorder] Position unchanged, skipping');
                    beforeSnapshot = null;
                    dragStartX = null;
                    currentDraggedTaskId = null;
                    return;
                }

                if (undoManager.isApplyingHistoryOperation()) {
                    beforeSnapshot = null;
                    dragStartX = null;
                    currentDraggedTaskId = null;
                    return;
                }

                const draggedTaskId = item.getAttribute('task_id') || currentDraggedTaskId;
                if (!draggedTaskId) {
                    beforeSnapshot = null;
                    dragStartX = null;
                    currentDraggedTaskId = null;
                    return;
                }

                try {
                    const allRows = Array.from(gridData.querySelectorAll('.gantt_row[task_id]'));
                    const resolvedIndex = allRows.indexOf(item);
                    const targetIndex = resolvedIndex >= 0 ? resolvedIndex : newIndex;
                    const prevRow = targetIndex > 0 ? allRows[targetIndex - 1] : null;
                    const nextRow = targetIndex >= 0 && targetIndex < allRows.length - 1 ? allRows[targetIndex + 1] : null;
                    const prevTask = getTaskFromRow(prevRow);
                    const nextTask = getTaskFromRow(nextRow);
                    const draggedTask = gantt.getTask(draggedTaskId);

                    if (!draggedTask) {
                        beforeSnapshot = null;
                        dragStartX = null;
                        currentDraggedTaskId = null;
                        return;
                    }

                    const intent = getDropIntent(prevTask, draggedTaskId, dragStartX, evt.originalEvent?.clientX);

                    let newParent = 0;
                    if (prevTask) {
                        if (intent === 'child') {
                            newParent = prevTask.id;
                        } else {
                            newParent = prevTask.parent ?? 0;
                        }

                        const droppingBetweenParentAndChild =
                            intent !== 'child' &&
                            typeof gantt.hasChild === 'function' &&
                            gantt.hasChild(prevTask.id) &&
                            nextTask &&
                            String(nextTask.parent ?? 0) === String(prevTask.id);

                        if (droppingBetweenParentAndChild) {
                            newParent = prevTask.parent ?? 0;
                        }
                    }

                    if (String(newParent ?? 0) === String(draggedTaskId) || isDescendantTask(newParent, draggedTaskId)) {
                        console.warn('[RowReorder] Invalid drop target, reverting:', { draggedTaskId, newParent });
                        gantt.render();
                        beforeSnapshot = null;
                        dragStartX = null;
                        currentDraggedTaskId = null;
                        return;
                    }

                    const siblingIndex = computeSiblingIndex(allRows, item, newParent);
                    draggedTask.parent = newParent;
                    draggedTask.sortorder = siblingIndex;

                    if (typeof gantt.moveTask === 'function') {
                        gantt.moveTask(draggedTaskId, siblingIndex, newParent);
                    } else {
                        gantt.updateTask(draggedTaskId);
                        gantt.render();
                    }

                    if (beforeSnapshot) {
                        const afterSnapshot = captureOrderSnapshot();
                        undoManager.saveReorderState(beforeSnapshot, afterSnapshot);
                    }
                } catch (e) {
                    console.error('[RowReorder] Failed to apply reorder:', e);
                    gantt.render();
                } finally {
                    if (indicatorRow) {
                        clearDropIndicator(indicatorRow);
                        indicatorRow = null;
                    }
                    beforeSnapshot = null;
                    dragStartX = null;
                    currentDraggedTaskId = null;
                }
            },
    });
    
    state.sortableInstance = sortableInstance;
    console.log('[RowReorder] Sortable instance created:', !!sortableInstance, sortableInstance);
    } catch (error) {
        console.error('[RowReorder] Failed to create Sortable instance:', error);
    }
}
