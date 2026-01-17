# 前端 UI 框架迁移评估报告

**日期**: 2026-01-17
**评估对象**: Tailwind CSS + shadcn/ui
**当前架构**: 原生 HTML5 + CSS3 + JavaScript (Vanilla JS) + Vite

## 1. 现状分析
当前项目使用原生 JavaScript 和 CSS 开发，样式通过 CSS 变量 (`src/styles/main.css`) 和独立的组件 CSS 文件 (`src/styles/components/*.css`) 进行管理。依赖 DHTMLX Gantt 进行核心渲染。

## 2. 评估结论

### 🔴 shadcn/ui
**结论**: **不推荐直接使用 (架构不兼容)**

*   **原因**: shadcn/ui **不是**一个纯 CSS 库。它是一个基于 **React** (或 Vue/Svelte) 的组件代码生成器，底层强依赖 Radix UI (Headless UI 库) 来处理无障碍交互（如下拉菜单的键盘导航、模态框的焦点锁定等）。
*   **兼容性问题**: 当前项目是纯 JS (Vanilla JS)。要使用 shadcn/ui，你需要手动将所有 React 组件逻辑重写为原生 JS，这工作量巨大且失去了使用该库的主要意义（即开箱即用的交互逻辑）。
*   **替代方案**: 只有引入 React/Vue 框架，shadcn/ui 才是可行选项。

### 🟢 Tailwind CSS
**结论**: **强烈推荐**

*   **契合度**: 完美契合。Tailwind CSS 与 Vite 集成非常顺畅，且不依赖任何 JS 框架。
*   **优势**:
    *   **统一设计系统**: 强制使用统一的间距、颜色和排版 Token，解决当前 CSS 中偶发的魔法数值问题。
    *   **减少代码量**: 可以移除 `src/styles/components/` 下的大部分 CSS 文件，直接在 HTML 中编写工具类。
    *   **现代化**: 配合 PostCSS，支持现代 CSS 特性。
*   **劣势**: HTML 类名会变长（可以通过 `@apply` 缓解，但不推荐过度使用）。

## 3. 推荐方案：Tailwind CSS + HTML-First UI 库

鉴于项目是纯 JS 环境，建议采用 **Tailwind CSS** 搭配一个**针对原生 HTML 优化**的组件库。

### 推荐组合：Tailwind CSS + DaisyUI
[DaisyUI](https://daisyui.com/) 是最流行的 Tailwind CSS 组件库，它提供语义化的类名（如 `btn btn-primary`），非常适合从当前的自定义 CSS 迁移。

| 特性 | shadcn/ui | DaisyUI |
| :--- | :--- | :--- |
| **底层技术** | React + Radix UI | 纯 CSS (基于 Tailwind) |
| **Vanilla JS 支持** | ❌ (需重写逻辑) | ✅ (原生支持) |
| **样式风格** | 极简、现代、商业风 | 多样化主题，包含类似风格 |
| **开发效率** | 低 (需手动移植) | 高 (直接使用类名) |

### 迁移收益预估
1.  **样式代码减少 60%**: 移除 `button.css`, `form.css`, `panel.css` 等，仅保留特定业务逻辑样式。
2.  **主题切换**: DaisyUI 内置强大的主题系统，支持一键切换深色/浅色模式，比当前的手动 CSS 变量更易维护。
3.  **一致性**: 解决按钮风格、输入框边框不统一等视觉问题。

## 4. 迁移路线图 (建议)

如果不打算重构为 React/Vue 项目，建议按以下步骤进行 **UI 现代化改造**：

1.  **引入 Tailwind CSS**: 在 Vite 中配置 Tailwind。
2.  **引入 DaisyUI**: 作为 Tailwind 插件安装。
3.  **逐步替换**:
    *   **阶段一**: 替换通用原子组件（按钮、输入框、卡片）。例如将 `<button class="btn-primary">` 替换为 `<button class="btn btn-primary">` (DaisyUI 语法)。
    *   **阶段二**: 重构布局（Flex/Grid）。使用 Tailwind 的 `flex`, `grid`, `gap-4` 等工具类替换手写的布局 CSS。
    *   **阶段三**: 移除冗余 CSS 文件。
4.  **模仿 shadcn 风格**: 通过配置 Tailwind 的 `theme` 和 DaisyUI 的主题变量，可以轻松复刻 shadcn/ui 的 "Zinc" 或 "Slate" 风格。

## 5. 总结
不要为了使用 shadcn/ui 而引入 React，除非你也计划重构业务逻辑。在当前架构下，**Tailwind CSS + DaisyUI** 是性价比最高、风险最低的现代化方案。
