# 甘特图 UX 优化 - 技术实现分析报告

## 1. 概述

本报告基于《PRD-甘特图区域用户体验优化-需求分析阶段》进行技术可行性分析与实现方案规划。前端技术栈为原生 JavaScript (ES Modules) + Vite + DHTMLX Gantt (CDN Standard Edge 版本)。

---

## 2. 需求分析与可行性评估

### 🔴 P0 核心功能

| 功能点 | 技术可行性 | DHTMLX API / 方案 | 风险/备注 |
|:--- |:--- |:--- |:--- |
| **独立缩放** | ✅ 高 | `gantt.config.scales` 动态切换 或 `gantt.ext.zoom` | 需确认 CDN 是否包含 zoom 扩展，若无则手动实现配置切换。 |
| **拖拽平移** | ✅ 高 | `gantt.config.drag_timeline` | 需配置 `ignore` 属性以避免与任务拖拽冲突。 |

### 🟡 P1 重要功能

| 功能点 | 技术可行性 | DHTMLX API / 方案 | 风险/备注 |
|:--- |:--- |:--- |:--- |
| **回到今天** | ✅ 高 | `gantt.showDate(new Date())` | 简单实现。 |
| **视图切换** | ✅ 高 | 预定义多套 `scales` 配置，切换后 `gantt.render()` | 需设计合理的刻度组合（如月/日，季/月）。 |
| **迷你地图** | ⚠️ 中 | `dhtmlxgantt_minimap.js` 扩展 | 迷你地图扩展通常需要单独引入。CDN 路径需验证，或需自定义简易 Canvas 实现。 |

### 🟢 P2 体验增强

| 功能点 | 技术可行性 | DHTMLX API / 方案 | 风险/备注 |
|:--- |:--- |:--- |:--- |
| **悬停 Tooltip** | ✅ 高 | `gantt.templates.tooltip_text` | 需自定义 HTML 模板以匹配设计。 |
| **直接拖拽调整** | ✅ 高 | 原生支持 `resize` 和 `move` (Standard版支持) | 需优化交互体验，配置 `drag_mode`。 |
| **右键菜单** | ⚠️ 中 | 需自定义 ContextMenu 组件，监听 `onContextMenu` | DHTMLX 自带菜单可能是 Pro 功能，建议用原生/自定义 DOM 实现。 |
| **今日/里程碑标记** | ✅ 高 | `gantt.addMarker` (需 `marker` 扩展) | 需引入 `dhtmlxgantt_marker.js` 扩展。 |
| **搜索筛选** | ✅ 高 | `gantt.attachEvent("onBeforeTaskDisplay")` | 实现简单，性能取决于数据量。 |

---

## 3. 技术实现方案

### 3.1 架构设计

在 `src/features/gantt` 目录下扩展模块：

```
src/features/gantt/
├── init.js           # 现有初始化入口
├── columns.js        # 现有列配置
├── zoom.js           # [New] 缩放与视图级别管理
├── navigation.js     # [New] 拖拽平移、回到今天、滚动同步
├── markers.js        # [New] 时间轴标记（今日线）
├── tooltip.js        # [New] 悬停提示模板
└── plugins.js        # [New] 负责动态加载 CDN 扩展脚本 (Marker, Minimap)
```

### 3.2 关键功能实现细节

#### 3.2.1 视图与缩放 (Zoom)
不依赖 Pro 版的 `layout` 配置，采用 **配置热替换** 方案：
1. 定义 `ZoomLevels` 配置对象，包含 `Day`, `Week`, `Month`, `Year` 等层级的 `gantt.config.scales` 定义。
2. 监听鼠标滚轮事件 (Ctrl + Wheel) 或界面按钮点击。
3. 应用新配置并调用 `gantt.render()`。

#### 3.2.2 拖拽平移 (Drag Canvas)
```javascript
gantt.config.drag_timeline = {
    ignore: ".gantt_task_line, .gantt_task_link, .gantt_task_scale, .gantt_grid_data"
};
```
*注：需仔细调试 ignore 选择器，确保不影响任务条的拖拽。*

#### 3.2.3 动态加载扩展
由于项目使用 HTML 引入 CDN，且未包含所有扩展。需在 `main.js` 或 `init.js` 中动态注入 script 标签来加载 `dhtmlxgantt_marker.js` (用于今日线) 和 `dhtmlxgantt_tooltip.js` (如果内置 tooltip 不够用)。
建议优先使用内置 tooltip 功能，通过 CSS 定制样式。

### 3.3 样式方案
- 在 `src/styles/pages/gantt.css` 中增加 Zoom 控件、Tooltip、右键菜单的样式。
- 保持现有的 CSS 变量系统，确保风格统一。

---

## 4. 实施路线建议

基于优先级和依赖关系，建议分步实施：

**Phase 1: 核心交互 (P0 & P1-Simple)**
1. 实现 **拖拽平移** (配置简单，立即生效)。
2. 实现 **回到今天** 按钮。
3. 引入 `dhtmlxgantt_marker.js` 并添加 **今日竖线**。

**Phase 2: 视图管理 (P0 & P1-Complex)**
1. 封装 `ZoomManager` 模块。
2. 定义多级 Scale 配置 (Day/Week/Month)。
3. 实现底部/右下角的缩放控件 UI。
4. 实现鼠标滚轮缩放逻辑。

**Phase 3: 信息增强 (P2)**
1. 配置 **Tooltip** 模板。
2. 优化 **任务拖拽** 交互体验。
3. 实现 **搜索/筛选** 逻辑。

*(迷你地图由于涉及额外的扩展引入和 UI 占位，建议作为独立的高级特性在最后实施)*

## 5. 结论

所有 P0 和 P1 需求在当前 Standard 版 DHTMLX Gantt 中均**完全可行**。
推荐优先执行 Phase 1 和 Phase 2，这将最显著地解决用户"查看大跨度项目困难"的痛点。

---
**下一步计划：**
待用户确认后，开始 Phase 1 开发，优先实现 **拖拽平移** 和 **回到今天** 功能。
