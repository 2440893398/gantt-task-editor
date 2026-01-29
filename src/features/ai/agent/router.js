/**
 * Skill 路由器
 * 根据用户消息选择合适的 Skill
 *
 * 路由优先级：
 * 1. 关键词快速匹配（无 API 开销）
 * 2. AI 路由（使用 generateObject）
 * 3. Fallback 到通用对话
 */
import { generateObject } from 'ai';
import { z } from 'zod';
import { getSkillDescriptions } from '../skills/registry.js';

/**
 * 关键词快速匹配模式
 */
const KEYWORD_PATTERNS = {
    'task-query': [
        /今[天日].*任务/,
        /逾期/,
        /哪些任务/,
        /任务.*状态/,
        /待[办处]理/,
        /未完成/,
        /高优先/,
        /优先级/
    ],
    'progress-analysis': [
        /进度/,
        /完成率/,
        /项目.*情况/,
        /项目.*概[况览]/,
        /风险/,
        /总[体结].*进/
    ]
};

/**
 * 关键词快速路由（无 API 调用）
 * @param {string} message - 用户消息
 * @returns {{ skill: string, method: 'keyword' } | null}
 */
export function quickRoute(message) {
    for (const [skillId, patterns] of Object.entries(KEYWORD_PATTERNS)) {
        if (patterns.some(p => p.test(message))) {
            return { skill: skillId, method: 'keyword' };
        }
    }
    return null;
}

/**
 * AI 路由 Schema
 */
const routerSchema = z.object({
    skill: z.string().nullable().describe('匹配的 Skill ID，无匹配返回 null'),
    confidence: z.number().min(0).max(1).describe('置信度'),
    reasoning: z.string().describe('判断理由')
});

/**
 * AI 路由（调用 LLM 判断意图）
 * @param {string} userMessage
 * @param {Function} openai - createOpenAI 实例
 * @param {string} model
 * @returns {Promise<{skill: string|null, confidence: number, reasoning: string}>}
 */
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

/**
 * 路由缓存（简单 Map，避免重复 AI 路由调用）
 */
const routeCache = new Map();
const CACHE_MAX_SIZE = 50;

/**
 * 带缓存的统一路由入口
 * @param {string} message
 * @param {Function} openai
 * @param {string} model
 * @returns {Promise<{skill: string|null, confidence: number, method: string}>}
 */
export async function routeWithCache(message, openai, model) {
    // 1. 关键词快速匹配
    const quick = quickRoute(message);
    if (quick) {
        return { skill: quick.skill, confidence: 0.9, method: 'keyword' };
    }

    // 2. 检查缓存
    if (routeCache.has(message)) {
        return { ...routeCache.get(message), method: 'cache' };
    }

    // 3. AI 路由
    try {
        const result = await routeToSkill(message, openai, model);

        // 缓存结果
        if (routeCache.size >= CACHE_MAX_SIZE) {
            const firstKey = routeCache.keys().next().value;
            routeCache.delete(firstKey);
        }
        routeCache.set(message, result);

        return { ...result, method: 'ai' };
    } catch (err) {
        console.warn('[Router] AI route failed, fallback to general:', err);
        return { skill: null, confidence: 0, method: 'fallback' };
    }
}
