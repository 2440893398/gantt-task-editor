/**
 * Skill 执行器（AI SDK 6）
 * - executeSkill: 加载 Skill + 允许工具，并通过 stopWhen 自动完成工具循环
 * - executeGeneralChat: 无 Skill 匹配时的通用对话 fallback
 */

import { streamText, stepCountIs } from 'ai';
import { loadSkill } from '../skills/registry.js';
import { getToolsForSkill } from '../tools/registry.js';
import { i18n } from '../../../utils/i18n.js';
import { IMPORT_SYSTEM_PROMPT, DIFF_JSON_SCHEMA } from '../prompts/importPrompt.js';

function hasAttachmentContext(messages = []) {
    return Array.isArray(messages) && messages.some((m) =>
        m?.role === 'user' && typeof m?.content === 'string' && m.content.includes('[Attachment Context]')
    );
}

function getLanguageInstruction() {
    const currentLanguage = i18n.getLanguage();
    const localeNameMap = {
        'zh-CN': 'Simplified Chinese',
        'en-US': 'English',
        'ja-JP': 'Japanese',
        'ko-KR': 'Korean'
    };
    return {
        language: currentLanguage,
        languageName: localeNameMap[currentLanguage] || 'English'
    };
}

/**
 * Check if tool calling should be disabled based on previous test results
 * This is a lightweight check that reads from localStorage
 * The actual testing happens in testConnection()
 * @param {string} baseUrl - The API base URL
 * @param {string} model - The model name
 * @returns {boolean}
 */
function isToolCallingSupportedByAPI(baseUrl, model) {
    // 从 localStorage 读取上次测试的结果
    try {
        const testResult = localStorage.getItem('gantt_ai_last_test_result');
        if (testResult) {
            const result = JSON.parse(testResult);
            
            // 检查测试结果是否针对当前的 model
            // 如果 model 不同，忽略旧的测试结果
            if (result.testedModel && result.testedModel !== model) {
                console.log('[Executor] Test result is for different model, ignoring:', {
                    tested: result.testedModel,
                    current: model
                });
                return true; // 默认启用，让用户重新测试
            }
            
            // 如果明确测试过不支持，则禁用工具调用
            if (result.toolCallSupported === false) {
                return false;
            }
        }
    } catch (e) {
        console.warn('[Executor] Failed to read test result:', e);
    }
    
    // 默认启用（让 API 自己报错，然后用户可以通过测试连接来确认）
    return true;
}

/**
 * 执行 Skill（带工具调用）
 * @param {string} skillId - Skill ID
 * @param {Array} messages - 消息数组
 * @param {LanguageModel} model - 已创建的模型实例
 * @param {Object} callbacks - 回调函数
 */
export async function executeSkill(skillId, messages, model, callbacks = {}) {
    // 1. 加载完整 Skill 内容（按需加载）
    const skill = await loadSkill(skillId);
    if (!skill) {
        console.warn(`[Executor] Skill not found: ${skillId}`);
        return executeGeneralChat(messages, model, callbacks);
    }

    // 2. Check API compatibility for tool calling
    const config = JSON.parse(localStorage.getItem('gantt_ai_config') || '{}');
    const currentModel = config.model || 'gpt-3.5-turbo';
    const apiSupportsTools = isToolCallingSupportedByAPI(config.baseUrl, currentModel);
    
    if (!apiSupportsTools) {
        console.warn('[Executor] Current API endpoint does not support tool calling, falling back to general chat');
    }

    // 3. 获取 Skill 允许的工具子集 (only if API supports it)
    const tools = apiSupportsTools ? getToolsForSkill(skill.allowedTools) : null;
    const hasTools = tools && Object.keys(tools).length > 0;
    
    // 4. Debug: Log tool schemas (DEEP INSPECTION)
    if (hasTools && import.meta.env.DEV) {
        console.log('[Executor] Tools for skill:', Object.keys(tools));
        Object.entries(tools).forEach(([name, tool]) => {
            console.log(`[Executor] Tool ${name}:`, {
                hasDescription: !!tool.description,
                hasParameters: !!tool.parameters,
                parametersType: tool.parameters?.constructor?.name,
                hasExecute: !!tool.execute
            });
            
            // DEEP: Check what Zod schema actually contains
            if (tool.parameters?._def) {
                const def = tool.parameters._def;
                console.log(`[Executor] Tool ${name} Zod schema:`, {
                    typeName: def.typeName,
                    shape: typeof def.shape === 'function' ? Object.keys(def.shape()) : 'no-shape'
                });
                
                // Try to see what JSON schema the AI SDK will generate
                try {
                    const schema = tool.parameters;
                    console.log(`[Executor] Tool ${name} Zod object:`, schema);
                } catch (e) {
                    console.error(`[Executor] Tool ${name} schema error:`, e);
                }
            }
        });
    }

    // 5. 拼接 system prompt（基础 + Skill 内容 + 当前时间）
    const now = new Date();
    const { language, languageName } = getLanguageInstruction();
    const currentDateTime = now.toLocaleString(language, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit'
    });
    const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD 格式
    
    const importGuidance = skillId === 'import-analysis' || hasAttachmentContext(messages)
        ? `\n\n## Attachment Import Guidance\n${IMPORT_SYSTEM_PROMPT}\n\nDIFF_JSON_SCHEMA:\n${JSON.stringify(DIFF_JSON_SCHEMA, null, 2)}`
        : '';

    const systemPrompt = `You are a professional Gantt project management assistant.

## Current Time
- Current time: ${currentDateTime}
- Today's date: ${todayDate}

${skill.content}${importGuidance}

## Critical Rules
- ${hasTools ? 'Use the provided tools for factual task data. Do not fabricate task data.' : 'You can answer generally, but clearly state you cannot access realtime task data without tool calls.'}
- If a tool returns an empty result, clearly say there are no matching tasks.
- If a tool returns an error field, explain the issue and suggest a next action.
- Response language must follow the current UI locale: ${languageName} (${language}). Do not switch languages unless the user explicitly asks.
- Keep answers concise and scannable. Avoid verbose filler.
- For overview questions, provide a 1-2 sentence conclusion first, then up to 3 key risks/suggestions.
- For list questions, keep one task per line and include only necessary fields (task name, status, due/overdue, progress).
- Prefer task citation format when applicable: [#hierarchy] Task Name.
- Use clean Markdown for structured output (headings, lists, tables, code blocks), not pseudo-table text.`;

    // 6. 通知 UI：Skill 开始
    callbacks?.onSkillStart?.({ skillId, skillName: skill.name });

    // 7. 执行带工具的流式调用
    console.log('[Executor] Calling streamText with:', {
        model: model?.modelId || model,
        hasSystem: !!systemPrompt,
        messagesCount: messages.length,
        toolNames: hasTools ? Object.keys(tools) : [],
        maxSteps: hasTools ? 5 : 1,
        toolChoice: hasTools ? 'auto' : undefined
    });
    
    // Debug: 检查工具的实际结构
    if (hasTools) {
        Object.entries(tools).forEach(([name, t]) => {
            console.log(`[Executor] Tool "${name}" structure:`, {
                type: typeof t,
                hasDescription: 'description' in t,
                hasInputSchema: 'inputSchema' in t,
                hasParameters: 'parameters' in t,
                hasExecute: 'execute' in t,
                // 检查 inputSchema 的内容
                inputSchemaType: t.inputSchema?.type,
                inputSchemaJsonSchema: t.inputSchema?.jsonSchema
            });
        });
    }
    
    const result = streamText({
        model: model,
        system: systemPrompt,
        messages,
        tools: hasTools ? tools : undefined,
        stopWhen: hasTools ? stepCountIs(5) : undefined,  // AI SDK 6: 使用 stopWhen 替代 maxSteps
        toolChoice: hasTools ? 'auto' : undefined,
        onStepFinish: ({ stepType, toolCalls, toolResults, text, finishReason }) => {
            console.log('[Executor] Step finished:', { stepType, finishReason, hasToolCalls: !!toolCalls?.length, hasToolResults: !!toolResults?.length, textLength: text?.length });
            
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

/**
 * 执行通用对话（无工具）
 * @param {Array} messages - 消息数组
 * @param {LanguageModel} model - 已创建的模型实例
 * @param {Object} callbacks - 回调函数
 */
export async function executeGeneralChat(messages, model, callbacks = {}) {
    const { language, languageName } = getLanguageInstruction();
    const importGuidance = hasAttachmentContext(messages)
        ? `\n\nAttachment detected. Prefer import-analysis style output with structured task diff JSON.`
        : '';
    return streamText({
        model: model,
        system: `You are a helpful project management assistant for Gantt workflows.
Response language must follow the current UI locale: ${languageName} (${language}).
If users ask for specific realtime task data, suggest they ask focused questions like "today's tasks" or "overdue tasks" so tool-enabled flows can provide precise results.${importGuidance}`,
        messages,
        maxSteps: 1
    });
}
