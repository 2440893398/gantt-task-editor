# 技术设计规范 (Design Spec): 分布式前端 AI Agent 系统

> **文档状态**: Draft
> **关联 PRD**: [PRD-AI-Agent-Master.md](../prd/PRD-AI-Agent-Master.md)
> **参考**: `ui-ux-pro-max`, `Vercel AI SDK Core`

## 1. 系统架构设计 (Architecture)

### 1.1 双通道通信架构图

系统采用"双通道"策略以兼顾云端 API 的安全性和本地模型的可访问性。

```mermaid
graph TD
    User[用户终端]
    
    subgraph Frontend [前端应用 (Vanilla JS + Vite)]
        Store[Store (LocalStorage)]
        UI[AI 侧边栏 UI]
        Hook[useBYOKAgent Hook]
        
        UI -->|触发| Hook
        Hook -->|读取 Key/URL| Store
    end
    
    subgraph Backend_Proxy [Next.js API Route (无状态代理)]
        Proxy[Proxy Handler]
    end
    
    subgraph Models [模型层]
        OpenAI[OpenAI / DeepSeek]
        Local[Localhost (Ollama)]
    end
    
    %% 通道 A: 代理模式
    Hook -->|通道 A (云端)| Proxy
    Proxy -->|请求 (Carry Key)| OpenAI
    OpenAI -.->|SSR Stream| Proxy
    Proxy -.->|Response Stream| Hook
    
    %% 通道 B: 直连模式
    Hook -->|通道 B (本地)| Local
    Local -.->|CORS Stream| Hook
```

### 1.2 目录结构规划

遵循 `features/` 模块化设计：

```text
src/
├── features/
│   └── ai/
│       ├── api/
│       │   ├── client.js          # AI SDK Core 封装 (runAgentStream)
│       │   └── providers.js       # Model Provider 工厂 (OpenAI/Ollama)
│       ├── components/
│       │   ├── AiSidebar.js       # 侧边栏容器
│       │   ├── ChatMessage.js     # 消息气泡 (Markdown 渲染)
│       │   ├── AiConfigModal.js   # 配置弹窗
│       │   └── AiFloatingBtn.js   # 悬浮入口
│       ├── renderer/
│       │   ├── index.js           # 动态渲染器入口
│       │   ├── JsonRenderer.js    # JSON 结构化展示组件
│       │   └── UndoRenderer.js    # 撤回操作 UI
│       ├── services/
│       │   ├── aiService.js       # 业务逻辑门面
│       │   ├── undoManager.js     # 自定义撤回栈 (F-201)
│       │   └── agentRegistry.js   # Agent 策略表
│       ├── styles/
│       │   └── ai-theme.css       # 独立样式变量
│       └── index.js               # 模块导出
```

## 2. UI/UX 设计规范

基于 `ui-ux-pro-max` 指导思想，采用现代化、轻量级设计。

### 2.1 颜色系统 (Theme)

自定义 CSS 变量，支持暗色模式适配。

```css
:root {
  /* AI 品牌色 - 采用紫色系体现智能感 */
  --ai-primary: #8B5CF6;       /* Violet-500 */
  --ai-primary-hover: #7C3AED; /* Violet-600 */
  --ai-bg-gradient: linear-gradient(135deg, #F3E8FF 0%, #FFFFFF 100%);
  
  /* 消息气泡 */
  --msg-user-bg: #8B5CF6;
  --msg-user-text: #FFFFFF;
  --msg-ai-bg: #F3F4F6;        /* Gray-100 */
  --msg-ai-text: #1F2937;      /* Gray-800 */
}

/* Dark Mode 适配 */
[data-theme='dark'] {
  --msg-ai-bg: #374151;        /* Gray-700 */
  --msg-ai-text: #F9FAFB;      /* Gray-50 */
}
```

### 2.2 核心组件交互描述

1. **AI Floating Button (悬浮入口)**
    * **样式**: 圆形紫色渐变按钮，带 AI Sparkle 图标。
    * **动效**: Hover 时微抬升 (`transform: translateY(-2px)`) + 阴影加深。
    * **位置**: `bottom: 4rem; right: 2rem;` (避开 Gantt 视图切换器)。

2. **Chat Sidebar (侧边栏)**
    * **容器**: 屏幕右侧固定定位 (`position: fixed`)，默认宽度 `400px`，支持 Handle 拖拽调整。
    * **Header**: 包含 "New Chat" (重置)、"Settings" (配置) 按钮。
    * **Scroll**: 消息列表区域独立滚动，底部 Input 区域固定。

3. **Config Modal (配置)**
    * **Mask**: 玻璃磨砂效果 (`backdrop-filter: blur(4px)`).
    * **Input**: API Key 输入框支持 `type="password/text"` 切换显示。

## 3. 数据流与状态管理设计

### 3.1 Store 设计 (src/core/store.js 扩展)

```javascript
/* Store State 扩展 */
{
  aiConfig: {
    baseUrl: "https://api.openai.com/v1", // Default
    apiKey: "sk-...",                     // 加密存储
    model: "gpt-4o-mini",
    provider: "openai"                    // 'openai' | 'ollama'
  },
  aiSession: {
    messages: [],    // 当前会话历史
    isLoading: false,
    usage: { input: 0, output: 0 }
  }
}
```

### 3.2 撤回栈管理 (UndoManager)

针对 F-201 需求，实现专用撤回栈。

* **Snapshot 结构**:

    ```javascript
    {
      type: 'AI_UPDATE',
      taskId: '123',
      before: { description: 'Old...' },
      after: { description: 'New...' },
      timestamp: 1700000000
    }
    ```

* **操作流**:
    1. AI 返回优化结果 -> 用户点击 "Apply"。
    2. `undoManager.push(snapshot)`。
    3. 用户按 `Ctrl+Z` -> `undoManager.pop()` -> 恢复 `before` 状态。
    4. 若 `undoManager` 为空，则透传给 Gantt 原生 Undo。

## 4. 安全策略 (Security)

### 4.1 API Key 存储

* **存储位置**: `localStorage` (Key: `gantt_ai_config`)。
* **加密方案**: 简单 Base64 混淆或 AES (取决于引入 crypto-js 成本)。
  * *决策*: 鉴于它是纯前端项目且 Key 由用户提供，明文存储于 LocalStorage (仅本地访问) 是即开即用的 MVP 方案。若需更高安全，可后续增加 Session 级内存存储模式。

### 4.2 网络传输

* **Proxy 模式**: Header `x-api-key` 传输，HTTPS 保证通道安全。
* **Direct 模式**: 仅在 `localhost` 或 HTTPS 环境下直连。

## 5. Agent 注册表实现 (Strategy Pattern)

```javascript
// features/ai/services/agentRegistry.js

export const AGENT_REGISTRY = {
  // 通用聊天
  'general_chat': {
    system: () => `You are a helpful project assistant...`,
    renderer: 'markdown' 
  },
  // 任务润色
  'task_refine': {
    system: (ctx) => `Refine this task: ${ctx.task.text}... Response JSON...`,
    renderer: 'json_diff', // 专用 JSON 对比渲染器
    jsonSchema: { ... }
  }
}
```
