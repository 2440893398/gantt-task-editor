/**
 * 行拖拽排序 - 通过 SortableJS 实现任务上下顺序调整
 * 支持同级排序和跨父级移动，操作可撤销/重做
 */

import Sortable from 'sortablejs';
import { state } from '../../core/store.js';
import undoManager from '../ai/services/undoManager.js';

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

    try {
        const sortableInstance = Sortable.create(gridData, {
            handle: '.gantt-drag-handle',
            animation: 150,
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
            },

        onMove(evt) {
            // 实时更新目标行上的插入指示器（根据 willInsertAfter 决定线在目标行上方还是下方）
            const relatedRow = evt.related && evt.related.closest
                ? evt.related.closest('.gantt_row')
                : null;

            if (indicatorRow && indicatorRow !== relatedRow) {
                indicatorRow.classList.remove('row-drop-indicator-before', 'row-drop-indicator-after');
            }

            if (relatedRow) {
                const className = evt.willInsertAfter ? 'row-drop-indicator-after' : 'row-drop-indicator-before';
                relatedRow.classList.remove('row-drop-indicator-before', 'row-drop-indicator-after');
                relatedRow.classList.add(className);
                indicatorRow = relatedRow;
            } else {
                indicatorRow = null;
            }

            // 返回 true 允许 SortableJS 检测位置变化，但不要修改 DOM（由我们在 onEnd 中手动处理）
            return true;
        },

        onEnd(evt) {
            const { item, newIndex, oldIndex } = evt;

            console.log('[RowReorder] onEnd:', { oldIndex, newIndex, changed: oldIndex !== newIndex });

            // 清理指示器
            if (indicatorRow) {
                indicatorRow.classList.remove('row-drop-indicator-before', 'row-drop-indicator-after');
                indicatorRow = null;
            }

            // 如果位置没变，不做任何处理
            if (oldIndex === newIndex) {
                console.log('[RowReorder] Position unchanged, skipping');
                beforeSnapshot = null;
                return;
            }

            // 若正在执行 undo/redo，忽略此次排序
            if (undoManager.isApplyingHistoryOperation()) {
                beforeSnapshot = null;
                return;
            }

            const draggedTaskId = item.getAttribute('task_id');
            if (!draggedTaskId) {
                beforeSnapshot = null;
                return;
            }

            try {
                // 获取新位置的上方兄弟行（用于推断 parent）
                const allRows = Array.from(gridData.querySelectorAll('.gantt_row[task_id]'));
                const prevRow = newIndex > 0 ? allRows[newIndex - 1] : null;
                const prevTaskId = prevRow ? prevRow.getAttribute('task_id') : null;

                // 获取被拖任务
                const draggedTask = gantt.getTask(draggedTaskId);
                if (!draggedTask) {
                    beforeSnapshot = null;
                    return;
                }

                let newParent = 0;
                if (prevTaskId) {
                    const prevTask = gantt.getTask(prevTaskId);
                    if (prevTask) {
                        // 跨父级移动逻辑：
                        // 如果上方任务是父任务（有子任务），则将拖拽任务变为该父任务的子任务（缩进一级）
                        // 否则使用与上方任务相同的父级（同级）
                        if (gantt.hasChild && gantt.hasChild(prevTaskId)) {
                            // 上方任务是父任务，缩进为该父任务的子任务
                            newParent = prevTaskId;
                        } else {
                            // 上方任务是普通任务，保持同级
                            newParent = prevTask.parent ?? 0;
                        }
                    }
                }

                // 计算 sortorder（基于 Gantt 的内部排序逻辑）
                const siblings = [];
                gantt.eachTask(function (task) {
                    if ((task.parent ?? 0) == newParent && task.id != draggedTaskId) {
                        siblings.push(task);
                    }
                }, newParent || undefined);

                // 更新 Gantt 任务数据
                draggedTask.parent = newParent;
                gantt.updateTask(draggedTaskId);

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
                    indicatorRow.classList.remove('row-drop-indicator-before', 'row-drop-indicator-after');
                    indicatorRow = null;
                }
                beforeSnapshot = null;
            }
        },
    });
    
    state.sortableInstance = sortableInstance;
    console.log('[RowReorder] Sortable instance created:', !!sortableInstance, sortableInstance);
    } catch (error) {
        console.error('[RowReorder] Failed to create Sortable instance:', error);
    }
}
