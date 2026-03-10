# 三功能设计文档：项目管理内联新建 + 任务定位 + 父任务断续 Summary Bar

**日期：** 2026-03-10
**状态：** 已批准，待实现

---

## 背景

本次包含三个独立但关联性低的功能点，按优先级依次实现：

1. 项目管理弹窗内联新建项目
2. 点击任务列表行时甘特图自动定位到该任务
3. 父任务"断续 Summary Bar"样式（有子任务处显示实心段，空白期只显示连接线）

---

## 功能一：项目管理弹窗内联新建项目

### 问题

`ProjectModal.js` 的管理弹窗只提供改名、改色、删除三个操作，没有"新建项目"入口。新建入口在 `ProjectPicker.js` 下拉菜单中，导致用户需要关闭弹窗才能新建。

### 方案

在 `ProjectModal.js` 表格末尾追加一个内联输入行：

```
┌────────────────────────────────────────────────┐
│ 管理项目                                    [×] │
├────────────────────────────────────────────────┤
│ 项目名称          | 任务数 | 创建时间 |      │
│ [●●●●] [项目A] | 12    | 2026-03-01 | [删] │
│ [●●●●] [项目B] |  5    | 2026-03-05 | [删] │
│ ──────────────────────────────────────────── │
│ [●●●●] [ 输入项目名称... ]              [+] │  ← 新增行
├────────────────────────────────────────────────┤
│ ℹ 点击颜色圆点可更改项目颜色                    │
│                                        [关闭] │
└────────────────────────────────────────────────┘
```

**交互细节：**
- 颜色选择器与现有行完全一致，默认选第一个颜色 `#4f46e5`
- 名称输入框：placeholder "新项目名称" / "New Project Name"（通过 i18n）
- 点击 `+` 按钮或按 Enter：校验名称非空 → 调用 `createProject()` → 刷新列表 → 重置输入行
- 名称为空时按钮 disabled + shake 提示
- 新建成功后弹窗保持打开，不重置颜色选择（保留用户上次选的颜色，方便批量新建同色项目）

**文件改动：**
- `src/features/projects/ProjectModal.js`：追加内联行 HTML + `bindCreateRow()` 事件绑定

**无新依赖，调用已有 `createProject()` from `manager.js`。**

---

## 功能二：点击任务行时甘特图自动定位

### 问题

点击任务列表行时，甘特图时间轴不会滚动到该任务的时间位置，任务多时难以在甘特图上找到。

### 方案

在 `src/features/gantt/init.js` 的 `onTaskClick` 事件中追加定位逻辑（当前约第 718 行）：

```js
gantt.attachEvent("onTaskClick", function (id, e) {
    // 现有：checkbox 拦截逻辑（保持不变）
    // 现有：gantt.selectTask(id)（保持不变）

    // 新增：定位时间轴到任务起始日期（仅在有时间轴的视图模式下）
    if (state.viewMode !== 'table') {
        const task = gantt.getTask(id);
        if (task && typeof gantt.showDate === 'function') {
            gantt.showDate(task.start_date);
        }
    }
    return true;
});
```

**行为说明：**
- `split` 模式：甘特图右侧时间轴水平滚动，使任务的 `start_date` 出现在视图左侧附近
- `gantt` 模式：同上
- `table` 模式：跳过（无时间轴，`gantt.showDate` 无意义）
- `gantt.showDate()` 已在 `scrollToToday()` 中验证可用，无兼容风险

**文件改动：**
- `src/features/gantt/init.js`：约 3 行，`onTaskClick` 事件内部追加

---

## 功能三：父任务断续 Summary Bar

### 问题

父任务在甘特图上渲染为整条实心色块（从最早子任务开始到最晚子任务结束），当中间有无子任务的空白期时，视觉上误导为该段时间内有持续工作。

### 目标效果（参考 MS Project 最佳实践）

```
父任务：  ████░░░░░░░░████    ← 有子任务处深色实心段，间隔只有细横线
子任务1:  ████               ← 第 1-4 天
子任务2:              ████   ← 第 13-16 天
```

具体视觉规格：
- **实心段**：与子任务在时间轴上的投影范围对应，高度 12px（与标准任务条一致），主色 `var(--design-primary)`，圆角 4px
- **连接线**：贯穿整个父任务时间跨度的 2px 细横线，颜色 `var(--design-primary)` 不透明度 0.5，垂直居中
- **默认父任务条**：通过 `task_class` 模板注入 `summary-parent` CSS 类，CSS 将其隐藏（`opacity: 0`），避免与自定义层重叠

### 技术方案

复用 `baseline.js` 已有的 `gantt.addTaskLayer()` 模式，新建 `src/features/gantt/summary-bar.js`：

```
initSummaryBar()
  └── gantt.addTaskLayer({ renderer: { render, getRectangle } })
        render(task):
          1. 若 gantt.hasChild(task.id) 为 false → return false（不干预普通任务）
          2. 收集直接子任务：gantt.eachTask(child => ..., task.id)
          3. 用 gantt.getTaskPosition(task, childStart, childEnd) 算每段 left/width
          4. 构建 DOM：
             a. 外层 div（task 全宽，overflow:hidden，position:relative）
             b. 内层 div.summary-connector（2px 横线，全宽）
             c. 为每个子任务段追加 div.summary-segment（实心矩形）
          5. return 外层 div
        getRectangle(task):
          若 gantt.hasChild(task.id) → 返回 gantt.getTaskPosition(task, task.start_date, task.end_date)
          否则 → return null
```

**CSS 隐藏默认父任务条：**

```css
/* 有子任务的行，隐藏默认任务条，由 summary-bar layer 接管 */
.gantt_task_line.summary-parent {
    opacity: 0;
    pointer-events: none;
}
```

**`task_class` 模板注入（`init.js`）：**

```js
gantt.templates.task_class = function (start, end, task) {
    let classes = [];
    // ... 现有逻辑 ...
    // 新增：有子任务的父任务标记
    if (gantt.hasChild && gantt.hasChild(task.id)) {
        classes.push('summary-parent');
    }
    return classes.join(' ');
};
```

**文件改动：**

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/features/gantt/summary-bar.js` | 新建 | `initSummaryBar()` 导出函数，addTaskLayer 渲染逻辑 |
| `src/features/gantt/init.js` | 修改 | import + 调用 `initSummaryBar()`；`task_class` 追加 `summary-parent` |
| `src/styles/pages/gantt.css` | 修改 | `.gantt_task_line.summary-parent { opacity:0; pointer-events:none }` + summary bar 样式 |

---

## 可行性分析

| 风险 | 说明 | 应对 |
|---|---|---|
| `gantt.showDate` 在 table 模式下副作用 | table 模式无时间轴，调用可能 noop 或报错 | 加 `state.viewMode !== 'table'` 守卫 |
| summary-bar layer 与 baseline layer 冲突 | 两个 addTaskLayer 层叠加时 z-index | baseline 显示在 summary-bar 下方（baseline 在 summary-bar 之后注册即可） |
| 父任务折叠后子任务不可见 | eachTask 仍能遍历折叠子任务，位置计算不受影响 | 无需特殊处理 |
| 内联新建行与现有弹窗关闭逻辑冲突 | renderModal 重绘时内联行状态丢失 | 每次 renderModal 后重新绑定，输入内容不持久化（符合预期） |

**无循环风险：** 三个功能改动文件无交叉，互不影响。
