/**
 * 智能体注册表
 * 纯配置化的 Prompt 管理，与 UI 代码解耦
 */

import { i18n } from '../../../utils/i18n.js';

/**
 * 预设智能体配置
 */
export const AGENTS = {
    // 通用助手
    CHAT: {
        id: 'chat',
        nameKey: 'ai.agents.chat',
        icon: 'chat',
        system: `你是一个专业的项目管理助手，协助用户管理甘特图任务。
你的职责是：
1. 回答关于项目管理的问题
2. 协助分析任务和进度
3. 提供改进建议

请简明扼要地回答。`,
        userPrompt: (ctx) => `${ctx.text}${ctx.additionalInfo ? `\n\n附加指令：${ctx.additionalInfo}` : ''}`,
        contextType: 'text'
    },

    // 任务润色助手
    TASK_REFINE: {
        id: 'task_refine',
        nameKey: 'ai.agents.taskRefine',
        icon: 'sparkles',
        system: `你是一个资深项目经理，擅长将模糊的任务描述转化为清晰、可执行的任务说明。
请将输入内容转化为标准的 JSON 格式返回，不要包含 markdown 代码块标记。
JSON 格式要求：
{
  "type": "task_refine",
  "original": "原始输入",
  "optimized": "优化后的描述",
  "reasoning": "简短的优化理由"
}`,
        userPrompt: (ctx) => `请优化以下任务描述：
${ctx.text}
${ctx.additionalInfo ? `\n附加要求：${ctx.additionalInfo}` : ''}`,
        contextType: 'text'
    },

    // Bug 报告专家
    BUG_REPORT: {
        id: 'bug_report',
        nameKey: 'ai.agents.bugReport',
        icon: 'bug',
        system: `你是一个经验丰富的 QA 工程师。请将用户描述转化为标准的 Bug 报告。
请直接返回 JSON 格式数据，不要使用 markdown 代码块。
JSON 格式要求：
{
  "type": "task_refine", 
  "original": "用户描述",
  "optimized": "【问题描述】...\\n【复现步骤】...\\n【预期结果】...\\n【实际结果】...",
  "reasoning": "评估的严重程度及理由"
}
注意：optimized 字段内请使用纯文本格式，用换行符分隔各部分。`,
        userPrompt: (ctx) => `请转化以下问题描述：
${ctx.text}
${ctx.additionalInfo ? `\n附加要求：${ctx.additionalInfo}` : ''}`,
        contextType: 'text'
    },

    // 任务分解助手
    TASK_BREAKDOWN: {
        id: 'task_breakdown',
        nameKey: 'ai.agents.taskBreakdown',
        icon: 'list',
        system: `你是一个敏捷教练，专注于任务分解和项目规划。
你将收到一个任务的完整信息（JSON格式），包括任务属性和现有子任务。

请根据任务信息，生成或优化子任务列表。
- 如果已有子任务，请输出一份完整的新子任务方案（用于替换原有子任务）
- 如果没有子任务，请从零开始分解
- 子任务应该具体、可执行、可验证
- 子任务的时间安排应该在父任务的时间范围内
- 子任务名称必须简洁明确，建议不超过 15 个中文字符

请直接返回 JSON 格式数据，不要使用 markdown 代码块。
JSON 格式要求：
{
  "type": "task_split",
  "original": "原始任务名称",
  "subtasks": [
    {
      "text": "子任务名称（必填）",
      "description": "子任务描述（必填，1-2句，说明验收标准或执行要点）",
      "duration": 2,
      "start_date_offset": 0,
      "priority": "medium",
      "status": "pending",
      "progress": 0
    }
  ],
  "reasoning": "分解理由和说明"
}

字段说明：
- text: 子任务名称（必填，简洁，建议 <= 15 个中文字符）
- description: 子任务描述（必填，1-2句）
- duration: 工期天数（必填，默认1）
- start_date_offset: 相对于父任务开始日期的偏移天数（必填，第一个子任务通常为0）
- priority: 优先级 high/medium/low（默认medium）
- status: 状态 pending/in_progress/completed（默认pending）
- progress: 进度 0-100 的整数（默认0）

重要：
1. 请确保每个子任务都包含完整的时间信息
2. 子任务的时间安排应该合理，后续任务的 start_date_offset 应该考虑前序任务的工期
3. 所有子任务的总工期应该大致等于父任务的工期`,
        userPrompt: (ctx) => {
            // 如果传入了完整任务数据，使用 JSON 格式
            if (ctx.taskData) {
                return `请分解以下任务，并为每个子任务提供完整的时间安排：

任务信息(JSON):
${JSON.stringify(ctx.taskData, null, 2)}
${ctx.additionalInfo ? `\n附加要求：${ctx.additionalInfo}` : ''}

请返回包含完整字段的子任务列表。`;
            }
            // 兼容旧的纯文本模式
            return `请分解以下任务：
${ctx.text}
${ctx.additionalInfo ? `\n附加要求：${ctx.additionalInfo}` : ''}`;
        },
        contextType: 'task'
    },

    // 工时估算助手
    TIME_ESTIMATE: {
        id: 'time_estimate',
        nameKey: 'ai.agents.timeEstimate',
        icon: 'clock',
        system: `你是一个项目估算专家。
请直接返回 JSON 格式数据，不要使用 markdown 代码块。
JSON 格式要求：
{
  "type": "task_refine",
  "original": "原始任务",
  "optimized": "乐观估算：X天\\n正常估算：Y天\\n悲观估算：Z天",
  "reasoning": "估算依据"
}`,
        userPrompt: (ctx) => `请估算任务工时：
${ctx.text}
${ctx.additionalInfo ? `\n附加信息：${ctx.additionalInfo}` : ''}`,
        contextType: 'text'
    }
};

/**
 * 获取智能体配置
 * @param {string} agentId - 智能体 ID
 * @returns {Object|null}
 */
export function getAgent(agentId) {
    return Object.values(AGENTS).find(agent => agent.id === agentId) || null;
}

/**
 * 获取所有智能体列表（用于 UI 展示）
 * @returns {Array<{id: string, name: string, icon: string}>}
 */
export function getAgentList() {
    return Object.values(AGENTS).map(agent => ({
        id: agent.id,
        name: i18n.t(agent.nameKey) || agent.id,
        icon: agent.icon
    }));
}

/**
 * 获取智能体名称
 * @param {string} agentId
 * @returns {string}
 */
export function getAgentName(agentId) {
    const agent = getAgent(agentId);
    if (!agent) return agentId;
    return i18n.t(agent.nameKey) || agent.id;
}

export default AGENTS;
