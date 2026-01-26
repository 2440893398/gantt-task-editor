# 设计规范: AI Agent 交互优化 v2.0 (DESIGN_SPEC_AI_Agent_优化_v2.0.md)

**文档版本**: v2.0  
**基于**: [DESIGN_SPEC_AI_Agent.md](./DESIGN_SPEC_AI_Agent.md) (v1.0)  
**关联需求**: [PRD-AI-Agent-优化-v2.0.md](../prd/PRD-AI-Agent-优化-v2.0.md)  
**技术栈**: Vanilla JS + Tailwind CSS (v4) + DaisyUI (v5)

---

## 目录

1. [设计概述](#1-设计概述)
2. [业界调研与参考](#2-业界调研与参考)
3. [AI 设置页面优化](#3-ai-设置页面优化)
4. [智能错误提示系统](#4-智能错误提示系统)
5. [AI 交互侧边栏优化](#5-ai-交互侧边栏优化)
6. [JSON 结构化结果展示](#6-json-结构化结果展示)
7. [提示词管理界面](#7-提示词管理界面)
8. [Token 透明化展示](#8-token-透明化展示)
9. [任务概述字段](#9-任务概述字段)
10. [响应式适配](#10-响应式适配)
11. [交互状态与动效](#11-交互状态与动效)
12. [可访问性规范](#12-可访问性规范)

---

## 1. 设计概述

### 1.1 设计目标

本设计规范针对 AI Agent v1.0 进行体验优化升级，聚焦于：

| 优化方向 | 目标 | 对应需求 |
|:-------:|:----:|:--------:|
| 配置体验 | 简化配置流程，支持模型智能选择 | F-101, F-102, F-103 |
| 错误处理 | 友好的错误提示与引导 | F-104 |
| 交互透明 | 多轮对话、结果可视化 | F-105, F-106, F-107, F-108 |
| 高级控制 | 提示词可编辑、重新生成 | F-109, F-110 |
| 成本感知 | Token 使用实时展示 | F-111 |
| 功能增强 | 任务概述字段支持 | F-112 |

### 1.2 设计原则

```
1. 渐进式披露 - 复杂功能分层展示，避免信息过载
2. 即时反馈 - 所有操作 100ms 内给予视觉响应
3. 可撤回性 - 用户操作均可撤回，降低操作焦虑
4. 一致性 - 遵循全局设计规范，复用 DaisyUI 组件
5. Collaborative UX - 用户主导 AI 协作，提供持续反馈循环
6. 透明度与信任 - 明确展示 AI 能力边界，提供操作可见性
```

---

## 2. 业界调研与参考

### 2.1 开源项目推荐

> [!TIP]
> 以下开源项目可作为实现参考或直接复用其设计模式。

| 项目名称 | 技术栈 | 关键特性 | 适用场景 | GitHub |
|:--------:|:------:|:--------:|:--------:|:------:|
| **LobeChat** | Next.js + React | Chain of Thought 可视化、对话分支、Artifacts、MCP 插件 | 全功能 AI 工作台参考 | [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat) |
| **LibreChat** | TypeScript + React | 多模型支持、对话分支、文件附件、Shadcn UI | 多模型切换交互参考 | [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) |
| **Open WebUI** | Python + Svelte | 离线运行、国际化、多模型编排 | 自托管 AI 界面参考 | [open-webui/open-webui](https://github.com/open-webui/open-webui) |
| **assistant-ui** | React + TypeScript | 流式响应、自动滚动、可组合原语、Vercel AI SDK 集成 | React 组件库参考 | [assistant-ui/assistant-ui](https://github.com/Yonom/assistant-ui) |
| **QuikChat** | Vanilla JS | 零依赖、纯 CSS 主题、虚拟滚动 | **推荐：Vanilla JS 实现参考** | [Agentic-Insights/QuikChat](https://github.com/Agentic-Insights/QuikChat) |
| **prompt-kit** | React + shadcn/ui | 聊天 UI 原语、Tailwind CSS | 组件设计参考 | [prompt-kit](https://prompt-kit.com) |

### 2.2 成熟产品设计参考

#### GitHub Copilot Chat

| 特性 | 设计亮点 | 应用建议 |
|:----:|:--------:|:--------:|
| **Agent 模式** | 多步骤自主任务执行，用户审批机制 | 未来高级功能参考 |
| **斜杠命令** | `/doc` `/explain` `/fix` 快速指定意图 | 可在输入框支持快捷命令 |
| **上下文变量** | `#file` `#symbol` 精确提供上下文 | 任务选择后自动填充上下文 |
| **文件预览** | 侧边栏内直接预览 HTML/Markdown/Mermaid | 结果预览功能参考 |
| **Vision 能力** | 支持图片输入辅助 UI 开发 | 未来多模态输入参考 |

#### Cursor AI

| 特性 | 设计亮点 | 应用建议 |
|:----:|:--------:|:--------:|
| **流式响应** | 逐字/逐行显示，减少感知等待时间 | **必须实现** |
| **实时反馈** | 用户可边阅读边处理 | 流式输出时保持交互性 |
| **代码高亮** | 内置语法高亮支持 | 代码结果展示时使用 |

#### LobeChat

| 特性 | 设计亮点 | 应用建议 |
|:----:|:--------:|:--------:|
| **Chain of Thought** | 可视化 AI 推理过程 | F-107 推理过程折叠展示参考 |
| **对话分支** | 从任意消息创建分支探索不同路径 | 多轮对话高级功能参考 |
| **Artifacts** | 实时创建和预览 SVG/HTML/文档 | 结构化结果展示参考 |
| **PWA 支持** | 近原生 App 体验 | 移动端适配参考 |

### 2.3 2025 年 AI UX 设计趋势

> [!IMPORTANT]
> 基于业界调研总结的关键设计趋势，应在本设计中体现。

#### 核心原则

| 趋势 | 描述 | 本设计体现 |
|:----:|:----:|:----------:|
| **透明度与信任** | 明确 AI 能力边界，展示决策过程 | F-107 推理过程可折叠、F-111 Token 统计 |
| **用户控制** | 可编辑、重新生成、撤回 AI 输出 | F-108 应用/撤回、F-110 重新生成 |
| **上下文感知** | 根据用户当前任务提供相关建议 | 任务名称自动填充、上下文携带 |
| **渐进式披露** | 复杂功能分层展示 | F-109 高级设置折叠、错误详情可展开 |
| **Collaborative UX** | 用户主导，AI 协作，持续反馈 | 多轮对话、实时编辑 |

#### 交互模式

| 模式 | 描述 | 实现优先级 |
|:----:|:----:|:----------:|
| **流式响应** | 逐字显示生成内容，减少等待焦虑 | **P0 - 必须** |
| **打字机光标** | 生成时显示闪烁光标 | P1 |
| **骨架屏加载** | AI 思考时显示占位内容 | P1 |
| **可中断生成** | 用户可随时停止生成 | P1 |
| **消息编辑** | 编辑已发送消息重新生成 | P2 |
| **对话分支** | 从历史消息分叉新对话 | P2 |

### 2.4 Vanilla JS 实现参考

由于本项目技术栈为 **Vanilla JS + Tailwind CSS + DaisyUI**，以下是推荐的实现方案：

#### 推荐库

| 功能 | 推荐方案 | 说明 |
|:----:|:--------:|:----:|
| 流式响应 | `fetch` + `ReadableStream` | 原生支持，无需额外依赖 |
| Markdown 渲染 | `marked.js` | 轻量级 Markdown 解析器 |
| 代码高亮 | `highlight.js` | 轻量级语法高亮 |
| 虚拟滚动 | 自定义实现或 `virtual-scroller` | 长对话性能优化 |
| 状态管理 | 原生 `Proxy` 或简单发布订阅 | 无需 Redux 等重型库 |

#### 流式响应实现示例

```javascript
// SSE 流式响应处理
async function streamResponse(url, payload, onChunk) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    onChunk(chunk); // 实时更新 UI
  }
}
```

---

## 3. AI 设置页面优化

### 3.1 配置弹窗布局 (F-101)

在 v1.0 基础上优化视觉层次和布局。

```
┌────────────────────────────────────────────┐
│ ████████████ AI 设置 ████████████████████│  ← 渐变头部
│ 配置您的 AI 模型以启用智能助手                    │
├────────────────────────────────────────────┤
│                                            │
│  🔑 API Key                                │
│  ┌──────────────────────────────────────┐│
│  │ sk-******************************** 👁 ││  ← 密码可见切换
│  └──────────────────────────────────────┘│
│                                            │
│  🌐 Base URL                               │
│  ┌──────────────────────────────────────┐│
│  │ https://api.openai.com/v1            ││
│  └──────────────────────────────────────┘│
│                                            │
│  🤖 模型选择                     [🔄 刷新] │  ← F-103
│  ┌──────────────────────────────────────┐│
│  │ gpt-4o-mini                     ▼   ││  ← F-102 支持搜索
│  └──────────────────────────────────────┘│
│  💡 支持手动输入任意模型名称                      │
│                                            │
├────────────────────────────────────────────┤
│                    [取消]  [保存配置]       │
└────────────────────────────────────────────┘
```

#### 样式规范

| 元素 | Tailwind/DaisyUI 类 | 说明 |
|:----:|:-------------------:|:----:|
| 弹窗容器 | `modal-box max-w-md p-0 overflow-hidden` | 448px 宽度 |
| 头部区域 | `bg-gradient-to-r from-blue-500 to-purple-600 p-6` | 渐变背景 |
| 头部标题 | `font-bold text-lg text-white` | 白色标题 |
| 头部描述 | `text-white/80 text-sm mt-1` | 半透明描述 |
| 表单容器 | `p-6 space-y-5` | 统一内边距 |
| 输入框 | `input input-bordered w-full` | 全宽输入框 |
| 标签文本 | `label-text font-medium text-sm` | 加粗标签 |
| 辅助提示 | `text-xs text-base-content/60 mt-1` | 灰色小字 |

### 3.2 模型下拉选择器优化 (F-102)

支持**下拉选择**与**手动输入**双模式。

```html
<!-- 模型选择器 (Combobox 模式) -->
<div class="form-control">
  <label class="label">
    <span class="label-text font-medium">🤖 模型选择</span>
    <button class="btn btn-xs btn-ghost text-primary gap-1" id="refresh_models_btn">
      <svg class="w-3 h-3"><!-- 刷新图标 --></svg>
      刷新
    </button>
  </label>
  
  <!-- Combobox 容器 -->
  <div class="dropdown w-full">
    <input 
      type="text" 
      class="input input-bordered w-full" 
      placeholder="选择或输入模型名称..."
      id="model_input"
    />
    
    <!-- 下拉列表 -->
    <ul class="dropdown-content menu bg-base-100 rounded-box w-full max-h-60 overflow-y-auto shadow-lg border border-base-300 z-50 mt-1">
      <!-- 分组: OpenAI -->
      <li class="menu-title text-xs text-base-content/50 px-3 py-2">OpenAI</li>
      <li><a class="flex justify-between">
        <span>gpt-4o</span>
        <span class="badge badge-xs badge-primary">推荐</span>
      </a></li>
      <li><a>gpt-4o-mini</a></li>
      <li><a>gpt-4-turbo</a></li>
      
      <!-- 分组: Claude -->
      <li class="menu-title text-xs text-base-content/50 px-3 py-2 mt-2">Anthropic</li>
      <li><a>claude-3-5-sonnet</a></li>
      <li><a>claude-3-haiku</a></li>
    </ul>
  </div>
  
  <label class="label">
    <span class="label-text-alt text-base-content/60">
      💡 可直接输入任意模型名称
    </span>
  </label>
</div>
```

#### 交互规范

| 交互 | 行为 | 视觉反馈 |
|:----:|:----:|:--------:|
| 输入框聚焦 | 展开下拉列表 | 边框高亮 `border-primary` |
| 输入文本 | 实时过滤列表 | 匹配项高亮 |
| 选择选项 | 填充输入框并收起列表 | 输入框显示选中值 |
| 手动输入 | 接受任意文本 | 无需选中列表项 |
| 无匹配项 | 显示"无匹配结果，将使用输入值" | 空状态提示 |

### 3.3 模型列表刷新功能 (F-103)

```html
<!-- 刷新按钮状态 -->

<!-- 默认状态 -->
<button class="btn btn-xs btn-ghost text-primary gap-1">
  <svg class="w-3 h-3"><!-- 刷新图标 --></svg>
  刷新
</button>

<!-- 加载中 -->
<button class="btn btn-xs btn-ghost text-primary gap-1" disabled>
  <span class="loading loading-spinner loading-xs"></span>
  刷新中...
</button>

<!-- 成功状态 (短暂显示后恢复) -->
<button class="btn btn-xs btn-ghost text-success gap-1">
  <svg class="w-3 h-3"><!-- 勾选图标 --></svg>
  已更新
</button>
```

#### 缓存策略

- **缓存有效期**: 24 小时
- **存储位置**: localStorage
- **缓存 Key**: `ai_models_cache_{baseUrl_hash}`
- **UI 提示**: 缓存过期时，刷新按钮显示小红点

---

## 4. 智能错误提示系统 (F-104)

### 4.1 错误类型映射

| 错误类型 | 主色调 | 图标 | 标题 | 建议操作 |
|:--------:|:------:|:----:|:----:|:--------:|
| `quota_exceeded` | `warning` | ⚠️ | 额度已用尽 | 切换模型或充值 |
| `invalid_api_key` | `error` | ❌ | API Key 无效 | 检查配置 |
| `rate_limit_exceeded` | `warning` | ⏱️ | 请求过于频繁 | 稍后再试 |
| `model_not_found` | `error` | 🔍 | 模型不存在 | 选择其他模型 |
| `network_error` | `error` | 🌐 | 网络连接失败 | 检查网络 |
| `unknown` | `error` | ❓ | 未知错误 | 查看详情 |

### 4.2 错误提示 UI

采用 **Alert 卡片** 形式，支持折叠查看原始错误。

```html
<!-- 错误提示卡片 -->
<div class="alert alert-error shadow-lg mb-4">
  <div class="flex-1">
    <div class="flex items-start gap-3">
      <!-- 图标 -->
      <svg class="w-6 h-6 flex-shrink-0 mt-0.5"><!-- 错误图标 --></svg>
      
      <!-- 内容区 -->
      <div class="flex-1 min-w-0">
        <h4 class="font-semibold text-sm">API Key 无效</h4>
        <p class="text-xs opacity-80 mt-1">
          请检查您的 API Key 是否正确配置，确保没有多余的空格。
        </p>
        
        <!-- 建议操作按钮 -->
        <div class="flex gap-2 mt-3">
          <button class="btn btn-xs btn-outline">检查配置</button>
          <button class="btn btn-xs btn-ghost opacity-60">查看详情</button>
        </div>
        
        <!-- 折叠的原始错误 (点击"查看详情"展开) -->
        <div class="collapse collapse-arrow mt-2 hidden" id="error_details">
          <div class="collapse-title text-xs font-medium p-2">
            原始错误信息
          </div>
          <div class="collapse-content">
            <pre class="text-xs bg-base-300 rounded p-2 overflow-x-auto">
{"error": {"message": "Invalid API key provided", "type": "invalid_request_error"}}
            </pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### 4.3 Toast 快捷提示

对于非阻塞性错误，使用 Toast 提示。

```html
<!-- Toast 错误提示 -->
<div class="toast toast-top toast-center z-[99999]">
  <div class="alert alert-error shadow-lg">
    <svg class="w-5 h-5"><!-- 错误图标 --></svg>
    <div>
      <span class="font-medium">请求失败</span>
      <span class="text-xs block opacity-80">网络连接超时，请重试</span>
    </div>
    <button class="btn btn-xs btn-ghost">×</button>
  </div>
</div>
```

---

## 5. AI 交互侧边栏优化 (F-105, F-106)

### 5.1 侧边栏整体布局

参考 Cursor、GitHub Copilot Chat 设计风格。

```
┌────────────────────────────────────────┐
│ ✨ AI 助手              [清空] [×]    │  ← 头部 (固定)
├────────────────────────────────────────┤
│                                        │
│  ┌──────────────────────────────────┐ │
│  │ 👤 用户                           │ │  ← 用户消息气泡
│  │ 帮我优化这个任务名称："UI优化"      │ │
│  └──────────────────────────────────┘ │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │ 🤖 AI                             │ │  ← AI 消息气泡
│  │                                   │ │
│  │ 分析了您的任务名称，建议优化为：    │ │
│  │                                   │ │
│  │ **原始**: UI优化                   │ │
│  │ **优化后**: 优化用户界面交互体验   │ │
│  │                                   │ │
│  │ [应用] [撤回] [🔄]                 │ │  ← 操作按钮
│  │                 Tokens: 150 ↗     │ │  ← Token 统计
│  └──────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤  ← 滚动分隔
│ ┌────────────────────────────────────┐│
│ │ 输入消息...           [📎] [发送] ││  ← 输入区 (固定)
│ └────────────────────────────────────┘│
└────────────────────────────────────────┘
```

### 5.2 侧边栏尺寸规范

| 属性 | 桌面端 (≥1024px) | 平板端 (768-1023px) | 移动端 (<768px) |
|:----:|:----------------:|:-------------------:|:---------------:|
| 宽度 | `w-[420px]` | `w-[380px]` | `w-full` |
| 高度 | `h-full` | `h-full` | `h-[80vh]` |
| 最小宽度 | `min-w-[320px]` | `min-w-[320px]` | - |
| 最大宽度 | `max-w-[520px]` | - | - |
| 可调整宽度 | ✅ 支持拖拽调整 | ✅ | ❌ |

### 5.3 消息气泡样式

```html
<!-- 用户消息 -->
<div class="chat chat-end mb-4">
  <div class="chat-header text-xs opacity-50 mb-1">
    <span>👤 用户</span>
    <time class="ml-2">14:30</time>
  </div>
  <div class="chat-bubble chat-bubble-primary">
    帮我优化这个任务名称："UI优化"
  </div>
</div>

<!-- AI 消息 -->
<div class="chat chat-start mb-4">
  <div class="chat-header text-xs opacity-50 mb-1">
    <span>🤖 AI</span>
    <time class="ml-2">14:30</time>
  </div>
  <div class="chat-bubble bg-base-200 text-base-content">
    <!-- 消息内容支持 Markdown 渲染 -->
    <div class="prose prose-sm max-w-none">
      <p>分析了您的任务名称，建议优化为：</p>
      <ul>
        <li><strong>原始</strong>: UI优化</li>
        <li><strong>优化后</strong>: 优化用户界面交互体验</li>
      </ul>
    </div>
    
    <!-- 操作按钮区 -->
    <div class="flex items-center justify-between mt-3 pt-3 border-t border-base-300">
      <div class="flex gap-2">
        <button class="btn btn-xs btn-primary">应用</button>
        <button class="btn btn-xs btn-ghost">撤回</button>
        <button class="btn btn-xs btn-ghost btn-square" title="重新生成">
          <svg class="w-3 h-3"><!-- 刷新图标 --></svg>
        </button>
      </div>
      <span class="text-xs text-base-content/50">
        Tokens: 150 <span class="text-success">↗</span>
      </span>
    </div>
  </div>
</div>
```

### 5.4 多轮对话 (F-106)

#### 对话历史管理

| 功能 | 实现方式 | 视觉表现 |
|:----:|:--------:|:--------:|
| 显示历史 | 滚动加载 | 时间线排列 |
| 清空对话 | 确认弹窗 | 头部"清空"按钮 |
| 上下文控制 | 配置项 | 设置面板中可配置保留轮数 |

```html
<!-- 清空对话确认 -->
<dialog class="modal modal-bottom sm:modal-middle">
  <div class="modal-box">
    <h3 class="font-bold text-lg">清空对话</h3>
    <p class="py-4 text-sm text-base-content/70">
      确定要清空所有对话记录吗？此操作无法撤销。
    </p>
    <div class="modal-action">
      <button class="btn btn-ghost">取消</button>
      <button class="btn btn-error">清空</button>
    </div>
  </div>
</dialog>
```

---

## 6. JSON 结构化结果展示 (F-107, F-108)

### 6.1 可扩展渲染架构

> [!IMPORTANT]
> 不同 Agent 返回不同 JSON 格式，前端需采用**插件式渲染器**架构，根据 `type` 字段动态选择渲染器。

```
┌─────────────────────────────────────────────────────┐
│                    渲染调度器                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ TaskRefine  │  │ TaskSplit   │  │ TextPolish  │ │
│  │  Renderer   │  │  Renderer   │  │  Renderer   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
│         ↑                ↑                ↑        │
│         └────────────────┼────────────────┘        │
│                          │                          │
│                   type: "xxx"                       │
│                   JSON 响应                         │
└─────────────────────────────────────────────────────┘
```

### 6.2 任务润色结果展示 (task_refine)

```json
{
  "type": "task_refine",
  "original": "UI优化",
  "optimized": "优化用户界面交互体验",
  "reasoning": "原名称过于简短，建议明确优化目标..."
}
```

```html
<!-- 任务润色结果卡片 -->
<div class="card bg-base-200 shadow-sm">
  <div class="card-body p-4">
    <!-- 对比展示 -->
    <div class="grid grid-cols-2 gap-4">
      <!-- 原始 -->
      <div class="space-y-1">
        <div class="text-xs text-base-content/50 flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-error/50"></span>
          原始
        </div>
        <div class="text-sm bg-error/10 border border-error/20 rounded-lg p-3 line-through opacity-60">
          UI优化
        </div>
      </div>
      
      <!-- 优化后 -->
      <div class="space-y-1">
        <div class="text-xs text-base-content/50 flex items-center gap-1">
          <span class="w-2 h-2 rounded-full bg-success"></span>
          优化后
        </div>
        <div class="text-sm bg-success/10 border border-success/20 rounded-lg p-3 font-medium">
          优化用户界面交互体验
        </div>
      </div>
    </div>
    
    <!-- 推理过程 (可折叠) -->
    <details class="collapse collapse-arrow bg-base-100 rounded-lg mt-3">
      <summary class="collapse-title text-xs font-medium py-2 min-h-0">
        💡 查看优化理由
      </summary>
      <div class="collapse-content text-xs text-base-content/70">
        <p>原名称过于简短，建议明确优化目标...</p>
      </div>
    </details>
    
    <!-- 操作按钮 -->
    <div class="card-actions justify-end mt-3">
      <button class="btn btn-sm btn-ghost">撤回</button>
      <button class="btn btn-sm btn-primary">应用</button>
    </div>
  </div>
</div>
```

### 6.3 应用/撤回交互 (F-108)

| 操作 | 按钮样式 | 反馈 |
|:----:|:--------:|:----:|
| 应用 | `btn btn-sm btn-primary` | Toast 成功提示 + 按钮变为"已应用 ✓" |
| 撤回 | `btn btn-sm btn-ghost` | 恢复原值 + 按钮消失 |
| 已应用 | `btn btn-sm btn-success btn-disabled` | 禁用状态 |

```html
<!-- 应用后状态 -->
<div class="card-actions justify-end mt-3">
  <button class="btn btn-sm btn-outline" disabled>
    <svg class="w-4 h-4 mr-1"><!-- 撤回图标 --></svg>
    撤回 (5s)
  </button>
  <button class="btn btn-sm btn-success" disabled>
    <svg class="w-4 h-4 mr-1"><!-- 勾选图标 --></svg>
    已应用
  </button>
</div>
```

---

## 7. 提示词管理界面 (F-109, F-110)

### 7.1 提示词编辑区 (F-109)

仅开放**用户指令**等安全区域编辑。

```html
<!-- 提示词编辑面板 -->
<div class="collapse collapse-arrow bg-base-200 rounded-lg">
  <input type="checkbox" />
  <div class="collapse-title text-sm font-medium">
    ⚙️ 高级设置
  </div>
  <div class="collapse-content space-y-4">
    <!-- 可编辑区域 -->
    <div class="form-control">
      <label class="label">
        <span class="label-text text-xs">用户指令</span>
        <span class="badge badge-xs badge-ghost">可编辑</span>
      </label>
      <textarea class="textarea textarea-bordered text-sm h-20" 
        placeholder="请帮我优化任务名称，使其更加清晰专业...">
      </textarea>
    </div>
    
    <!-- 不可编辑区域 (只读展示) -->
    <div class="form-control">
      <label class="label">
        <span class="label-text text-xs opacity-50">输出格式 (系统限定)</span>
        <span class="badge badge-xs badge-neutral">只读</span>
      </label>
      <div class="bg-base-300 rounded-lg p-3 text-xs font-mono opacity-50">
        返回 JSON 格式: {"type": "task_refine", "original": "...", "optimized": "..."}
      </div>
    </div>
  </div>
</div>
```

### 7.2 重新生成按钮 (F-110)

```html
<!-- 重新生成按钮 -->
<button class="btn btn-xs btn-ghost btn-square tooltip" data-tip="重新生成">
  <svg class="w-4 h-4"><!-- 刷新图标 --></svg>
</button>

<!-- 加载状态 -->
<button class="btn btn-xs btn-ghost btn-square" disabled>
  <span class="loading loading-spinner loading-xs"></span>
</button>
```

---

## 8. Token 透明化展示 (F-111)

### 8.1 Token 统计 UI

在每条 AI 回复下方展示 Token 使用情况。

```html
<!-- Token 统计 (消息气泡内) -->
<div class="flex items-center justify-between text-xs text-base-content/50 mt-2 pt-2 border-t border-base-300/50">
  <div class="flex items-center gap-2">
    <span class="flex items-center gap-1">
      <svg class="w-3 h-3"><!-- 输入图标 --></svg>
      输入: 50
    </span>
    <span class="divider divider-horizontal mx-0"></span>
    <span class="flex items-center gap-1">
      <svg class="w-3 h-3"><!-- 输出图标 --></svg>
      输出: 100
    </span>
  </div>
  <span class="font-medium">
    共 150 tokens
  </span>
</div>
```

### 8.2 会话累计统计

在侧边栏底部输入区上方显示累计统计。

```html
<!-- 会话累计统计 -->
<div class="flex justify-between items-center px-4 py-2 bg-base-200/50 text-xs text-base-content/50 border-y border-base-300">
  <span>本次会话</span>
  <span class="font-mono">
    累计: <span class="text-primary font-semibold">1,234</span> tokens
  </span>
</div>
```

---

## 9. 任务概述字段 (F-112)

### 9.1 甘特图表格列

在任务名称列后新增"任务概述"列。

| 列名 | 宽度 | 特性 |
|:----:|:----:|:----:|
| 任务名称 | 200px | 短文本，内联编辑 |
| 任务概述 | 250px | 长文本，省略显示，悬停展开 |

### 9.2 表格单元格样式

```html
<!-- 任务概述单元格 -->
<td class="max-w-[250px]">
  <div class="truncate text-sm text-base-content/70 cursor-pointer hover:text-primary group relative"
       title="点击查看完整内容">
    这是一段较长的任务描述文本，会被截断显示...
    
    <!-- 悬停展开提示 -->
    <div class="absolute hidden group-hover:block left-0 top-full mt-1 z-50 
                bg-base-100 shadow-xl rounded-lg p-3 min-w-[300px] max-w-[400px]
                border border-base-300 text-sm">
      这是完整的任务概述内容，可以包含多行文本...
    </div>
  </div>
</td>
```

### 9.3 编辑弹窗

```html
<!-- 任务概述编辑 (在任务编辑弹窗中) -->
<div class="form-control">
  <label class="label">
    <span class="label-text">任务概述</span>
    <span class="label-text-alt text-base-content/50">可选</span>
  </label>
  <textarea class="textarea textarea-bordered h-24 resize-y" 
    placeholder="输入详细的任务描述...">
  </textarea>
  <label class="label">
    <span class="label-text-alt text-base-content/50">
      支持多行输入，最多 500 字符
    </span>
  </label>
</div>
```

---

## 10. 响应式适配

### 10.1 断点适配策略

| 组件 | 桌面端 (≥1024px) | 平板端 (768-1023px) | 移动端 (<768px) |
|:----:|:----------------:|:-------------------:|:---------------:|
| 配置弹窗 | 居中 `max-w-md` | 居中 `max-w-sm` | 底部抽屉 `modal-bottom` |
| AI 侧边栏 | 右侧固定 420px | 右侧固定 380px | 全屏覆盖 |
| 对话气泡 | 标准尺寸 | 标准尺寸 | 全宽 |
| Token 统计 | 行内显示 | 行内显示 | 折行显示 |

### 10.2 移动端特殊处理

```html
<!-- 移动端配置弹窗 -->
<dialog class="modal modal-bottom lg:modal-middle">
  <div class="modal-box max-h-[80vh] rounded-t-3xl lg:rounded-2xl">
    <!-- 移动端拖拽条 -->
    <div class="w-12 h-1.5 bg-base-300 rounded-full mx-auto mb-4 lg:hidden"></div>
    
    <!-- 弹窗内容 -->
    ...
  </div>
</dialog>
```

---

## 11. 交互状态与动效

### 11.1 状态颜色映射

| 状态 | 颜色 | Tailwind 类 | 说明 |
|:----:|:----:|:----------:|:----:|
| 未配置 | 灰色 | `opacity-50 grayscale` | 功能不可用 |
| 就绪 | 主色 | `btn-primary` | 正常可用 |
| 思考中 | 主色脉冲 | `animate-pulse` | 等待响应 |
| 生成中 | 主色 | `loading` | 流式输出 |
| 成功 | 绿色 | `text-success` | 操作成功 |
| 错误 | 红色 | `text-error` | 操作失败 |

### 11.2 动效规范

| 动效 | 时长 | 缓动 | 用途 |
|:----:|:----:|:----:|:----:|
| 侧边栏滑入 | 300ms | `ease-out` | 打开侧边栏 |
| 侧边栏滑出 | 200ms | `ease-in` | 关闭侧边栏 |
| 按钮悬停 | 150ms | `ease-in-out` | 交互反馈 |
| Toast 淡入 | 200ms | `ease-out` | 消息提示 |
| 下拉展开 | 200ms | `ease-out` | 菜单展开 |

```css
/* 侧边栏动画 */
.drawer-slide-in {
  animation: slideInRight 300ms ease-out forwards;
}

.drawer-slide-out {
  animation: slideOutRight 200ms ease-in forwards;
}

@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes slideOutRight {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}
```

---

## 12. 可访问性规范

### 12.1 键盘操作

| 按键 | 操作 |
|:----:|:----:|
| `Tab` | 焦点在弹窗/侧边栏内循环 |
| `Escape` | 关闭弹窗/侧边栏 |
| `Enter` | 确认/提交 |
| `Arrow Up/Down` | 在下拉列表中导航 |

### 12.2 ARIA 属性

```html
<!-- 侧边栏 -->
<aside 
  role="dialog" 
  aria-modal="false" 
  aria-labelledby="ai_drawer_title"
  aria-describedby="ai_drawer_desc">
  <h2 id="ai_drawer_title">AI 助手</h2>
  <p id="ai_drawer_desc" class="sr-only">与 AI 助手对话，优化您的任务</p>
</aside>

<!-- 流式输出区 -->
<div aria-live="polite" aria-atomic="false" id="ai_output">
  <!-- AI 生成内容实时更新 -->
</div>

<!-- 错误提示 -->
<div role="alert" aria-live="assertive">
  API Key 无效，请检查配置
</div>
```

### 12.3 焦点管理

- **弹窗打开**: 焦点移动到第一个可交互元素
- **弹窗关闭**: 焦点返回触发按钮
- **侧边栏打开**: 焦点移动到输入框
- **错误出现**: 焦点移动到错误提示区域

---

## 附录: 设计资产

### 图标资源

使用 Heroicons (Outline 风格)：

| 用途 | 图标名称 | 预览 |
|:----:|:--------:|:----:|
| AI 入口 | `SparklesIcon` | ✨ |
| 刷新 | `ArrowPathIcon` | 🔄 |
| 应用 | `CheckIcon` | ✓ |
| 撤回 | `ArrowUturnLeftIcon` | ↩ |
| 错误 | `ExclamationCircleIcon` | ⚠️ |
| 关闭 | `XMarkIcon` | × |
| 发送 | `PaperAirplaneIcon` | ➤ |
| Token | `CurrencyDollarIcon` | 💰 |

### 颜色快查

| 语义 | Tailwind 类 | 用途 |
|:----:|:-----------:|:----:|
| 主色 | `primary` | 按钮、链接、强调 |
| 成功 | `success` | 应用成功、完成状态 |
| 警告 | `warning` | 额度警告、注意事项 |
| 错误 | `error` | 错误提示、危险操作 |
| 中性 | `base-content/50` | 辅助文字、禁用状态 |

---

**文档结束**
