/**
 * 行拖拽排序 - 通过 SortableJS 实现任务上下顺序调整
 * 支持同级排序和跨父级移动，操作可撤销/重做
 */

import Sortable from 'sortablejs';
import { state } from '../../core/store.js';
import undoManager from '../ai/services/undoManager.js';

/**
 * 采集当前所有任务的顺序快照（包含未展开的子任务）
 * @returns {Array<{id, parent, sortorder}>}
 */
function captureOrderSnapshot() {
    const snapshot = [];
    gantt.eachTask(function (task) {
        snapshot.push({
            id: task.id,
            parent: task.parent ?? 0,
            sortorder: task.sortorder ?? 0,
        });
    });
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
    const gridData = gantt.$grid && gantt.$grid.querySelector('.gantt_data_area');
    if (!gridData) return;

    let beforeSnapshot = null;

    state.sortableInstance = Sortable.create(gridData, {
        handle: '.gantt-drag-handle',
        animation: 150,
        ghostClass: 'row-drag-ghost',
        dragClass: 'row-dragging',

        onStart() {
            // 拖拽开始前捕获快照
            if (!undoManager.isApplyingHistoryOperation()) {
                beforeSnapshot = captureOrderSnapshot();
            }
        },

        onEnd(evt) {
            const { item, newIndex } = evt;

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

                let newParent = 0;
                if (prevTaskId) {
                    const prevTask = gantt.getTask(prevTaskId);
                    if (prevTask) {
                        // 与上方任务同级：使用相同父级
                        newParent = prevTask.parent ?? 0;
                    }
                }

                // 计算在新父级下的相对索引
                const siblings = [];
                gantt.eachTask(function (task) {
                    if ((task.parent ?? 0) == newParent && task.id != draggedTaskId) {
                        siblings.push(task);
                    }
                }, newParent || undefined);

                // 执行移动：将任务移动到新父级，放在末尾，再通过 render 重排
                gantt.moveTask(draggedTaskId, newIndex, newParent);
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
                beforeSnapshot = null;
            }
        },
    });
}
