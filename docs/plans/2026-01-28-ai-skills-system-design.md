# AI Skills 系统设计文档

> **版本**: v1.1
> **日期**: 2026-01-28
> **状态**: 设计中
> **技术栈**: AI SDK 6 + Zod + Vite
> **参考**: [Claude Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), [AI SDK 6](https://vercel.com/blog/ai-sdk-6)

## 1. 概述

### 1.1 目标

在现有 AI 模块基础上，引入 Skills 系统，实现：

1. **按需加载**：解决系统提示词膨胀问题，只加载当前任务需要的上下文
2. **工具调用**：让 AI 能自动查询 Gantt 数据回答用户问题
3. **工作流引导**：通过 Skill 文档指导 AI 高效完成复杂任务

### 1.2 核心概念

| 概念 | 定义 | 存储形式 |
|------|------|----------|
| **Skill** | 教 AI "怎么做"的工作流文档 | Markdown 文件 |
| **Tool** | 提供 AI "能做什么"的能力 | JS 函数 + JSON Schema |
| **Router** | 根据用户意图选择合适的 Skill | System Prompt |

### 1.3 设计原则

- **渐进式披露**：会话开始只加载 Skill 描述，按需加载完整内容
- **文档驱动**：Skill 是 Markdown 文档，修改行为只需改文档
- **Skills + Tools 互补**：Skills 编码工作流，Tools 提供数据访问

## 2. 架构设计

### 2.1 目录结构

```
src/features/ai/
├── skills/                      # Skill 文档
│   ├── registry.js              # Skill 注册表
│   ├── task-query/
│   │   └── SKILL.md
│   ├── progress-analysis/
│   │   └── SKILL.md
│   └── schedule-check/
│       └── SKILL.md
│
├── tools/                       # Tool 定义
│   ├── registry.js              # Tool 注册表
│   ├── taskTools.js             # 任务查询工具
│   └── analysisTools.js         # 分析工具
│
├── agent/                       # Agent 运行时
│   ├── router.js                # Skill 路由器
│   └── executor.js              # Skill 执行器
│
├── api/
│   └── client.js                # 修改：支持 tools + 多步调用
│
└── prompts/
    └── routerPrompt.js          # 路由阶段 prompt
```

### 2.2 两阶段调用流程

```
┌─────────────────────────────────────────────────────────────┐
│ 阶段 1: 路由 (Routing)                                       │
├─────────────────────────────────────────────────────────────┤
│ 输入: 用户消息 + 所有 Skill 描述（仅 name + description）     │
│                                                             │
│ AI 判断: 这个问题属于哪个 Skill？                            │
│                                                             │
│ 输出: { skill: "task-query", confidence: 0.95 }             │
│       或 { skill: null } 表示通用对话                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ 阶段 2: 执行 (Execution)                                     │
├─────────────────────────────────────────────────────────────┤
│ 加载:                                                       │
│   - 完整 SKILL.md 内容 → 注入 System Prompt                 │
│   - allowed-tools 声明的工具 → 注入 tools 参数               │
│                                                             │
│ 执行: streamText({ system, messages, tools, maxSteps })     │
│                                                             │
│ 循环: AI 调用工具 → 本地执行 → 结果返回 → 继续或完成          │
└─────────────────────────────────────────────────────────────┘
```

## 3. Skill 分类

### 3.1 两种触发模式

| 类型 | 触发方式 | 是否需要路由 | 示例 |
|------|----------|--------------|------|
| **聊天路由型** | 用户在聊天框提问，AI 自动识别 | 是 | task-query, progress-analysis |
| **直接触发型** | 用户点击 UI 按钮直接触发 | 否 | task-refiner, wbs-breakdown |

### 3.2 现有 Agent 改造

现有的 `task_refiner` 和 `wbs_breakdown` 属于**直接触发型**，改造策略：

```
改造前（agentRegistry.js）：
┌─────────────────────────────┐
│ agent = {                   │
│   system: "...",            │
│   userPrompt: (ctx) => ...  │
│ }                           │
└─────────────────────────────┘

改造后（skills/）：
┌─────────────────────────────┐
│ skills/task-refiner/        │
│   └── SKILL.md              │  ← 工作流文档
│                             │
│ + tools/ (可选)             │  ← 如需工具调用
└─────────────────────────────┘
```

**保持兼容**：
- UI 按钮触发方式不变（"任务润色"、"任务分解"）
- 输出格式不变（JSON 结构化输出）
- 新增：Skill 文档提供更清晰的工作流指导

### 3.3 Skill 调用入口

```js
// 聊天路由型：通过 runSmartChat
AiDrawer → runSmartChat() → 路由 → 执行 Skill

// 直接触发型：通过 invokeSkill
Button → invokeSkill('task-refiner', context) → 直接执行（跳过路由）
```

## 4. Skill 文档规范

### 4.1 SKILL.md 结构

参考 [Agent Skills 规范](https://agentskills.io)：

```markdown
---
name: skill-id
description: 简短描述，用于路由阶段判断（必填）
allowed-tools:
  - tool_name_1
  - tool_name_2
---

# Skill 标题

简要说明这个 Skill 的用途。

## 可用工具

| 工具 | 用途 |
|------|------|
| tool_name_1 | 说明 |
| tool_name_2 | 说明 |

## 工作流

### 场景 1: 用户问 "xxx"

1. 调用 `tool_name_1`
2. 处理结果
3. 展示给用户

### 场景 2: 用户问 "yyy"

...

## 输出格式

说明如何格式化输出结果。

## 注意事项

- 边界情况处理
- 错误处理建议
```

### 4.2 Frontmatter 字段

参考 [Claude Code Skills 规范](https://code.claude.com/docs/en/skills)：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | Skill 唯一标识，kebab-case |
| `description` | 是 | 简短描述，用于路由判断（建议 < 100 字） |
| `allowed-tools` | 否 | 该 Skill 可用的工具列表 |
| `disable-model-invocation` | 否 | 设为 `true` 禁止 AI 自动触发，仅限用户手动调用 |
| `output-format` | 否 | 输出格式：`markdown`（默认）或 `json` |

**直接触发型 Skill 示例**（任务润色）：

```yaml
---
name: task-refiner
description: 优化任务描述，使其更清晰、专业
disable-model-invocation: true
output-format: json
---
```

### 4.3 完整 Skill 示例

**`skills/task-query/SKILL.md`**：

```markdown
---
name: task-query
description: 查询任务数据，包括今日任务、逾期任务、按状态/优先级筛选
allowed-tools:
  - get_today_tasks
  - get_tasks_by_status
  - get_overdue_tasks
  - get_tasks_by_priority
---

# 任务查询

帮助用户查询 Gantt 项目中的任务数据。

## 可用工具

| 工具 | 用途 | 参数 |
|------|------|------|
| get_today_tasks | 获取今日待处理任务 | include_subtasks?: boolean |
| get_tasks_by_status | 按状态筛选 | status: pending/in_progress/completed/suspended |
| get_overdue_tasks | 获取逾期任务 | 无 |
| get_tasks_by_priority | 按优先级筛选 | priority: high/medium/low |

## 工作流

### 场景：用户问"今天有什么任务"

1. 调用 `get_today_tasks`
2. 按优先级排序（high → medium → low）
3. 以表格展示：任务名、优先级、进度、截止日期

### 场景：用户问"哪些任务逾期了"

1. 调用 `get_overdue_tasks`
2. 按逾期天数降序排列
3. 高亮显示逾期超过 3 天的任务

### 场景：用户问"进行中的任务"

1. 调用 `get_tasks_by_status({ status: 'in_progress' })`
2. 展示任务列表及当前进度

## 输出格式

使用 Markdown 表格展示结果：

| 任务 | 优先级 | 进度 | 截止日期 |
|------|--------|------|----------|
| 📋 任务名 | 🔴 高 | 30% | 2026-01-30 |

空结果时回复："当前没有符合条件的任务。"

## 注意事项

- 不要编造数据，只展示工具返回的结果
- 日期格式统一使用 YYYY-MM-DD
- 进度显示为百分比
```

### 4.4 初期 Skill 规划

| Skill ID | 名称 | 触发模式 | 工具 |
|----------|------|----------|------|
| `task-query` | 任务查询 | 聊天路由 | get_today_tasks, get_tasks_by_status, get_overdue_tasks |
| `progress-analysis` | 进度分析 | 聊天路由 | get_all_tasks, get_progress_summary |
| `task-refiner` | 任务润色 | 直接触发 | 无（纯文本处理） |
| `wbs-breakdown` | 任务分解 | 直接触发 | 无（纯文本处理） |

## 5. Tool 定义规范

### 5.1 Tool 结构（AI SDK 6）

使用 AI SDK 6 的 `tool()` 函数简化定义，同时保持完整功能：

```js
// tools/taskTools.js
import { tool } from 'ai';
import { z } from 'zod';

/**
 * 任务查询工具集
 * 使用 AI SDK 6 的 tool() 函数定义，支持：
 * - 类型安全的参数校验（Zod）
 * - 自动生成 JSON Schema
 * - 错误边界处理
 */
export const taskTools = {
  get_today_tasks: tool({
    description: '获取今日需处理的任务（开始日期 ≤ 今天 且 未完成）',
    parameters: z.object({
      include_subtasks: z.boolean().optional().describe('是否包含子任务，默认 false')
    }),
    execute: async ({ include_subtasks = false }) => {
      // 错误边界：检查 gantt 是否可用
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasks = [];
      gantt.eachTask(task => {
        const startDate = new Date(task.start_date);
        if (startDate <= today && (task.progress || 0) < 1) {
          if (include_subtasks || !gantt.getParent(task.id)) {
            tasks.push({
              id: task.id,
              text: task.text,
              priority: task.priority || 'medium',
              progress: Math.round((task.progress || 0) * 100),
              start_date: task.start_date?.toISOString?.()?.split('T')[0] || task.start_date,
              end_date: task.end_date?.toISOString?.()?.split('T')[0] || task.end_date
            });
          }
        }
      });

      // 按优先级排序
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      tasks.sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1));

      return { tasks, count: tasks.length };
    }
  }),

  get_tasks_by_status: tool({
    description: '按状态筛选任务',
    parameters: z.object({
      status: z.enum(['pending', 'in_progress', 'completed', 'suspended'])
        .describe('任务状态：pending(待开始), in_progress(进行中), completed(已完成), suspended(已暂停)')
    }),
    execute: async ({ status }) => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const tasks = [];
      gantt.eachTask(task => {
        if (task.status === status) {
          tasks.push({
            id: task.id,
            text: task.text,
            priority: task.priority || 'medium',
            progress: Math.round((task.progress || 0) * 100),
            assignee: task.assignee || null
          });
        }
      });
      return { tasks, count: tasks.length };
    }
  }),

  get_overdue_tasks: tool({
    description: '获取已逾期任务（结束日期 < 今天 且 未完成）',
    parameters: z.object({}),
    execute: async () => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tasks = [];
      gantt.eachTask(task => {
        const endDate = new Date(task.end_date);
        if (endDate < today && (task.progress || 0) < 1) {
          const overdueDays = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));
          tasks.push({
            id: task.id,
            text: task.text,
            end_date: task.end_date?.toISOString?.()?.split('T')[0] || task.end_date,
            overdue_days: overdueDays,
            progress: Math.round((task.progress || 0) * 100),
            priority: task.priority || 'medium'
          });
        }
      });

      // 按逾期天数降序排序
      tasks.sort((a, b) => b.overdue_days - a.overdue_days);
      return { tasks, count: tasks.length };
    }
  }),

  get_tasks_by_priority: tool({
    description: '按优先级筛选任务',
    parameters: z.object({
      priority: z.enum(['high', 'medium', 'low']).describe('优先级：high(高), medium(中), low(低)')
    }),
    execute: async ({ priority }) => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化', tasks: [], count: 0 };
      }

      const tasks = [];
      gantt.eachTask(task => {
        if ((task.priority || 'medium') === priority) {
          tasks.push({
            id: task.id,
            text: task.text,
            status: task.status || 'pending',
            progress: Math.round((task.progress || 0) * 100),
            end_date: task.end_date?.toISOString?.()?.split('T')[0] || task.end_date
          });
        }
      });
      return { tasks, count: tasks.length };
    }
  }),

  get_progress_summary: tool({
    description: '获取项目整体进度概览',
    parameters: z.object({}),
    execute: async () => {
      if (typeof gantt === 'undefined') {
        return { error: 'Gantt 未初始化' };
      }

      let total = 0, completed = 0, inProgress = 0, pending = 0, overdue = 0;
      let totalProgress = 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      gantt.eachTask(task => {
        // 只统计顶层任务
        if (gantt.getParent(task.id)) return;

        total++;
        totalProgress += (task.progress || 0);

        if (task.status === 'completed' || (task.progress || 0) >= 1) {
          completed++;
        } else if (task.status === 'in_progress') {
          inProgress++;
        } else {
          pending++;
        }

        // 检查逾期
        const endDate = new Date(task.end_date);
        if (endDate < today && (task.progress || 0) < 1) {
          overdue++;
        }
      });

      return {
        total_tasks: total,
        completed,
        in_progress: inProgress,
        pending,
        overdue,
        average_progress: total > 0 ? Math.round((totalProgress / total) * 100) : 0
      };
    }
  })
};
```

### 5.2 Tool 注册表

```js
// tools/registry.js
import { taskTools } from './taskTools.js';
import { analysisTools } from './analysisTools.js';

const allTools = {
  ...taskTools,
  ...analysisTools
};

/**
 * 根据 Skill 的 allowed-tools 获取工具子集
 */
export function getToolsForSkill(allowedTools) {
  if (!allowedTools || allowedTools.length === 0) {
    return {};
  }

  const tools = {};
  for (const name of allowedTools) {
    if (allTools[name]) {
      tools[name] = allTools[name];
    }
  }
  return tools;
}

export { allTools };
```

## 6. Agent 运行时

### 6.1 路由优化策略

参考最佳实践，避免每次都调用 AI 做路由：

**策略 1：关键词快速匹配（推荐）**

```js
// agent/router.js
const KEYWORD_PATTERNS = {
  'task-query': [/今[天日].*任务/, /逾期/, /哪些任务/, /任务.*状态/],
  'progress-analysis': [/进度/, /完成率/, /项目.*情况/],
};

export function quickRoute(message) {
  for (const [skillId, patterns] of Object.entries(KEYWORD_PATTERNS)) {
    if (patterns.some(p => p.test(message))) {
      return { skill: skillId, method: 'keyword' };
    }
  }
  return null; // 无法快速匹配，fallback 到 AI 路由
}
```

**策略 2：路由缓存**

```js
// 相似问题复用路由结果
const routeCache = new Map();

export async function routeWithCache(message, openai, model) {
  // 1. 尝试关键词匹配
  const quick = quickRoute(message);
  if (quick) return { ...quick, confidence: 0.9 };

  // 2. 检查缓存（简单相似度）
  // ...

  // 3. AI 路由
  const result = await routeToSkill(message, openai, model);
  routeCache.set(message, result);
  return result;
}
```

**策略 3：使用小模型路由**

路由任务简单，可使用 `gpt-3.5-turbo` / `claude-3-haiku` 降低成本和延迟。

### 6.2 Skill 路由器

```js
// agent/router.js
import { generateObject } from 'ai';
import { z } from 'zod';
import { getSkillDescriptions } from '../skills/registry.js';

const routerSchema = z.object({
  skill: z.string().nullable().describe('匹配的 Skill ID，无匹配返回 null'),
  confidence: z.number().min(0).max(1).describe('置信度'),
  reasoning: z.string().describe('判断理由')
});

export async function routeToSkill(userMessage, openai, model) {
  const skills = getSkillDescriptions();

  const systemPrompt = `你是一个意图路由器。根据用户消息判断应该使用哪个 Skill。

可用 Skills:
${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}

规则:
1. 如果用户问题明确匹配某个 Skill，返回该 Skill ID
2. 如果是通用对话（闲聊、问候等），返回 null
3. 如果不确定，返回置信度较低的最佳匹配`;

  const result = await generateObject({
    model: openai(model),
    schema: routerSchema,
    system: systemPrompt,
    prompt: userMessage
  });

  return result.object;
}
```

### 6.3 Skill 执行器（AI SDK 6）

使用 AI SDK 6 的 `streamText` + `maxSteps` 实现完整的 Agent 循环：

```js
// agent/executor.js
import { streamText } from 'ai';
import { loadSkill } from '../skills/registry.js';
import { getToolsForSkill } from '../tools/registry.js';

/**
 * 执行 Skill
 *
 * AI SDK 6 核心特性：
 * - maxSteps: 自动处理多轮工具调用循环
 * - onStepFinish: 每轮结束回调，用于 UI 状态更新
 * - toolChoice: 控制工具调用策略
 */
export async function executeSkill(skillId, messages, openai, model, callbacks) {
  // 1. 加载完整 Skill 内容（按需加载）
  const skill = await loadSkill(skillId);
  if (!skill) {
    console.warn(`[Executor] Skill not found: ${skillId}`);
    // Fallback 到通用对话
    return executeGeneralChat(messages, openai, model, callbacks);
  }

  // 2. 获取该 Skill 允许的工具
  const tools = getToolsForSkill(skill.allowedTools);
  const hasTools = Object.keys(tools).length > 0;

  // 3. 构建 System Prompt（基础 prompt + Skill 内容）
  const systemPrompt = `你是一个专业的 Gantt 项目管理助手。

${skill.content}

## 重要规则
- 只使用上述工具获取数据，绝不编造数据
- 如果工具返回空结果，如实告知用户"当前没有符合条件的任务"
- 如果工具返回 error 字段，向用户解释问题并建议解决方案
- 输出使用中文，格式清晰易读`;

  // 4. 通知 UI：开始执行 Skill
  callbacks?.onSkillStart?.({ skillId, skillName: skill.name });

  // 5. 执行带工具的流式调用
  const result = streamText({
    model: openai(model),
    system: systemPrompt,
    messages,
    tools: hasTools ? tools : undefined,
    maxSteps: hasTools ? 5 : 1,  // 有工具时允许多轮，否则单轮
    toolChoice: hasTools ? 'auto' : undefined,

    // AI SDK 6: 每轮结束回调
    onStepFinish: ({ stepType, toolCalls, toolResults, text }) => {
      if (stepType === 'tool-call' && toolCalls?.length > 0) {
        // 通知 UI：正在调用工具
        callbacks?.onToolCall?.(toolCalls.map(tc => ({
          id: tc.toolCallId,
          name: tc.toolName,
          args: tc.args
        })));
      }

      if (stepType === 'tool-result' && toolResults?.length > 0) {
        // 通知 UI：工具执行完成
        callbacks?.onToolResult?.(toolResults.map(tr => ({
          id: tr.toolCallId,
          name: tr.toolName,
          result: tr.result
        })));
      }
    }
  });

  return result;
}

/**
 * 通用对话 Fallback（无 Skill 匹配时）
 */
async function executeGeneralChat(messages, openai, model, callbacks) {
  return streamText({
    model: openai(model),
    system: `你是一个友好的项目管理助手，帮助用户解答关于 Gantt 项目的问题。
如果用户询问具体任务数据，建议他们使用更具体的问题，如"今天有什么任务"或"哪些任务逾期了"。`,
    messages,
    maxSteps: 1
  });
}
```

## 7. 错误处理

### 7.1 错误类型与处理策略

| 错误类型 | 场景 | 处理策略 |
|----------|------|----------|
| 路由失败 | AI 无法判断意图 | Fallback 到通用对话模式 |
| Skill 未找到 | skillId 不存在 | 记录日志 + Fallback |
| 工具执行失败 | gantt 数据异常 | 返回友好错误信息给 AI 继续处理 |
| 工具超时 | 查询数据量过大 | 设置超时 + 提示用户缩小范围 |
| API 错误 | 401/429/500 | 复用现有 errorHandler |

### 7.2 工具执行错误处理

```js
// tools/taskTools.js - execute 函数内
execute: async (params) => {
  try {
    if (typeof gantt === 'undefined') {
      return { error: 'Gantt 未初始化', tasks: [], count: 0 };
    }
    const tasks = [];
    gantt.eachTask(task => { /* ... */ });
    return { tasks, count: tasks.length };
  } catch (err) {
    console.error('[Tool] execute error:', err);
    return { error: err.message, tasks: [], count: 0 };
  }
}
```

## 8. client.js 改造

### 8.1 新增入口函数

```js
// api/client.js - 新增

import { streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getAiConfigState, setAiStatus } from '../../../core/store.js';
import { quickRoute, routeToSkill } from '../agent/router.js';
import { executeSkill, executeGeneralChat } from '../agent/executor.js';
import { handleAiError } from '../services/errorHandler.js';

/**
 * 智能对话入口（支持 Skill 路由 + 工具调用）
 *
 * 与现有 runAgentStream 的区别：
 * - runAgentStream: 单轮、无工具、用于直接触发型 Skill（任务润色/分解）
 * - runSmartChat: 多轮、带工具、带路由，用于聊天路由型 Skill
 *
 * 路由优先级：关键词快速匹配 → AI 路由 → 通用对话
 */
export async function runSmartChat(userMessage, history, callbacks = {}) {
  const { onChunk, onFinish, onError, onToolCall, onToolResult, onSkillStart } = callbacks;
  const { apiKey, baseUrl, model } = getAiConfigState();

  if (!apiKey) {
    onError?.(new Error('AI_NOT_CONFIGURED'));
    return;
  }

  setAiStatus('loading');

  try {
    const openai = createOpenAI({
      apiKey,
      baseURL: baseUrl,
      compatibility: 'strict'
    });

    // 构建消息历史
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage }
    ];

    // 阶段 1: 路由（分层策略）
    let skillId = null;

    // 1a. 关键词快速匹配（无 API 开销）
    const quickResult = quickRoute(userMessage);
    if (quickResult) {
      skillId = quickResult.skill;
    }

    // 1b. 关键词未匹配 → AI 路由
    if (!skillId) {
      try {
        const route = await routeToSkill(userMessage, openai, model);
        if (route.skill && route.confidence > 0.7) {
          skillId = route.skill;
        }
      } catch (routeError) {
        // 路由失败不阻断流程，降级到通用对话
        console.warn('[SmartChat] Route failed, fallback to general:', routeError);
      }
    }

    // 阶段 2: 执行
    let result;
    if (skillId) {
      result = await executeSkill(skillId, messages, openai, model, {
        onToolCall, onToolResult, onSkillStart
      });
    } else {
      result = await executeGeneralChat(messages, openai, model);
    }

    // 流式输出
    for await (const textPart of result.textStream) {
      onChunk?.(textPart);
    }

    const usage = await result.usage;
    setAiStatus('idle');
    onFinish?.(usage);

  } catch (error) {
    console.error('[AI Client] Smart chat error:', error);
    setAiStatus('error');
    onError?.(error);
  }
}
```

### 8.2 兼容策略

```
现有调用方式（保留不变）：
┌──────────────────────────────────────────────────────┐
│ "任务润色" 按钮 → invokeAgent('task_refiner', ctx)    │
│ "任务分解" 按钮 → invokeAgent('wbs_breakdown', ctx)   │
│        ↓                                              │
│ runAgentStream(agent, ctx, onChunk, onFinish, onErr)  │
│ (单轮、无工具、结构化 JSON 输出)                       │
└──────────────────────────────────────────────────────┘

新增调用方式：
┌──────────────────────────────────────────────────────┐
│ 聊天框输入 → "今天有什么任务？"                       │
│        ↓                                              │
│ runSmartChat(msg, history, callbacks)                  │
│ (多轮、带工具、Markdown 流式输出)                      │
└──────────────────────────────────────────────────────┘
```

**迁移路径**：
1. 保留 `runAgentStream` 和 `agentRegistry.js`
2. 新增 `runSmartChat`，仅在 `chat` agent 中使用
3. 后续逐步将 `task_refiner` / `wbs_breakdown` 迁移为 Skill 文档

## 9. UI 适配

### 9.1 工具调用状态展示

参考 ChatGPT / Claude 的工具调用 UI，在 AiDrawer 中展示工具执行过程：

```js
// AiDrawer 新增方法

/**
 * 展示工具调用状态（可折叠）
 * 参考 Claude 的 "Using tool: ..." 展示风格
 */
showToolCall(toolCall) {
  const statusEl = document.createElement('div');
  statusEl.className = 'ai-tool-call';
  statusEl.innerHTML = `
    <details>
      <summary>
        <span class="tool-icon">🔧</span>
        <span class="tool-name">调用 ${this._getToolDisplayName(toolCall.name)}</span>
        <span class="tool-spinner"></span>
      </summary>
      <pre class="tool-args">${JSON.stringify(toolCall.args, null, 2)}</pre>
    </details>
  `;
  this.messageContainer.appendChild(statusEl);
  return statusEl;
}

/**
 * 更新工具执行结果
 */
showToolResult(toolResult, statusEl) {
  const spinner = statusEl.querySelector('.tool-spinner');
  if (spinner) spinner.remove();

  const summary = statusEl.querySelector('summary');
  summary.innerHTML += ` <span class="tool-done">✓</span>`;

  const resultEl = document.createElement('pre');
  resultEl.className = 'tool-result';
  resultEl.textContent = JSON.stringify(toolResult.result, null, 2);
  statusEl.querySelector('details').appendChild(resultEl);
}

/**
 * 工具名称映射
 */
_getToolDisplayName(name) {
  const nameMap = {
    get_today_tasks: '查询今日任务',
    get_overdue_tasks: '查询逾期任务',
    get_tasks_by_status: '按状态筛选',
    get_tasks_by_priority: '按优先级筛选',
    get_progress_summary: '获取进度概览'
  };
  return nameMap[name] || name;
}
```

### 9.2 样式

```css
/* ai-theme.css 新增 */

.ai-tool-call {
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--b2, #f2f2f2);
  border-radius: 8px;
  font-size: 13px;
}

.ai-tool-call summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ai-tool-call .tool-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--bc, #ccc);
  border-top-color: var(--p, #570df8);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.ai-tool-call .tool-done {
  color: var(--su, #36d399);
}

.ai-tool-call pre {
  margin: 8px 0 0;
  padding: 8px;
  background: var(--b3, #e5e5e5);
  border-radius: 4px;
  font-size: 12px;
  max-height: 150px;
  overflow-y: auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### 9.3 不变的部分

- 输入框、发送按钮等交互保持不变
- 用户/AI 气泡展示保持不变
- Markdown 渲染和代码高亮保持不变
- 错误处理复用现有 errorHandler

## 10. 实现路线图

### Phase 0: 准备（前置）

- [ ] 升级 AI SDK：`npm i ai@latest @ai-sdk/openai@latest zod`
- [ ] 验证 `tool()` 和 `maxSteps` 在浏览器端可用
- [ ] 确认现有功能不受升级影响

### Phase 1: MVP（聊天框可调用工具）

- [ ] 创建 `src/features/ai/tools/taskTools.js`，实现 5 个基础工具
- [ ] 创建 `src/features/ai/tools/registry.js`
- [ ] 创建 `src/features/ai/skills/task-query/SKILL.md`
- [ ] 创建 `src/features/ai/skills/registry.js`
- [ ] 创建 `src/features/ai/agent/executor.js`
- [ ] 在 `client.js` 新增 `runSmartChat`
- [ ] 在 `aiService.js` 中 chat agent 切换到 `runSmartChat`
- [ ] 端到端验证：聊天框输入"今天有什么任务" → 工具调用 → 返回结果

### Phase 2: 路由 + UI

- [ ] 创建 `src/features/ai/agent/router.js`（关键词 + AI 路由）
- [ ] 新增 `progress-analysis` Skill + 对应工具
- [ ] AiDrawer 工具调用状态展示（可折叠）
- [ ] 工具调用 CSS 样式

### Phase 3: 迁移 + 扩展

- [ ] 将 `task_refiner` 从 agentRegistry 迁移为 Skill 文档
- [ ] 将 `wbs_breakdown` 从 agentRegistry 迁移为 Skill 文档
- [ ] 写操作工具（配合 undoManager + 用户确认机制）
- [ ] 更多分析类 Skills（schedule-check 等）

## 11. 依赖与版本

| 包 | 当前版本 | 目标版本 | 用途 |
|-----|---------|---------|------|
| `ai` | ^6.0.39 | latest | AI SDK Core（streamText、tool、generateObject） |
| `@ai-sdk/openai` | ^3.0.12 | latest | OpenAI 兼容 Provider |
| `zod` | 新增 | latest | Tool 参数 Schema 定义 |

## 12. 参考资源

- [Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- [Agent Skills 开放标准](https://agentskills.io)
- [AI SDK 6 发布](https://vercel.com/blog/ai-sdk-6)
- [AI SDK: Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Claude Skills vs MCP](https://glama.ai/blog/2026-01-10-what-are-claude-skills)
