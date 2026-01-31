# UI Style Alignment Design

**Date:** 2026-01-31  
**Sources of Truth:**  
- Global UI: `doc/design/pencil-new.pen`  
- AI UI: `doc/design/ai-pencil.pen`

## Goal
统一前端 UI 风格与两份设计图一致：全局 UI 以 `pencil-new` 为主，AI 子系统以 `ai-pencil` 为主；不改动业务逻辑，只调整结构/样式/组件皮肤。

## Design System Alignment
- 统一使用现有 tokens：`--color-background/surface/card/border/foreground/muted-foreground/primary/primary-soft/primary-strong`，`--radius-m/--radius-pill`，`--shadow-modal`，`--backdrop-color`。
- 取消渐变与 blur 类背景，全部改为 `--surface`/`--card` 与清晰分割线。

## Component Mapping (Track A: Main UI)
- Header/Toolbar：对齐 `Component / Task Header (WHHy1)` 与 `Component / Task Toolbar (RL1hq)`。
- Confirm Dialog：统一使用 `Component / Confirm Dialog (W54fm)`。
- Modal Card：字段配置/AI 配置统一 `Component / Modal Card (ULqPO)`。
- Side Drawer：字段管理面板统一 `Component / Side Drawer (qOffL)`。
- Utilities：popover/toast/shortcuts-panel 使用卡片风格与统一圆角/阴影。

## Component Mapping (Track B: AI UI)
- AI Drawer：结构和布局参照 `Component / AI Task Polish`（56px Header + 主体消息 + Footer）。
- Message bubbles：用户气泡主色/强对比，AI 气泡浅底+边框。
- Tool-call cards：可折叠 Summary 行 + 状态 icon + Args/Result 块。
- Composer：固定高度输入区 + 右侧发送按钮 + 辅助提示行。

## Non-Goals
- 不改动数据流、路由、工具调用逻辑。
- 不引入新的 UI 框架或重构业务模块。

## Verification
- 视觉对齐：与两份 `.pen` 逐项对照（header/toolbar/modal/drawer/bubbles/tool-calls）。
- 交互冒烟：打开/关闭弹窗、侧边栏、发送 AI 消息、显示 tool-call 状态。
