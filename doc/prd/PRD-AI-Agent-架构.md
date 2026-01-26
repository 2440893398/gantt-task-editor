# 产品需求文档 (PRD): 分布式前端 AI Agent 架构 (BYOK 模式)

## 1. 项目背景与目标
随着大语言模型 (LLM) 的普及，为了降低应用运营成本并赋予用户更高的数据控制权，本项目旨在构建一套**"自带密钥" (Bring Your Own Key, BYOK)** 的前端智能体架构。该架构允许开发者预设业务逻辑（Prompt/Agent），而将算力成本和模型选择权下放给终端用户。

### 1.1 核心价值
- **解耦**：业务逻辑（Prompt）与算力资源（API Key/Model）分离。
- **隐私**：用户数据直接流向用户信任的模型提供商，应用端不存储敏感数据。
- **灵活**：支持 OpenAI 兼容接口，用户可自由切换云端（OpenAI/DeepSeek）或本地（Ollama）模型。

## 2. 用户角色
| 角色 | 描述 | 核心需求 |
| :--- | :--- | :--- |
| **最终用户** | 使用 AI 功能的人员 | 配置自己的 API Key/URL，使用 AI 辅助功能（润色、报告生成），数据安全。 |
| **开发者** | 构建应用的人员 | 预设智能体逻辑（Prompt），无需承担 Token 成本，易于维护和扩展 Agent。 |

## 3. 功能需求

### 3.1配置管理 (Configuration Management)
- **F-001 API 配置入口**：提供全局或局部的配置界面，允许用户输入 `Base URL` 和 `API Key`。
- **F-002 配置持久化**：支持将配置保存在本地（LocalStorage/SessionStorage），并在会话间保持（可选）。
- **F-003 本地模型支持**：明确支持 `localhost` 地址（如 Ollama），并处理跨域提示。

### 3.2 智能体交互 (Agent Interaction)
- **F-004 预设智能体调用**：系统内置多个特定场景的 Agent（如"任务润色助手"、"Bug 报告专家"），用户点击即触发。
- **F-005 流式响应 (Streaming)**：AI 响应必须以流式打字机效果展示，提供即时反馈。
- **F-006 状态反馈**：明确展示 AI 的加载、生成、错误（如 Key 无效、网络错误）状态。
- **F-007 动态上下文注入**：Agent 调用时需能读取当前页面上下文（如选中的任务文本、当前环境信息）并注入 Prompt。

### 3.3 兼容性与路由
- **F-008 OpenAI 协议兼容**：系统必须支持标准 OpenAI Chat/Completion 接口协议。
- **F-009 智能路由**：根据用户配置的 URL 自动选择通信策略（云端代理转发 vs 本地直连）。

## 4. 非功能需求
- **NF-001 安全性**：用户 Key 不得明文传输至应用后端日志，建议仅在内存或本地加密存储。
- **NF-002 响应速度**：UI 交互需去抖动，避免重复请求浪费 Token。
- **NF-003 可维护性**：Prompt 和 Agent 逻辑需与 UI 代码分离，支持独立维护。

---

# 附录 A: Gantt 项目具体实施方案 (Vanilla JS + Vite)

<div class="alert alert-info">
  <b>技术栈确认：</b> 本项目使用 Native HTML5 + Vanilla JS + Vite。
  <b>框架选型：</b> 采用 <b>Vercel AI SDK Core</b> (<code>ai</code> + <code>@ai-sdk/openai</code>) 作为底层流式框架。该库提供了标准化的 LLM 接入层和流式解析器，在浏览器端（Vanilla JS）亦有良好支持。
</div>

## A.1 架构设计

### 1. 依赖引入
需要安装的核心库：
```bash
npm install ai @ai-sdk/openai zod
```
*(注: `zod` 用于结构化输出定义)*

### 2. 目录结构规划
AI 模块独立于业务逻辑，但在 `src/features/ai` 中统一管理。

```text
src/
├── features/
│   └── ai/
│       ├── api/
│       │   └── client.js          # Vercel AI SDK Core 封装
│       ├── components/
│       │   ├── AiConfigModal.js   # 配置弹窗 UI
│       │   └── AiFloatingBtn.js   # 悬浮入口按钮
│       ├── prompts/
│       │   └── agentRegistry.js   # Prompt 注册表
│       ├── services/
│       │   └── aiService.js       # 给前端调用的业务门面
│       └── manager.js             # 模块初始化
├── core/
│   └── store.js                   # AI 配置状态 (API Key, URL)
```

## A.2 关键模块实现

### 1. 核心流式客户端 (AI SDK Integration)
使用 `ai` 库的 `streamText` 函数替代原始 fetch，获得更稳定的 SSE 解析和错误处理。

*文件: `src/features/ai/api/client.js`*
```javascript
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { store } from '@/core/store'; 

export async function runAgentStream(agentConfig, userContext, onChunk, onFinish) {
  // 1. 从 Store 获取配置
  const { apiKey, baseUrl, model } = store.state.aiConfig;
  
  // 2. 动态创建 Provider (BYOK 核心)
  const openai = createOpenAI({
    apiKey: apiKey || 'dummy', // 若本地模型无Key可传任意值
    baseURL: baseUrl
  });

  // 3. 执行流式调用
  const result = await streamText({
    model: openai(model || 'gpt-3.5-turbo'),
    system: agentConfig.system,
    prompt: agentConfig.userPrompt(userContext),
    // 浏览器端流式必须处理
    headers: {
       // 特殊处理 CORS 或 Proxy 头
    }
  });

  // 4. 处理流
  for await (const textPart of result.textStream) {
    onChunk(textPart);
  }
  
  onFinish && onFinish();
}
```

### 2. 智能体注册表 (Agent Registry)
保持纯配置化设计。

*文件: `src/features/ai/prompts/agentRegistry.js`*
```javascript
export const AGENTS = {
  TASK_REFINE: {
    id: 'task_refine',
    name: '任务润色',
    system: '你是一个资深项目经理...',
    userPrompt: (ctx) => `请优化以下任务描述：\n${ctx.text}`
  }
};
```

### 3. UI 组件与交互
- **配置弹窗**: 使用 DaisyUI `modal` 组件。
- **流式反馈**: 在 UI 上维护一个 `currentText` 变量，每次 `onChunk` 回调时追加文本并更新 DOM `innerText`。无需 React State，直接操作 DOM 节点。

## A.3 开发计划 (Roadmap)

### 第一阶段：集成 AI SDK (P0)
- [ ] 安装 `ai` 和 `@ai-sdk/openai`。
- [ ] 封装基础 Client (`src/features/ai/api/client.js`) 并进行单元测试。
- [ ] 更新 `store.js` 支持 AI 配置。

### 第二阶段：UI 开发 (P1)
- [ ] 开发全局 AI 配置面板。
- [ ] 集成到 Gantt 任务详情页：添加 "AI 润色" 按钮。

### 第三阶段：本地模型联调 (P2)
- [ ] 编写 "Ollama 本地接入指南"。
- [ ] 验证 `localhost` 跨域与流式传输稳定性。
