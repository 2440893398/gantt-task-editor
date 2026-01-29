/**
 * 路由阶段 System Prompt 构建器
 */

/**
 * 构建路由 System Prompt
 * @param {Array<{name: string, description: string}>} skills
 * @returns {string}
 */
export function buildRouterPrompt(skills) {
    return `你是一个意图路由器。根据用户消息判断应该使用哪个 Skill。

可用 Skills:
${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}

规则:
1. 如果用户问题明确匹配某个 Skill，返回该 Skill ID
2. 如果是通用对话（闲聊、问候等），返回 null
3. 如果不确定，返回置信度较低的最佳匹配`;
}
