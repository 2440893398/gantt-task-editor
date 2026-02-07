# 弹窗 / 面板样式统一化（分析 + 设计稿）

目标：减少“不同模块不同弹窗风格”的割裂感，统一圆角、阴影、遮罩、标题栏与按钮层级；在不改业务逻辑的前提下，让整站视觉更一致。

## 现状分析（代码侧的主要不一致）

从当前实现能看到至少 4 套“弹窗/面板”风格混用：

1) **任务详情面板 + 删除确认**（`src/features/task-details/panel.js`）
- 详情：居中弹窗式面板（overlay + panel），rounded-xl / shadow-2xl
- 删除确认：自定义 DOM + 另一套 rounded-2xl + 更重的遮罩

2) **字段管理面板 / 字段配置弹窗**（`index.html` + `src/features/customFields/manager.js`）
- 侧边面板 header 使用明显渐变（from-primary to-accent），和当前我们新做的“浅底 + 轻边框”风格冲突
- 字段配置弹窗同样使用渐变头部 + blur 遮罩，视觉重量偏大
- system-field 编辑 modal 使用 DaisyUI `modal/modal-box` 默认样式，和上述两者又不一致

3) **AI Drawer + 确认弹窗**（`src/features/ai/components/AiDrawer.js`）
- Drawer 本体整体更“产品化”（sticky header、blur、shadow-2xl），但清空确认使用 DaisyUI dialog 风格
- 与任务删除确认、字段配置弹窗的按钮/标题层级不一致

4) **辅助面板/浮层**（`index.html` shortcuts-panel、`src/utils/dom.js` summary-popover、`src/utils/toast.js` toast）
- shortcuts-panel 使用强渐变头部 + 白底内容；与主 UI 的灰阶体系不一致
- summary-popover / toast 在圆角与 shadow 上也略有差异（偏“独立组件”而非“同一系统”）

结论：建议重做“弹窗/面板”视觉规范，并用少量可复用组件覆盖各模块。

## 建议的统一设计语言（本次 Pencil 已落地）

- **主色（蓝青）**：Primary `#0EA5E9`（hover `#0284C7`），用于主按钮/关键强调；其余区域以灰阶为主，避免“花”
- **底色体系**：`background / surface / card` 三层（减少纯白面积、增强层级）
- **圆角**：主容器统一 `12px`（`$--radius-m`），按钮为 pill（`$--radius-pill`）
- **遮罩**：统一用 `#0F172A4D`~`#0F172A66` 的半透明黑（减少不同弹窗遮罩深浅不一致）
- **标题栏**：统一浅底 `surface`，左侧 icon + title，右侧轻量 icon buttons
- **按钮层级**：Primary（蓝）/ Ghost（无底）/ Destructive（红）三类

## Pencil 设计稿（可直接对照开发）

文件：`doc/design/pencil-new.pen`

### 可复用组件（Component）

- 操作栏（Toolbar）：`RL1hq`
- 统一确认弹窗（Confirm Dialog）：`W54fm`
- 统一侧边面板（Side Drawer）：`qOffL`
- 表单型弹窗骨架（Modal Card）：`ULqPO`（用于字段配置 / AI 配置等表单类弹窗）
- AI 设置弹窗（Refined）：`GOv4z`
- AI 任务润色抽屉（参考现有实践，保留功能，仅优化展示/排版）：`P29MF`
- AI 任务分解抽屉（参考现有实践，保留功能，仅优化展示/排版）：`1IRnC`
- 结构化「任务输入气泡」（用于美化用户任务输入，不展示系统提示词）
  - Task Polish：`GM3y2`
  - Task Split：`6K1jS`
- （旧稿保留）通用 AI Drawer（仅样式/排版优化）：`ZVMxS`

### 示例（Example）

- Confirm + Backdrop 示例：`Mq0j7`
- Drawer + Backdrop 示例：`78nIc`

补充说明（字段管理场景）：
- 字段类型用标签区分（系统/自定义 + 字段类型），便于拖拽排序时不依赖分组。
- 系统字段为只读，不提供开关/编辑/删除等配置入口；自定义字段提供显隐开关与编辑/删除入口。
- Footer 提供「导入字段 / 新增字段」操作入口。
- Task Details（统一风格示意）：`9T5HX`
- （旧稿保留）AI Drawer Overlay（交互示意）：`tmMBK`
- （旧稿保留）AI Drawer Overlay（结构化美化）：`Y7Twl`
- AI 任务润色 Drawer（参考现有实践）：`uufcT`（组件：`P29MF`，输入气泡：`GM3y2`）
- AI 任务分解 Drawer（参考现有实践）：`gjCZj`（组件：`1IRnC`，输入气泡：`6K1jS`）
- AI 设置 Modal（参考现有实践）：`zT5fy`（组件：`GOv4z`）

## 落地建议（开发改造优先级）

1) **字段管理面板**（`#field-management-panel`）：建议替换掉渐变 header，使用 `qOffL` 的 Header/Body/Footer 结构
2) **字段配置弹窗**（`#field-config-modal` + system-field-modal）：建议用 `ULqPO` 作为弹窗骨架，减少渐变与过重阴影
3) **删除确认/清空确认类弹窗**：统一替换为 `W54fm`（同一 icon+文案+按钮层级）
4) **shortcuts-panel / popover / toast**：按同一圆角/阴影/背景层级做轻量调整（不影响功能）
