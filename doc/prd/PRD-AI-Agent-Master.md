# 产品需求文档 (PRD): 分布式前端 AI Agent 系统 (Master)

> **文档版本**: v3.0 (Master)
> **最后更新**: 2026-01-24
> **状态**: 待评审
> **来源**: 合并自 [PRD-AI-Agent-架构.md](./PRD-AI-Agent-架构.md), [PRD-AI-Agent-优化-v2.0.md](./PRD-AI-Agent-优化-v2.0.md), [前端AI Agent框架调研.md](../root/前端AI Agent框架调研.md)

## 1. 项目愿景与执行摘要

本项目旨在构建一个**"自带密钥" (BYOK - Bring Your Own Key)** 的去中心化前端智能体架构。通过解耦"业务逻辑"（Prompt/Agent）与"算力资源"（API Key/Model），实现以下核心价值：

1. **隐私优先**：用户数据不经由应用后端存储，直接流向信任的模型服务商（或本地模型）。
2. **成本解耦**：开发者无需承担 Token 成本，用户可灵活通过 API Key 付费或使用本地免费算力。
3. **模型中立**：全面兼容 OpenAI 接口协议，支持 Cloud (OpenAI/DeepSeek) 和 Local (Ollama/LM Studio) 模型无缝切换。

## 2. 核心架构设计

### 2.1 双通道通信架构

基于浏览器的安全策略与网络拓扑，采用**双通道策略**：

* **通道 A：无状态中转 (Stateless Proxy)**
  * **适用场景**：访问 OpenAI, DeepSeek, Anthropic 等云端商业 API。
  * **机制**：避免前端 CORS 问题，隐藏 System Prompt 细节。API Key 仅在请求时刻由前端从 LocalStorage 注入 Header 传输，后端仅做转发不落盘。
* **通道 B：客户端直连 (Client-Direct)**
  * **适用场景**：访问 Localhost (Ollama) 或私有化部署模型。
  * **机制**：前端直接 Fetch 本地接口 (<http://localhost:11434)，利用> Vercel AI SDK Core 的 `dangerouslyAllowBrowser: true` 特性。

### 2.2 技术栈规范

* **核心框架**：Native HTML5 + Vanilla JS + Vite (无 React 依赖)。
* **AI 引擎**：`Vercel AI SDK Core` (`ai` + `@ai-sdk/openai`)，使用 `streamText` 实现流式响应。
* **状态管理**：Store 模式 (参考 `src/core/store.js`) 管理配置与会话状态。
* **Agent 注册表**：策略模式 (Strategy Pattern) 管理不同 Agent 的 System Prompt 和 JSON Schema。

## 3. 功能需求说明 (Functional Requirements)

### 3.1 核心配置管理 (Configuration)

**优先级: P0**

* **F-001 全局配置管理**：
  * 提供统一的配置面板 (Config Modal)。
  * **Base URL**：支持预设 (OpenAI/DeepSeek) 及自定义输入 (用于 Localhost)。
  * **API Key**：加密存储于 LocalStorage，支持掩码显示。
* **F-002 模型选择体验 (F-102, F-103)**：
  * **双模式选择器**：支持下拉选择预设模型，也支持手动输入任意模型 ID。
  * **动态刷新**：提供"刷新模型列表"按钮，调用 `/v1/models` 获取可用模型并缓存。
* **F-003 本地模型适配**：
  * 内置 Ollama/LocalAI 的连接配置指引 (CORS 设置提示)。

### 3.2 智能交互界面 (Interaction UI)

**优先级: P0**

* **F-105 现代化侧边栏 (Chat Sidebar)**：
  * **布局**：右侧抽屉式设计 (Drawer)，宽度可拖拽调节。
  * **UI 风格**：参考 Cursor/Claude，区分 User/AI 气泡，支持 Markdown 渲染与代码高亮。
* **F-203 极简入口设计**：
  * **悬浮按钮**：保留右下角 AI 悬浮按钮，点击直接唤起侧边栏进入"通用助手"模式。
  * **隐藏冗余**：移除顶部工具栏的多个快捷指令按钮，统一收纳至侧边栏或右键菜单。
  * **位置优化 (F-204)**：悬浮按钮默认位移，不遮挡底部视图切换控件。
* **F-202 会话生命周期**：
  * **即时重置**：每次打开侧边栏时，默认开启新会话 (New Chat)，不加载历史记录，确保上下文纯净。
* **F-006 & F-111 状态与反馈**：
  * **流式响应**：打字机效果 (Streaming UI)。
  * **Token 统计**：在回复底部展示 Token 消耗 (Input/Output)。

### 3.3 智能体能力与业务集成 (Agent Capabilities)

**优先级: P0**

* **F-007 上下文感知 (Context Awareness)**：
  * AI 被调用时，自动获取当前选中的任务上下文 (Task Data) 并注入 System Prompt。
* **F-107 结构化输出与渲染**：
  * **JSON 协议**：特定 Agent (如"任务润色") 返回 JSON 格式数据。
  * **动态渲染**：前端根据 `type` 字段渲染不同 UI (如对比视图 Pair View)。
  * **示例**：

        ```json
        { "type": "refine_task", "original": "...", "optimized": "..." }
        ```

* **F-108 结果应用与撤回 (Apply & Undo)**：
  * **应用变更**：用户点击"应用"后，更新 Gantt 数据。
  * **完美撤回 (F-201)**：
    * **机制**：由于 Gantt 原生 Undo 不支持 API 调用，需实现自定义 `UndoManager`。
    * **交互**：AI 修改应用后，自动推入自定义撤回栈。用户按 `Ctrl+Z` 优先触发 AI 撤回，恢复由于 AI 修改导致的数据变更。
    * **UI 备选**：若快捷键有冲突，可在"应用"按钮位置显示"撤回" (Revert) 按钮供手动操作。

### 3.4 错误处理与辅助 (Error Handling)

**优先级: P1**

* **F-104 智能错误转换**：
  * 将 HTTP 401/429/500 等错误映射为用户友好提示 (如"额度已用完", "请检查 Key")。
  * 提供"重试"按钮。

### 3.5 任务管理增强

**优先级: P1**

* **F-112 任务概述字段**：
  * 新增 `description` (Overview) 长文本字段，用于 AI 润色和扩写。
  * 支持在详情页编辑并在 Gantt 表格中略缩展示。

## 4. 非功能需求 (Non-functional)

* **NF-001 安全性**：
  * API Key 禁止明文上报日志。
  * LocalStorage 存储需防范基础 XSS (可选 AES 加密)。
* **NF-002 性能**：
  * UI 去抖动 (Debounce)，防止重复点击消耗 Token。
  * 侧边栏打开/关闭动画流畅，无卡顿。

## 5. 附录：Agent 注册表规划 (示例)

| Agent ID | 名称 | 用途 | 触发位置 (Trigger Location) | 输入上下文 | 输出格式 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `general_chat` | 通用助手 | 自由问答 | 右下角悬浮按钮 / 上下文菜单 | 无 / 选中文本 | Markdown Stream |
| `task_refiner` | 任务润色 | 优化任务描述 | 任务详情页 -> 描述字段工具栏 | 任务标题, 描述 | JSON `{original, optimized}` |
| `wbs_breakdown`| WBS 分解 | 自动拆解子任务 | 任务详情页 -> 子任务模块 | 任务标题 | JSON `{subtasks: []}` |
