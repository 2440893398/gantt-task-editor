# 技术可行性报告：甘特图设计实现

## 1. 背景
我们需要将现有的 DHTMLX Gantt 实现 (`demo-optimized.html`) 更新为 Figma 设计稿 (Node 4:2135) 的视觉效果。

## 2. 现有技术栈分析
- **核心库**: DHTMLX Gantt Standard/Pro (根据CSS链接判断)
- **前端技术**: 原生 HTML5, CSS3, JavaScript (ES6+)
- **构建工具**: 无 (原生直接运行)

## 3. 设计规范分析 (基于 Figma)
- **布局**: 圆角卡片式设计，带有明显的头部 (Header) 和图表主体。
- **头部区域**:
  - 左侧: 标题 + 项目时间段导航 (如 "2025年9月 - 12月")。
  - 右侧: 功能按钮组 (编辑字段-蓝, 编辑模式-灰, 导出-绿, 导入-紫, 全屏)。
- **甘特图主体**:
  - **Grid (左侧)**: 简单的任务列表，包含"任务名称"和"进度"。行高较大，带有选中指示器(紫色圆点)。
  - **Timeline (右侧)**:
    - 刻度: 月份 + 日期 (1, 6, 11...)。
    - 任务条: **关键差异点**。设计展示了双色进度条 (左侧绿色代表完成，右侧红色代表未完成)，带有阴影和渐变质感。
    - 依赖线: 虚线样式。
- **图例 (Legend)**: 底部显示状态图例 (已完成, 未完成, 依赖关系)。

## 4. 技术实现方案
### 4.1 总体策略
保持现有的单文件/原生架构，通过 CSS 变量系统和 DHTMLX 的 `task_text` / `task_class` 模板功能来实现高度定制化的视觉效果。

### 4.2 具体实现点
1.  **头部重构 (Header)**:
    - 移除或隐藏现有的 DHTMLX 默认头部（如果存在）。
    - 使用 Flexbox 实现 Figma 设计的头部布局。
    - 按钮样式使用 CSS 类复刻 Figma 的圆角和配色。

2.  **甘特图定制 (DHTMLX Configuration)**:
    - **表头 (Scale)**: 配置 `gantt.config.scales` 以匹配设计的 "月-日" 结构。
    - **任务条 (Task Bars)**:
        - DHTMLX 默认进度条是在任务条内部的一层 `div`。
        - **难点**: 实现红绿双色分段效果。
        - **解决方案**: 自定义 `gantt.templates.task_text` 或覆盖 CSS。我们可以将任务条背景设为红色 (未完成色)，进度条背景设为绿色 (完成色)，并使用 CSS `border-radius` 和 `box-shadow` 实现从设计中的 3D/渐变质感。
    - **依赖线 (Links)**:
        - 覆盖 `.gantt_task_link` 相关的 CSS 类，设置 `border` 为 `dashed` 或 `dotted`。

3.  **样式 (CSS)**:
    - 提取 Figma 中的颜色为 CSS 变量 (如 `--color-completed: #22C55E`, `--color-remaining: #EF4444`)。
    - 统一字体为 Inter / Sans-serif。

4.  **交互**:
    - 确保按钮点击事件绑定到相应的 DHTMLX API (如 `gantt.exportToPDF`, `gantt.createTask` 等)。

## 5. 风险与注意事项
- **DHTMLX 限制**: 某些极其复杂的视觉效果 (如完全自定义的 DOM 结构作为任务条) 在标准版中可能受限，需要依赖 CSS 伪元素 trick。
- **响应式**: 设计稿宽度较大，需确保在小屏下的滚动或适配行为。

## 6. 结论
**技术可行**。无需引入 React 或 Tailwind 等重型框架，可以直接通过编写高质量的 CSS 和 JS 配置在现有项目中实现。
