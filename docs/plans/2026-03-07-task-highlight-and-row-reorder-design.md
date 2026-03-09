# 设计文档：任务高亮 & 行拖拽排序

**日期：** 2026-03-07  
**状态：** 已批准

---

## 一、背景与需求

1. **任务高亮**：点击左侧列表中的任务行后，甘特图右侧对应的任务条所在行没有高亮效果，用户无法直观感知当前聚焦任务。
2. **行拖拽排序**：新增任务后无法调整顺序，需要支持通过拖动手柄上下移动任务，支持跨父级重新归属，且操作可撤销/重做。

---

## 二、现状分析

### 2.1 任务高亮

- `state.selectedTasks`（`Set`）+ `applySelectionStyles()` 已实现完整的**多选批量高亮**系统。
- `onTaskClick` 当前只处理 Ctrl/Meta 多选追加，**普通单击不触发高亮**。
- 只需在普通单击时将当前任务加入 `selectedTasks` 并调用已有的 `updateSelectedTasksUI()`，即可复用全套高亮逻辑。

### 2.2 行拖拽排序

- DHTMLX Gantt 的 `order_branch` 行拖拽为企业版功能，当前版本受限。
- `state.sortableInstance` 在 `store.js` 中已预留，但从未挂载。
- 自定义字段管理（`customFields/manager.js`）已有 SortableJS 使用范例。
- **撤销系统**：自研 `UndoManager`（`src/features/ai/services/undoManager.js`）采用快照模式，当前支持 `update`/`add`/`delete` 三种 op 类型，需要新增 `reorder` 类型以支持排序撤销。

---

## 三、方案设计

### 3.1 功能一：点击列表任务高亮

**改动文件：** `src/features/gantt/init.js`

**逻辑：** 在 `onTaskClick` 事件中，当非 Ctrl/Meta 点击时：
1. 清空 `state.selectedTasks`
2. 将当前 `id` 加入 `state.selectedTasks`
3. 调用 `updateSelectedTasksUI()` 触发高亮

**效果：** 左侧 grid 行 + 右侧甘特条所在行同时显示蓝色高亮（`rgba(59,130,246,0.15)` 背景 + 左侧 3px 蓝色边框），与现有多选高亮视觉一致。

**改动量：** 约 5 行，无新依赖。

---

### 3.2 功能二：行拖拽排序

#### 3.2.1 依赖

```
npm install sortablejs
```

#### 3.2.2 拖拽手柄

在 `src/features/gantt/columns.js` 第一列（wbs/序号列）的模板中渲染手柄图标：

```html
<span class="drag-handle" title="拖动调整顺序">⠿</span>
```

CSS（添加到现有样式文件）：
```css
.drag-handle {
    cursor: grab;
    color: #9ca3af;
    padding: 0 4px;
    user-select: none;
}
.drag-handle:active { cursor: grabbing; }
```

#### 3.2.3 SortableJS 初始化

新建 `src/features/gantt/row-reorder.js`，导出 `initRowSortable()` 函数：

- **挂载目标**：左侧 grid 的 `.gantt_data_area .gantt_grid_data`（包含所有 `.gantt_row` 的容器）
- **SortableJS 配置**：
  ```js
  {
      handle: '.drag-handle',
      animation: 150,
      ghostClass: 'row-drag-ghost',   // 拖拽中的占位样式
      dragClass: 'row-dragging',      // 被拖元素半透明
      onStart, onEnd
  }
  ```
- **占位线样式**：`row-drag-ghost` 使用蓝色上边框作为插入位置指示线。

#### 3.2.4 数据同步（`onEnd` 回调核心逻辑）

```
1. 记录拖拽前快照（所有可见任务的 id + parent + sortorder）
2. 获取被拖任务 id（从 .gantt_row[task_id]）
3. 获取新位置的上方任务 id（prevSiblingId）
4. 根据 prevSiblingId 推断新 parent：
     - 若 prevSiblingId 是父任务类型 → 可选作为新 parent（缩进一级）
     - 否则沿用 prevSiblingId.parent 作为新 parent（同级）
5. 调用 gantt.moveTask(draggedId, newIndex, newParentId)
6. 更新拖拽后快照
7. 调用 saveReorderState(before, after) 入栈
8. gantt.render() 刷新
```

> **跨父级判断规则**：目标位置上方任务的层级（`$level`）决定新任务的归属。若拖到一个父任务的最后一个子任务之后，且目标父任务与被拖任务不同，则更新 `parent`。

#### 3.2.5 重新挂载时机

在 `src/features/gantt/init.js` 的 `onGanttRender` 事件中调用 `initRowSortable()`，确保每次甘特图重新渲染后 SortableJS 重新挂载（类似 `applySelectionStyles` 的现有做法）。

---

### 3.3 功能三：排序撤销/重做

#### 3.3.1 新增快照类型 `reorder`

在 `src/features/ai/services/undoManager.js` 中新增：

**快照结构：**
```js
{
    op: 'reorder',
    timestamp: Date.now(),
    before: [
        { id, parent, sortorder },  // 操作前所有任务的顺序状态
        ...
    ],
    after: [
        { id, parent, sortorder },  // 操作后所有任务的顺序状态
        ...
    ]
}
```

**新增导出函数：**
```js
export function saveReorderState(before, after) { ... }
```

**扩展 `undo()` / `redo()`：**
- `op === 'reorder'` 时，遍历 `before`（undo）或 `after`（redo）数组
- 对每个任务调用 `gantt.moveTask()` 恢复其顺序和父级关系
- 设置 `applyingHistoryOperation = true` 防重入
- 操作完成后调用 `gantt.render()`

---

## 四、改动文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `package.json` | 新增依赖 | `sortablejs` |
| `src/features/ai/services/undoManager.js` | 扩展 | 新增 `reorder` op 支持 |
| `src/features/gantt/columns.js` | 修改 | 第一列模板加手柄图标 |
| `src/features/gantt/row-reorder.js` | 新建 | SortableJS 初始化与数据同步逻辑 |
| `src/features/gantt/init.js` | 修改 | `onTaskClick` 加单选高亮；`onGanttRender` 加 `initRowSortable()` 调用 |
| `src/styles/` 现有样式文件 | 修改 | 手柄样式 + 占位线样式 |

---

## 五、不在范围内

- 折叠状态下拖拽进入折叠父任务内部（当前实现只支持可见行间排序）
- 键盘快捷键排序
- 移动端拖拽排序（现有 `responsive.js` 已禁用移动端拖拽，保持一致）
