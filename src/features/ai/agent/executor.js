/**
 * Skill 执行器（AI SDK 6）
 * - executeSkill: 加载 Skill + 允许工具，并通过 maxSteps 自动完成工具循环
 * - executeGeneralChat: 无 Skill 匹配时的通用对话 fallback
 */

import { streamText } from 'ai';
import { loadSkill } from '../skills/registry.js';
import { getToolsForSkill } from '../tools/registry.js';

export async function executeSkill(skillId, messages, openai, model, callbacks = {}) {
    const resolvedModel = model || 'gpt-3.5-turbo';

    // 1. 加载完整 Skill 内容（按需加载）
    const skill = await loadSkill(skillId);
    if (!skill) {
        console.warn(`[Executor] Skill not found: ${skillId}`);
        return executeGeneralChat(messages, openai, model, callbacks);
    }

    // 2. 获取 Skill 允许的工具子集
    const tools = getToolsForSkill(skill.allowedTools);
    const hasTools = tools && Object.keys(tools).length > 0;

    // 3. 拼接 system prompt（基础 + Skill 内容）
    const systemPrompt = `你是一个专业的 Gantt 项目管理助手。

${skill.content}

## 重要规则
- 只使用上述工具获取数据，绝不编造数据
- 如果工具返回空结果，如实告知用户“当前没有符合条件的任务”
- 如果工具返回 error 字段，向用户解释问题并建议解决方案
- 输出使用中文，格式清晰易读`;

    // 4. 通知 UI：Skill 开始
    callbacks?.onSkillStart?.({ skillId, skillName: skill.name });

    // 5. 执行带工具的流式调用
    const result = streamText({
        model: openai(resolvedModel),
        system: systemPrompt,
        messages,
        tools: hasTools ? tools : undefined,
        maxSteps: hasTools ? 5 : 1,
        toolChoice: hasTools ? 'auto' : undefined,
        onStepFinish: ({ stepType, toolCalls, toolResults }) => {
            if (stepType === 'tool-call' && toolCalls?.length) {
                callbacks?.onToolCall?.(toolCalls.map(tc => ({
                    id: tc.toolCallId,
                    name: tc.toolName,
                    args: tc.args
                })));
            }
            if (stepType === 'tool-result' && toolResults?.length) {
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

export async function executeGeneralChat(messages, openai, model, callbacks = {}) {
    const resolvedModel = model || 'gpt-3.5-turbo';

    return streamText({
        model: openai(resolvedModel),
        system: `你是一个友好的项目管理助手，帮助用户解答关于 Gantt 项目的问题。
如果用户询问具体任务数据，建议他们使用更具体的问题，如“今天有什么任务”或“哪些任务逾期了”。`,
        messages,
        maxSteps: 1
    });
}
