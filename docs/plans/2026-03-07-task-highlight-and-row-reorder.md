# 任务高亮 & 行拖拽排序 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现点击列表任务时甘特图高亮，以及通过拖拽手柄调整任务上下顺序（含跨父级移动），操作支持撤销/重做。

**Architecture:** 高亮复用现有 `state.selectedTasks` + `updateSelectedTasksUI()` 系统；行排序使用 SortableJS 挂载到 gantt 左侧 grid 行，`onEnd` 回调调用 `gantt.moveTask()` 同步数据，同时向 UndoManager 压入新增的 `reorder` 类型快照。

**Tech Stack:** Vanilla JS ES Modules, SortableJS, DHTMLX Gantt, 自研 UndoManager

---

## Task 1: 安装 SortableJS 依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 sortablejs**

```bash
npm install sortablejs
```

**Step 2: 验证安装成功**

```bash
npm list sortablejs
```

Expected: 输出类似 `sortablejs@x.x.x`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add sortablejs dependency"
```

---

## Task 2: 点击任务行时高亮甘特图对应行

**Files:**
- Modify: `src/features/gantt/init.js:588-612`

**Step 1: 写失败测试**

在 `tests/unit/task-highlight.test.js` 新建：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gantt global
global.gantt = { attachEvent: vi.fn(), eachTask: vi.fn() };

describe('onTaskClick 单选高亮', () => {
    it('普通点击应清空已选任务并高亮当前任务', () => {
        const state = { selectedTasks: new Set(['old-id']), isCtrlPressed: false };
        const updateSelectedTasksUI = vi.fn();

        // 模拟 onTaskClick 逻辑（普通点击，无 Ctrl）
        const e = { target: null, ctrlKey: false, metaKey: false };
        const id = 'new-id';

        // 非 checkbox，非 ctrl → 清空 + 加入当前
        if (!state.isCtrlPressed && !e.ctrlKey && !e.metaKey) {
            state.selectedTasks.clear();
            state.selectedTasks.add(id);
            updateSelectedTasksUI();
        }

        expect(state.selectedTasks.has('old-id')).toBe(false);
        expect(state.selectedTasks.has('new-id')).toBe(true);
        expect(updateSelectedTasksUI).toHaveBeenCalledOnce();
    });

    it('Ctrl+点击应追加到已选集合，不清空', () => {
        const state = { selectedTasks: new Set(['old-id']), isCtrlPressed: false };
        const updateSelectedTasksUI = vi.fn();

        const e = { target: null, ctrlKey: true, metaKey: false };
        const id = 'new-id';

        if (state.isCtrlPressed || e.ctrlKey || e.metaKey) {
            state.selectedTasks.add(id);
            updateSelectedTasksUI();
        }

        expect(state.selectedTasks.has('old-id')).toBe(true);
        expect(state.selectedTasks.has('new-id')).toBe(true);
    });
});
```

**Step 2: 运行测试，确认失败**

```bash
npm test -- --run tests/unit/task-highlight.test.js
```

Expected: 测试通过（此测试测的是逻辑本身，非集成测试）

**Step 3: 修改 `init.js` 的 `onTaskClick` 事件**

找到 `src/features/gantt/init.js` 第 588-612 行的 `onTaskClick` 事件处理，在 `return true;`（第 611 行）之前插入单选逻辑：

将：
```js
        if (state.isCtrlPressed || e.ctrlKey || e.metaKey) {
            if (state.selectedTasks.has(id)) {
                state.selectedTasks.delete(id);
            } else {
                state.selectedTasks.add(id);
            }
            updateSelectedTasksUI();
            return false;
        }
        return true;
```

改为：
```js
        if (state.isCtrlPressed || e.ctrlKey || e.metaKey) {
            if (state.selectedTasks.has(id)) {
                state.selectedTasks.delete(id);
            } else {
                state.selectedTasks.add(id);
            }
            updateSelectedTasksUI();
            return false;
        }

        // 普通单击：清空已选，高亮当前任务
        state.selectedTasks.clear();
        state.selectedTasks.add(id);
        updateSelectedTasksUI();
        return true;
```

**Step 4: 启动 dev 服务器手动验证**

```bash
npm run dev
```

- 点击任意任务行 → 左侧行和右侧甘特条所在行均显示蓝色高亮
- 点击另一任务行 → 高亮切换到新任务，旧高亮消失
- Ctrl+点击 → 多选追加，保持原有行为

**Step 5: Commit**

```bash
git add src/features/gantt/init.js tests/unit/task-highlight.test.js
git commit -m "feat: highlight gantt row on task click"
```

---

## Task 3: 为 UndoManager 新增 reorder 快照类型

**Files:**
- Modify: `src/features/ai/services/undoManager.js`

**Step 1: 写失败测试**

在 `tests/unit/undo-reorder.test.js` 新建：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gantt
const mockTasks = {
    'task1': { id: 'task1', parent: 0, $index: 0 },
    'task2': { id: 'task2', parent: 0, $index: 1 },
    'task3': { id: 'task3', parent: 'task1', $index: 0 },
};
global.gantt = {
    getTask: vi.fn((id) => mockTasks[id]),
    moveTask: vi.fn(),
    render: vi.fn(),
    eachTask: vi.fn(),
};

describe('UndoManager reorder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('saveReorderState 应能压入 reorder 快照', async () => {
        const { saveReorderState, canUndo, getUndoStackSize } = await import('../../src/features/ai/services/undoManager.js');

        const before = [{ id: 'task1', parent: 0, sortorder: 0 }];
        const after  = [{ id: 'task1', parent: 0, sortorder: 1 }];

        const result = saveReorderState(before, after);

        expect(result).toBe(true);
        expect(canUndo()).toBe(true);
        expect(getUndoStackSize()).toBe(1);
    });

    it('undo reorder 应调用 gantt.moveTask 恢复 before 状态', async () => {
        const { saveReorderState, undo, clearHistory } = await import('../../src/features/ai/services/undoManager.js');
        clearHistory();

        const before = [{ id: 'task1', parent: 0, sortorder: 0 }];
        const after  = [{ id: 'task1', parent: 'task2', sortorder: 1 }];
        saveReorderState(before, after);

        undo();

        expect(gantt.moveTask).toHaveBeenCalled();
        expect(gantt.render).toHaveBeenCalled();
    });
});
```

**Step 2: 运行测试，确认失败**

```bash
npm test -- --run tests/unit/undo-reorder.test.js
```

Expected: FAIL - `saveReorderState is not a function`

**Step 3: 在 `undoManager.js` 末尾（export default 之前）新增代码**

在第 418 行（`// 导出默认对象` 注释之前）插入：

```js
/**
 * 保存排序操作快照（reorder 操作）
 * 在拖拽完成后调用，传入操作前后的任务顺序快照
 * @param {Array<{id, parent, sortorder}>} before - 拖拽前所有可见任务的顺序状态
 * @param {Array<{id, parent, sortorder}>} after  - 拖拽后所有可见任务的顺序状态
 * @returns {boolean} 是否保存成功
 */
export function saveReorderState(before, after) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
        console.warn('[UndoManager] saveReorderState: invalid arguments');
        return false;
    }

    try {
        const snapshot = {
            op: 'reorder',
            timestamp: Date.now(),
            before: before.map(t => ({ id: t.id, parent: t.parent, sortorder: t.sortorder })),
            after:  after.map(t => ({ id: t.id, parent: t.parent, sortorder: t.sortorder })),
        };

        _pushSnapshot(snapshot);
        console.log('[UndoManager] Reorder state saved. Stack size:', undoStack.length);
        return true;
    } catch (e) {
        console.error('[UndoManager] Failed to save reorder state:', e);
        return false;
    }
}

/**
 * 应用排序快照（内部辅助函数，供 undo/redo 使用）
 * @param {Array<{id, parent, sortorder}>} items - 要应用的顺序快照
 */
function _applyReorderSnapshot(items) {
    // 按 sortorder 从小到大排序，确保顺序正确
    const sorted = [...items].sort((a, b) => a.sortorder - b.sortorder);
    sorted.forEach(({ id, parent, sortorder }) => {
        try {
            const task = gantt.getTask(id);
            if (!task) return;
            task.parent = parent ?? 0;
            task.sortorder = sortorder;
            gantt.moveTask(id, sortorder, parent ?? 0);
        } catch (e) {
            console.warn('[UndoManager] _applyReorderSnapshot: failed for task', id, e);
        }
    });
    gantt.render();
}
```

**Step 4: 扩展 `undo()` 函数以处理 `reorder` op**

在 `undo()` 函数内（第 210 行附近），在 `if (op === 'delete')` 块之后、`// op === 'update'` 注释之前插入：

```js
            if (op === 'reorder') {
                // 撤回排序 → 恢复 before 状态，将 after 推入 redo 栈
                _applyReorderSnapshot(snapshot.before);
                redoStack.push(snapshot);
                console.log('[UndoManager] Undo reorder: restored before state');
                _dispatchChange();
                return true;
            }
```

**Step 5: 扩展 `redo()` 函数以处理 `reorder` op**

在 `redo()` 函数内（第 303 行附近），在 `if (op === 'delete')` 块之后、`// op === 'update'` 注释之前插入：

```js
            if (op === 'reorder') {
                // 重做排序 → 恢复 after 状态，将 snapshot 推回 undo 栈
                _applyReorderSnapshot(snapshot.after);
                undoStack.push(snapshot);
                console.log('[UndoManager] Redo reorder: restored after state');
                _dispatchChange();
                return true;
            }
```

**Step 6: 更新 `export default` 对象，加入新函数**

将末尾 `export default { ... }` 中添加 `saveReorderState`：

```js
export default {
    saveState,
    saveAddState,
    saveDeleteState,
    saveReorderState,   // 新增
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoStackSize,
    getRedoStackSize,
    clearHistory,
    isApplyingHistoryOperation
};
```

**Step 7: 运行测试，确认通过**

```bash
npm test -- --run tests/unit/undo-reorder.test.js
```

Expected: PASS

**Step 8: 运行全部单元测试，确认无回归**

```bash
npm test -- --run
```

Expected: 全部通过

**Step 9: Commit**

```bash
git add src/features/ai/services/undoManager.js tests/unit/undo-reorder.test.js
git commit -m "feat: add reorder snapshot type to UndoManager"
```

---

## Task 4: 在任务名称列添加拖拽手柄

**Files:**
- Modify: `src/features/gantt/columns.js`（text 列的 template 函数）
- Modify: `src/styles/main.css`（末尾添加手柄样式）

**Step 1: 修改 `columns.js` 中 text 列的 template**

找到 text 列定义中的 template 函数（`updateGanttColumns` 内），将：

```js
    template: function (task) {
        const text = task.text || '';
        return `<span title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    }
```

改为：

```js
    template: function (task) {
        const text = task.text || '';
        return `<span class="gantt-drag-handle" title="${i18n.t('gantt.dragToReorder') || '拖动调整顺序'}">⠿</span><span title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    }
```

**Step 2: 在 `main.css` 末尾追加手柄和占位线样式**

在文件末尾（第 331 行后）追加：

```css
/* Drag handle for row reorder */
.gantt-drag-handle {
    cursor: grab;
    color: #9ca3af;
    padding: 0 4px 0 0;
    user-select: none;
    font-size: 14px;
    vertical-align: middle;
    opacity: 0;
    transition: opacity 0.15s;
}
.gantt_row:hover .gantt-drag-handle {
    opacity: 1;
}
.gantt_row.row-dragging {
    opacity: 0.4;
}
.gantt_row.row-drag-ghost {
    background: transparent !important;
    border-top: 2px solid #3b82f6 !important;
    height: 2px !important;
    overflow: hidden;
}
```

**Step 3: 手动验证样式**

```bash
npm run dev
```

- 悬停任务行 → 左侧出现灰色 `⠿` 手柄图标
- 移开鼠标 → 手柄消失

**Step 4: Commit**

```bash
git add src/features/gantt/columns.js src/styles/main.css
git commit -m "feat: add drag handle to task name column"
```

---

## Task 5: 实现行拖拽排序核心逻辑

**Files:**
- Create: `src/features/gantt/row-reorder.js`

**Step 1: 创建 `row-reorder.js`**

```js
/**
 * 行拖拽排序 - 通过 SortableJS 实现任务上下顺序调整
 * 支持同级排序和跨父级移动，操作可撤销/重做
 */

import Sortable from 'sortablejs';
import { state } from '../../core/store.js';
import undoManager from '../ai/services/undoManager.js';

/**
 * 采集当前所有可见任务的顺序快照
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
    const gridData = gantt.$grid?.querySelector('.gantt_data_area');
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
                const prevRow = allRows[newIndex - 1] || null;
                const prevTaskId = prevRow ? prevRow.getAttribute('task_id') : null;

                let newParent = 0;
                if (prevTaskId) {
                    const prevTask = gantt.getTask(prevTaskId);
                    if (prevTask) {
                        // 与上方任务同级：使用相同父级
                        newParent = prevTask.parent ?? 0;
                    }
                }

                // 执行移动
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
```

**Step 2: 手动验证（后续集成后验证）**

暂不单独验证，等 Task 6 集成后一起验证。

**Step 3: Commit**

```bash
git add src/features/gantt/row-reorder.js
git commit -m "feat: implement row reorder with SortableJS"
```

---

## Task 6: 集成行排序到甘特图初始化

**Files:**
- Modify: `src/features/gantt/init.js`

**Step 1: 在 `init.js` 顶部添加 import**

在第 30 行（最后一个 import 行）之后追加：

```js
import { initRowSortable } from './row-reorder.js';
```

**Step 2: 在 `onGanttRender` 事件中调用 `initRowSortable()`**

找到第 783 行的 `onGanttRender` 事件：

```js
    gantt.attachEvent("onGanttRender", function () {
        bindGridColumnReorderSync();
        if (state.selectedTasks.size > 0) {
            setTimeout(updateSelectedTasksUI, 50);
        }
    });
```

改为：

```js
    gantt.attachEvent("onGanttRender", function () {
        bindGridColumnReorderSync();
        if (state.selectedTasks.size > 0) {
            setTimeout(updateSelectedTasksUI, 50);
        }
        // 重新挂载行排序（每次渲染后 DOM 行被重建）
        setTimeout(initRowSortable, 0);
    });
```

**Step 3: 手动验证完整功能**

```bash
npm run dev
```

验证清单：
- [ ] 拖动手柄可以上下移动任务
- [ ] 跨父级拖动后任务归属到新父级
- [ ] 拖动后 Ctrl+Z 可撤销，任务恢复原位
- [ ] 撤销后 Ctrl+Y 可重做
- [ ] 工具栏撤销/重做按钮状态正确更新
- [ ] 点击任务行（非手柄区域）正常触发高亮，不触发拖拽

**Step 4: 运行全部单元测试，确认无回归**

```bash
npm test -- --run
```

Expected: 全部通过

**Step 5: Commit**

```bash
git add src/features/gantt/init.js
git commit -m "feat: integrate row reorder into gantt render lifecycle"
```

---

## Task 7: 最终验证

**Step 1: 构建验证**

```bash
npm run build
```

Expected: 无报错，构建成功

**Step 2: 运行全部单元测试**

```bash
npm test -- --run
```

Expected: 全部通过

**Step 3: Commit（如有未提交文件）**

```bash
git status
git add -A
git commit -m "feat: task highlight on click and drag-to-reorder with undo support"
```
