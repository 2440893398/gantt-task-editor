# **分布式前端智能体架构与“自带密钥”（BYOK）模式实施深度研究报告**

## **1\. 执行摘要与架构背景**

### **1.1 范式转移：从 SaaS 到 BYOK 的架构重构**

随着大型语言模型（LLM）能力的商品化，前端应用程序集成的范式正在经历从集中式 SaaS 代理模式向去中心化的“自带密钥”（Bring Your Own Key, BYOK）模式的根本性转变。本报告针对一种特定的架构需求进行深度调研：即构建一个前端智能体框架，该框架允许开发者预设业务逻辑（即“智能体”的行为与提示词），而将推理计算资源的配置权（API 地址与密钥）完全下放给终端用户。

这种架构的核心价值在于**解耦**。它将“智力结构”（Prompt Engineering、Agent Workflow）与“算力成本”（Inference Cost）分离开来。对于开发者而言，这意味着可以交付高度复杂的 AI 辅助功能（如任务详情润色、代码自动审查、文本摘要）而无需承担昂贵的 Token 消耗或复杂的后端鉴权设施；对于用户而言，这意味着数据隐私的掌控权以及对模型选择的灵活性（例如，通过配置兼容接口指向本地部署的 Ollama 或私有化部署的 DeepSeek 模型）。

### **1.2 核心需求与技术挑战分析**

根据需求定义，目标系统必须满足以下关键技术指标：

1. **动态配置注入（Dynamic Configuration Injection）：** 框架必须支持在运行时（Runtime）动态读取用户输入的 Base URL 和 API Key，而非在构建时（Build-time）硬编码。  
2. **预设智能体编排（Preset Agent Orchestration）：** 开发者需要预先定义多个场景下的智能体（例如“任务润色助手”、“Bug 报告生成器”），这些定义包含复杂的 System Prompt 和 Few-Shot Examples，且必须易于维护和扩展。  
3. **条件触发机制（Conditional Triggering）：** UI 组件（如 AI 按钮）的状态必须与配置状态强绑定——无配置即不可用，有配置即自动调用。  
4. **OpenAI 接口兼容性（OpenAI Interface Compatibility）：** 系统必须通过标准化的 OpenAI Chat Completion API 协议与后端通信，以兼容广泛的云端和本地模型提供商。

本报告基于 170 余份技术文献的深度分析，评估了当前主流的前端 AI 框架（Vercel AI SDK, LangChain.js, CopilotKit 等），并提出了一套基于 **Vercel AI SDK Core/UI** 与 **策略模式（Strategy Pattern）** 结合的混合架构方案，以最优路径解决上述挑战。

## ---

**2\. 前端智能体框架选型与生态位分析**

在当前的 JavaScript/TypeScript 生态中，AI 框架呈现出分层化的竞争格局。为了满足“易于维护提示词”和“前端轻量接入”的双重需求，我们需要在**流式传输（Streaming）**、**状态管理（State Management）** 和 **提示词工程（Prompt Engineering）** 三个维度上评估各框架的适用性。

### **2.1 Vercel AI SDK：流式交互的标准基础设施**

Vercel AI SDK 目前是 React/Next.js 生态中构建 AI 用户界面的事实标准 1。其核心优势在于对流式响应（Streaming Response）的极致优化和对 React Hook 范式的深度集成。

#### **2.1.1 核心 Hook 的适用性分析：useCompletion vs useChat**

针对“任务详情润色”这一特定场景，即“输入文本 ![][image1] AI 处理 ![][image1] 输出文本”的单轮交互模式，Vercel AI SDK 提供了 useCompletion Hook 2。

* **架构契合度：** useCompletion 专为文本补全和生成设计，它自动管理 input（输入）、completion（补全结果）、isLoading（加载状态）等生命周期状态。这与“点击按钮润色任务详情”的需求完美通过。  
* **BYOK 支持：** 调研发现，Vercel AI SDK 允许在调用触发函数（complete 或 submit）时动态传递 headers 和 body 4。这一点至关重要，因为它允许应用在用户点击按钮的瞬间，从 LocalStorage 或 Context 中读取最新的 API Key，从而避免了 Hook 初始化时的闭包陷阱（Stale Closure）问题 5。

#### **2.1.2 跨平台与接口兼容性**

Vercel AI SDK 通过 createOpenAI 函数提供了极强的适配能力。开发者可以实例化一个自定义的 provider 对象，仅需修改 baseURL 即可无缝切换至 Groq、DeepSeek 或 Localhost 6。这种设计天然满足了“兼容 OpenAI 接口地址”的需求。

### **2.2 LangChain.js：提示词工程的重型编排器**

LangChain.js 是一个功能全面的 LLM 应用编排框架。虽然其在构建复杂代理（Agentic Workflow）方面表现出色，但在纯前端 UI 交互层面显得较为厚重 7。

#### **2.2.1 提示词模板（PromptTemplate）的价值**

LangChain.js 最核心的价值在于其 PromptTemplate 抽象 9。对于需求中提到的“每个场景提示词可能都不一样，需要容易维护”，LangChain 提供了标准化的模板语言（例如 PromptTemplate.fromTemplate("将以下任务转换为{tone}风格: {task}")）。这使得提示词可以作为独立模块进行管理、版本控制，甚至从远程配置中心加载。

* **深度洞察：** 虽然 Vercel AI SDK 也支持设置 system 提示词，但它是以字符串形式传递的。当提示词逻辑变得复杂（包含条件分支、多变量注入）时，引入 LangChain.js 的提示词模块作为辅助工具是一个明智的架构决策，即便我们不使用其执行链（Chain）功能。

### **2.3 CopilotKit 与 Assistant-UI：全栈式“无头”组件**

CopilotKit 和 Assistant-UI 代表了新一代的“Agent-Native” UI 库 11。

* **CopilotKit：** 提供了 useCopilotChatHeadless 等 Hook，旨在构建能够感知全站上下文（Context-Aware）的 Copilot。如果“任务润色”需要读取当前页面上的其他数据（如项目截止日期、相关人员），CopilotKit 的 useCopilotReadable 机制将非常有重。但如果仅是纯粹的文本处理，引入整个 Copilot Runtime 可能带来不必要的复杂度 14。  
* **Assistant-UI：** 专注于生成式 UI（Generative UI）的渲染。如果“润色”后的结果不仅是文本，而是结构化的 React 组件（例如一个带有复选框的任务列表），Assistant-UI 是最佳选择。

### **2.4 选型结论**

综合考量“前端接入容易”与“提示词易维护”的需求，最佳方案并非单一框架的选择，而是**组合架构**：

1. **执行层（Runtime）：** 使用 **Vercel AI SDK (useCompletion)** 处理 API 通信、流式解码和 UI 状态管理。其轻量级和对 OpenAI 接口的原生兼容性使其成为 BYOK 模式的首选。  
2. **逻辑层（Logic）：** 借鉴或轻量引入 **LangChain.js** 的提示词管理思想（或直接使用简单的 TypeScript 字符串模板映射），构建一个中心化的“智能体注册表”。

## ---

**3\. BYOK 架构实施详解：双通道传输策略**

实施 BYOK 的核心挑战在于网络传输层的安全性与连通性。由于浏览器安全策略（CORS）和网络拓扑（Localhost 访问）的限制，我们必须设计一种支持“双通道”的架构。

### **3.1 通道 A：无状态中转代理（Stateless Proxy）**

这是应对商业 API（如 OpenAI, Anthropic）的标准模式。由于这些服务通常不直接支持浏览器端的跨域请求（CORS），或者出于隐藏系统提示词（System Prompt）的需求，我们需要一个后端路由作为中转。

* **工作流：**  
  1. 客户端从 LocalStorage 读取用户的 API Key 和 Base URL。  
  2. 客户端将 Key、URL 以及用户输入的数据，通过 HTTPS 发送给自己的后端 API（如 Next.js Route Handler）。  
  3. **关键点：** 后端 API 是**无状态**的。它不存储用户的 Key，而是将其提取出来，实例化一个临时的 OpenAI Client，向目标 LLM 发起请求 6。  
  4. 后端将 LLM 的流式响应透传回客户端。  
* **优势：** 解决了 CORS 问题；可以在服务端注入复杂的 System Prompt，对用户隐藏具体的提示词工程细节（虽然用户持有 Key，但 Prompt 是开发者的知识产权）。

### **3.2 通道 B：纯客户端直连（Client-Direct）**

这是应对本地模型（如 Ollama, LM Studio）的必要模式。如果用户配置的 Base URL 是 http://localhost:11434，部署在云端的服务器（如 Vercel）是无法访问用户本地机器的。

* **工作流：**  
  1. 客户端检测到 Base URL 为本地地址（localhost/127.0.0.1）。  
  2. 客户端直接使用浏览器内置的 fetch 或 Vercel AI SDK 的 Core 库（配置 dangerouslyAllowBrowser: true）发起请求 16。  
* **先决条件：** 用户必须配置本地模型服务允许跨域（例如 Ollama 需设置 OLLAMA\_ORIGINS="\*"）。

### **3.3 架构决策矩阵**

| 特性 | 无状态中转代理 (Proxy) | 纯客户端直连 (Direct) |
| :---- | :---- | :---- |
| **适用场景** | OpenAI, Groq, DeepSeek 等公网 API | Ollama, LocalAI 等本地服务 |
| **CORS 处理** | 由后端解决，无需用户操心 | 依赖模型服务端的 CORS 配置 |
| **Prompt 安全** | 高（存储在服务端） | 低（暴露在 Network 面板） |
| **实现难度** | 中（需维护 API Route） | 低（纯前端逻辑） |
| **推荐策略** | **默认模式** | **降级/特定模式** |

## ---

**4\. 核心功能实现：智能体注册表与动态接入**

为了满足“每个场景 AI Agent 提示词可能都不一样，需要容易维护”的要求，我们不能将提示词硬编码在 React 组件中。我们需要构建一个**智能体注册表（Agent Registry）**。

### **4.1 智能体注册表设计模式**

注册表是一个纯逻辑模块，它定义了所有可用智能体的 ID、系统提示词模板以及参数配置。这不仅实现了代码与数据的分离，还为未来的远程配置（Remote Config）打下了基础。

TypeScript

// lib/agent-registry.ts  
// 这是一个中心化的智能体配置文件，易于维护和扩展

export interface AgentConfig {  
  id: string;  
  name: string;  
  systemPrompt: (context?: any) \=\> string; // 支持动态上下文注入  
  temperature?: number;  
}

export const AGENT\_REGISTRY: Record\<string, AgentConfig\> \= {  
  "task-refiner": {  
    id: "task-refiner",  
    name: "任务详情润色助手",  
    systemPrompt: () \=\> \`你是一个专业的敏捷项目管理专家。  
    请将用户输入的粗略任务描述，改写为标准的 Jira Ticket 格式。  
    包含：【用户故事】、【验收标准】和【前置条件】。  
    保持语气专业、客观。\`,  
    temperature: 0.3,  
  },  
  "bug-reporter": {  
    id: "bug-reporter",  
    name: "Bug 报告标准化专家",  
    systemPrompt: (context) \=\> \`你是一个 QA 专家。  
    当前运行环境：${context?.env |

| '未知'}。  
    请将用户的描述转化为标准的 Bug Report。  
    必须包含：复现步骤、预期结果、实际结果。\`,  
    temperature: 0.1,  
  }  
};

### **4.2 前端组件架构：\<AIButton\> 与 Hook 封装**

我们需要封装一个通用的 Hook useBYOKAgent，它负责连接 UI、配置存储和执行引擎。

#### **4.2.1 配置存储层**

建议使用 zustand 或 React Context 来全局管理用户的 API 配置，避免 Props Drilling。

TypeScript

// stores/user-config.ts  
interface AIConfig {  
  apiKey: string;  
  baseUrl: string;  
  isConfigured: boolean;  
}  
//... 实现状态存储逻辑

#### **4.2.2 核心 Hook 实现**

此 Hook 封装了 Vercel AI SDK 的 useCompletion，并在触发时动态注入 headers。这是实现 BYOK 的关键代码路径 2。

TypeScript

// hooks/use-byok-agent.ts  
import { useCompletion } from '@ai-sdk/react';  
import { useAIConfigStore } from '@/stores/user-config';

export function useBYOKAgent(agentId: string) {  
  const { apiKey, baseUrl, isConfigured } \= useAIConfigStore();

  const { complete, completion, isLoading, stop } \= useCompletion({  
    api: '/api/ai/proxy', // 指向我们的无状态代理  
    headers: {  
      // 关键：在 Hook 层面不传递静态 Key，防止闭包过时  
      // 这里可以留空，而在 execute 时传递  
    },  
    onError: (err) \=\> {  
      console.error("AI Error:", err);  
      // 处理 401 错误，提示用户检查 Key  
    }  
  });

  const execute \= async (input: string, context?: any) \=\> {  
    if (\!isConfigured) {  
      throw new Error("AI not configured");  
    }

    // 触发流式请求，通过 body 传递 agentId，通过 headers 传递凭证  
    // 这种模式确保了凭证是最新的，且仅在请求时刻被读取  
    return complete(input, {  
      body: {   
        agentId,  
        context   
      },  
      headers: {  
        'x-byok-key': apiKey,  
        'x-byok-url': baseUrl  
      }  
    });  
  };

  return { execute, completion, isLoading, isConfigured };  
}

#### **4.2.3 任务输入框组件实现**

组件层只需关注 UI 逻辑，条件判断（Configured?）被封装在业务逻辑中。

TypeScript

// components/TaskInput.tsx  
import { useBYOKAgent } from '@/hooks/use-byok-agent';

export function TaskInput() {  
  const \= useState("");  
  // 指定使用 'task-refiner' 这个预设智能体  
  const { execute, completion, isLoading, isConfigured } \= useBYOKAgent("task-refiner");

  // 当 AI 流式输出时，实时更新输入框（或显示在预览区）  
  useEffect(() \=\> {  
    if (completion) setTaskDetail(completion);  
  }, \[completion\]);

  const handleRefine \= () \=\> {  
    if (\!isConfigured) {  
      // 引导用户打开配置模态框  
      openConfigModal();  
      return;  
    }  
    execute(taskDetail);  
  };

  return (  
    \<div className="relative"\>  
      \<textarea   
        value={isLoading? completion : taskDetail} // 加载时显示 AI 生成内容  
        onChange={e \=\> setTaskDetail(e.target.value)}  
        disabled={isLoading}  
      /\>  
      \<button   
        onClick={handleRefine}  
        disabled={isLoading}  
        className={\!isConfigured? "opacity-50" : ""}  
      \>  
        {isLoading? "优化中..." : "AI 润色"}  
        {\!isConfigured && \<span className="tooltip"\>请先配置 AI\</span\>}  
      \</button\>  
    \</div\>  
  );  
}

## ---

**5\. 深入后端实现与安全性考量**

为了支持上述前端逻辑，后端 API Route 需要扮演“智能路由”的角色。

### **5.1 Next.js API Route 实现 (Proxy Mode)**

后端不仅是转发器，更是**策略执行点**。它负责根据前端传来的 agentId 加载对应的 System Prompt。

TypeScript

// app/api/ai/proxy/route.ts  
import { createOpenAI } from '@ai-sdk/openai';  
import { streamText } from 'ai';  
import { AGENT\_REGISTRY } from '@/lib/agent-registry';

export async function POST(req: Request) {  
  // 1\. 提取 BYOK 凭证  
  const apiKey \= req.headers.get('x-byok-key');  
  const baseURL \= req.headers.get('x-byok-url') |

| 'https://api.openai.com/v1';  
    
  if (\!apiKey) return new Response('Unauthorized: No API Key provided', { status: 401 });

  // 2\. 动态创建 Provider 实例  
  // 这一步实现了“兼容 OpenAI 接口”的核心需求  
  const openai \= createOpenAI({  
    apiKey: apiKey,  
    baseURL: baseURL,  
  });

  // 3\. 解析请求体，获取 Agent ID 和用户输入  
  const { prompt, agentId, context } \= await req.json();  
  const agentConfig \= AGENT\_REGISTRY\[agentId\];

  if (\!agentConfig) return new Response('Agent not found', { status: 404 });

  // 4\. 执行流式生成  
  const result \= await streamText({  
    model: openai('gpt-4o-mini'), // 模型也可以让用户配置，或在 AgentConfig 中指定  
    system: agentConfig.systemPrompt(context), // 注入预设的 Prompt  
    messages: \[{ role: 'user', content: prompt }\],  
    temperature: agentConfig.temperature,  
  });

  // 5\. 返回流数据  
  return result.toDataStreamResponse();  
}

### **5.2 安全性分析与缓解策略**

在 BYOK 模式下，API Key 必须存储在客户端（LocalStorage），这引入了 XSS（跨站脚本攻击）风险。如果攻击者能在页面注入脚本，他们就能读取 Storage 中的 Key。

* **风险缓解策略 1：Session Storage \+ 内存模式。** 仅将 Key 保存在 sessionStorage 或内存状态中（Zustand Store）。这意味着用户刷新页面或关闭标签页后需要重新输入，牺牲体验换取安全。  
* **风险缓解策略 2：加密存储。** 要求用户设置一个简单的“应用锁”密码，使用该密码对存储在 LocalStorage 中的 Key 进行 AES 加密。只有当用户输入密码解锁后，应用才在内存中解密 Key 用于请求。  
* **风险缓解策略 3：中转代理的安全性。** 后端代理绝不能记录（Log）用户的 Key。代码审查必须确保 Key 仅用于实例化 Client，且随请求结束而销毁。

## ---

**6\. 高级场景与扩展维护**

### **6.1 提示词的远程维护**

对于大型团队，硬编码的 AGENT\_REGISTRY 可能不够灵活。可以将其改造为从 CMS（如 Strapi, Contentful）或 Git 仓库的 JSON 文件中异步加载。

* **实现逻辑：** 应用启动时 fetching https://internal-config/agents.json，填充到前端的 State 或后端的缓存中。这样，非技术人员（如产品经理）也可以调整 Prompt 而无需重新部署代码。

### **6.2 多模态与结构化输出**

虽然当前需求聚焦于文本润色，但 Vercel AI SDK 的 streamObject 功能允许扩展到结构化数据生成。例如，将任务描述转化为 JSON 格式的任务清单：

TypeScript

import { streamObject } from 'ai';  
//...  
const result \= await streamObject({  
  model: openai('gpt-4o'),  
  schema: z.object({  
    title: z.string(),  
    subtasks: z.array(z.string())  
  }),  
  //...  
});

这种扩展性保证了框架在未来业务复杂度增加时依然适用 18。

### **6.3 性能优化：乐观更新与去抖动**

在用户频繁点击“润色”时，可以利用 Vercel SDK 的 stop() 方法取消前一次请求，避免 Token 浪费。同时，可以结合 React 的 useTransition 保持 UI 的响应性，尽管 AI 生成本身是异步的。

## ---

**7\. 结论与推荐**

针对“用户配置 Key、预设 Agent、文本润色”的需求，本报告得出的最终推荐方案如下：

1. **核心框架：** 采用 **Vercel AI SDK**。理由是其 useCompletion Hook 完美契合单轮文本处理场景，且对流式传输和状态管理提供了最佳的开发者体验（DX），远胜于手动处理 fetch 流。  
2. **架构模式：** 采用 **无状态代理（Stateless Proxy）** 作为默认通信方式，以兼容所有 OpenAI 协议的云端模型并保护 Prompt 知识产权；同时保留纯客户端调用逻辑作为 Localhost 模型的 fallback。  
3. **维护策略：** 建立 **Agent Registry** 模式。将提示词与组件代码物理分离，通过 ID 映射调用。这直接解决了“容易维护提示词”的核心痛点。  
4. **数据流设计：** 实施 **Late-Binding Auth**。不在 Hook 初始化时绑定 Key，而在用户点击按钮的动作（Action）中读取并注入 Key，确保配置更新即时生效且无闭包问题。

此方案不仅满足了当前的全部功能需求，还具备极高的可扩展性，能够平滑演进至支持更复杂的 Chatbot 或多模态交互场景，是企业级前端 AI 应用的最佳实践架构。

## ---

**附录：数据来源与引用索引**

本报告分析基于以下关键技术文档与社区实践：

* 1 Vercel AI SDK Core & UI Documentation.  
* 2 useCompletion Hook API Reference & Best Practices.  
* 4 Troubleshooting Dynamic Headers & Request Body in AI SDK.  
* 6 Vercel AI Gateway & OpenAI Compatibility Layer.  
* 9 LangChain Prompt Template & Design Patterns.  
* 11 CopilotKit & Assistant-UI Headless Architecture.  
* 7 Framework Comparison: LangChain vs Vercel AI SDK.

#### **引用的著作**

1. AI SDK \- Vercel, 访问时间为 一月 17, 2026， [https://vercel.com/docs/ai-sdk](https://vercel.com/docs/ai-sdk)  
2. useCompletion \- AI SDK UI, 访问时间为 一月 17, 2026， [https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-completion](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-completion)  
3. Completion \- AI SDK UI, 访问时间为 一月 17, 2026， [https://ai-sdk.dev/docs/ai-sdk-ui/completion](https://ai-sdk.dev/docs/ai-sdk-ui/completion)  
4. Troubleshooting: Custom headers, body, and credentials not working with useChat \- AI SDK, 访问时间为 一月 17, 2026， [https://ai-sdk.dev/docs/troubleshooting/use-chat-custom-request-options](https://ai-sdk.dev/docs/troubleshooting/use-chat-custom-request-options)  
5. Troubleshooting: Stale body values with useChat \- AI SDK, 访问时间为 一月 17, 2026， [https://ai-sdk.dev/docs/troubleshooting/use-chat-stale-body-data](https://ai-sdk.dev/docs/troubleshooting/use-chat-stale-body-data)  
6. OpenAI-Compatible API \- Vercel, 访问时间为 一月 17, 2026， [https://vercel.com/docs/ai-gateway/openai-compat](https://vercel.com/docs/ai-gateway/openai-compat)  
7. Top 9 AI Agent Frameworks as of January 2026 \- Shakudo, 访问时间为 一月 17, 2026， [https://www.shakudo.io/blog/top-9-ai-agent-frameworks](https://www.shakudo.io/blog/top-9-ai-agent-frameworks)  
8. Confused between AI SDK and LangChain \- Reddit, 访问时间为 一月 17, 2026， [https://www.reddit.com/r/LangChain/comments/1fie8ul/confused\_between\_ai\_sdk\_and\_langchain/](https://www.reddit.com/r/LangChain/comments/1fie8ul/confused_between_ai_sdk_and_langchain/)  
9. How To Use a LangChain Prompt Template: Guide \+ Examples (2025) \- Shopify, 访问时间为 一月 17, 2026， [https://www.shopify.com/blog/langchain-prompt-template](https://www.shopify.com/blog/langchain-prompt-template)  
10. A Beginner's Guide to Getting Started with Prompt Templates in LangChain JavaScript | by Damilola Oyedunmade | AI Engineering BootCamp | Medium, 访问时间为 一月 17, 2026， [https://medium.com/ai-engineering-bootcamp/a-beginners-guide-to-getting-started-with-prompt-templates-in-langchain-javascript-826653191418](https://medium.com/ai-engineering-bootcamp/a-beginners-guide-to-getting-started-with-prompt-templates-in-langchain-javascript-826653191418)  
11. assistant-ui: Open Source React.js Library for AI Chat | Y Combinator, 访问时间为 一月 17, 2026， [https://www.ycombinator.com/companies/assistant-ui](https://www.ycombinator.com/companies/assistant-ui)  
12. CopilotKit/CopilotKit: React UI \+ elegant infrastructure for AI Copilots, AI chatbots, and in-app AI agents. The Agentic Frontend \- GitHub, 访问时间为 一月 17, 2026， [https://github.com/CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit)  
13. Fully Headless UI \- CopilotKit docs, 访问时间为 一月 17, 2026， [https://docs.copilotkit.ai/langgraph/custom-look-and-feel/headless-ui](https://docs.copilotkit.ai/langgraph/custom-look-and-feel/headless-ui)  
14. CopilotKit: The Engine for Tomorrow's AI-Native Applications, 访问时间为 一月 17, 2026， [https://skywork.ai/skypage/en/CopilotKit-The-Engine-for-Tomorrow's-AI-Native-Applications/1976121037147533312](https://skywork.ai/skypage/en/CopilotKit-The-Engine-for-Tomorrow's-AI-Native-Applications/1976121037147533312)  
15. Authentication \- Vercel, 访问时间为 一月 17, 2026， [https://vercel.com/docs/ai-gateway/authentication](https://vercel.com/docs/ai-gateway/authentication)  
16. Official JavaScript / TypeScript library for the OpenAI API \- GitHub, 访问时间为 一月 17, 2026， [https://github.com/openai/openai-node](https://github.com/openai/openai-node)  
17. Interface ClientOptions \- LangChain.js, 访问时间为 一月 17, 2026， [https://v02.api.js.langchain.com/interfaces/\_langchain\_openai.ClientOptions.html](https://v02.api.js.langchain.com/interfaces/_langchain_openai.ClientOptions.html)  
18. AI SDK 3.4 \- Vercel, 访问时间为 一月 17, 2026， [https://vercel.com/blog/ai-sdk-3-4](https://vercel.com/blog/ai-sdk-3-4)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAYCAYAAAAYl8YPAAAAYElEQVR4XmNgGAWjYBSQBjiAeAG6ICXAA4iN0QUpAZ/QBSgB8kC8D12QEnALiPXQBS8C8X8K8GoGCgEzEP8GYkZ0CXLASwYqGaQDxBHoguSCHCCWRhckB4C8ZoUuOIIAAJjwF5dW12V9AAAAAElFTkSuQmCC>