/**
 * AI SDK 流式客户端封装
 * 基于 Vercel AI SDK Core (@ai-sdk/openai + ai)
 */

import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { getAiConfigState, setAiStatus } from '../../../core/store.js';
import { quickRoute, routeToSkill } from '../agent/router.js';
import { executeSkill, executeGeneralChat } from '../agent/executor.js';

/**
 * 执行智能体流式调用
 * @param {Object} agentConfig - 智能体配置 { system, userPrompt }
 * @param {Object} userContext - 用户上下文数据
 * @param {Function} onChunk - 每个文本块的回调 (text) => void
 * @param {Function} onFinish - 完成回调 () => void
 * @param {Function} onError - 错误回调 (error) => void
 * @returns {Promise<void>}
 */
export async function runAgentStream(agentConfig, userContext, onChunk, onFinish, onError) {
    const { apiKey, baseUrl, model } = getAiConfigState();

    // 检查配置
    if (!apiKey) {
        const error = new Error('AI_NOT_CONFIGURED');
        onError && onError(error);
        return;
    }

    setAiStatus('loading');

    try {
        // 动态创建 Provider (BYOK 核心)
        const openai = createOpenAI({
            apiKey: apiKey,
            baseURL: baseUrl,
            compatibility: 'strict'
        });

        // 执行流式调用
        let streamOptions = {
            model: openai(model || 'gpt-3.5-turbo'),
            system: agentConfig.system,
        };

        // F-106: 支持多轮对话消息
        if (userContext.messages && Array.isArray(userContext.messages)) {
            streamOptions.messages = userContext.messages;
        } else {
            // 单轮 prompt
            const userPrompt = typeof agentConfig.userPrompt === 'function'
                ? agentConfig.userPrompt(userContext)
                : agentConfig.userPrompt;
            streamOptions.prompt = userPrompt;
        }

        const result = streamText(streamOptions);



        // 使用 textStream 获取文本流，更稳定
        for await (const textPart of result.textStream) {
            onChunk && onChunk(textPart);
        }

        // 获取 usage 信息
        const usage = await result.usage;

        setAiStatus('idle');
        onFinish && onFinish(usage);

    } catch (error) {
        console.error('[AI Client] Stream error:', error);
        setAiStatus('error');
        onError && onError(error);
    }
}

/**
 * 智能对话入口（支持 Skill 路由 + 工具调用）
 *
 * 路由优先级：关键词快速匹配 → AI 路由 → 通用对话
 *
 * @param {string} userMessage
 * @param {Array<{role: string, content: string}>} history
 * @param {Object} callbacks
 */
export async function runSmartChat(userMessage, history, callbacks = {}) {
    const { onChunk, onFinish, onError, onToolCall, onToolResult, onSkillStart } = callbacks;
    const { apiKey, baseUrl, model } = getAiConfigState();
    const resolvedModel = model || 'gpt-3.5-turbo';

    if (!apiKey) {
        onError?.(new Error('AI_NOT_CONFIGURED'));
        return;
    }

    setAiStatus('loading');

    try {
        const openai = createOpenAI({
            apiKey: apiKey,
            baseURL: baseUrl,
            compatibility: 'strict'
        });

        const messages = [
            ...(Array.isArray(history) ? history.map(m => ({ role: m.role, content: m.content })) : []),
            { role: 'user', content: userMessage }
        ];

        // Phase 1: route
        let skillId = null;
        const quickResult = quickRoute(userMessage);
        if (quickResult) {
            skillId = quickResult.skill;
        }

        if (!skillId) {
            try {
                const route = await routeToSkill(userMessage, openai, resolvedModel);
                if (route.skill && route.confidence > 0.7) {
                    skillId = route.skill;
                }
            } catch (routeError) {
                console.warn('[SmartChat] Route failed, fallback to general:', routeError);
            }
        }

        // Phase 2: execute
        let result;
        if (skillId) {
            result = await executeSkill(skillId, messages, openai, resolvedModel, {
                onToolCall,
                onToolResult,
                onSkillStart
            });
        } else {
            result = await executeGeneralChat(messages, openai, resolvedModel);
        }

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

/**
 * 测试 AI 配置连接
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testConnection(config = null) {
    const { apiKey, baseUrl, model } = config || getAiConfigState();

    if (!apiKey) {
        return { success: false, message: 'API Key 未配置' };
    }

    try {
        const openai = createOpenAI({
            apiKey: apiKey,
            baseURL: baseUrl,
            compatibility: 'strict'
        });

        // 发送简单测试请求
        const result = streamText({
            model: openai(model || 'gpt-3.5-turbo'),
            prompt: 'Hi',
            maxTokens: 5
        });

        // 只需要确认能接收到响应
        for await (const _ of result.textStream) {
            break; // 收到第一个 chunk 即可
        }

        return { success: true, message: '连接成功' };

    } catch (error) {
        console.error('[AI Client] Connection test failed:', error);
        return {
            success: false,
            message: error.message || '连接失败，请检查配置'
        };
    }
}

/**
 * 判断 URL 是否为本地地址
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'localhost' ||
            parsed.hostname === '127.0.0.1' ||
            parsed.hostname.startsWith('192.168.') ||
            parsed.hostname.startsWith('10.');
    } catch {
        return false;
    }
}

/**
 * 计算字符串的简单哈希值
 * @param {string} str 
 * @returns {string}
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

/**
 * 获取模型列表缓存键
 * @param {string} baseUrl 
 * @returns {string}
 */
function getModelCacheKey(baseUrl) {
    return `ai_models_cache_${simpleHash(baseUrl || '')}`;
}

/**
 * 获取模型列表 (F-103)
 * 调用 OpenAI 兼容的 /v1/models 接口
 * @param {boolean} forceRefresh - 是否强制刷新（忽略缓存）
 * @returns {Promise<{success: boolean, models: Array, fromCache: boolean, error?: string}>}
 */
export async function fetchModelList(forceRefresh = false) {
    const { apiKey, baseUrl } = getAiConfigState();

    if (!apiKey && !isLocalUrl(baseUrl)) {
        return { success: false, models: [], fromCache: false, error: 'API Key 未配置' };
    }

    const cacheKey = getModelCacheKey(baseUrl);
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    // 检查缓存
    if (!forceRefresh) {
        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { models, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_TTL) {
                    return { success: true, models, fromCache: true };
                }
            }
        } catch (e) {
            console.warn('[AI Client] Cache read error:', e);
        }
    }

    // 请求模型列表
    try {
        const modelsUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/models` : 'https://api.openai.com/v1/models';

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const models = (data.data || []).map(m => ({
            id: m.id,
            name: m.id,
            owned_by: m.owned_by || 'unknown',
            created: m.created
        }));

        // 按名称排序
        models.sort((a, b) => a.id.localeCompare(b.id));

        // 缓存结果
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                models,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('[AI Client] Cache write error:', e);
        }

        return { success: true, models, fromCache: false };

    } catch (error) {
        console.error('[AI Client] Fetch models error:', error);
        return { success: false, models: [], fromCache: false, error: error.message };
    }
}

/**
 * 检查模型缓存是否过期
 * @param {string} baseUrl 
 * @returns {boolean}
 */
export function isModelCacheExpired(baseUrl) {
    const cacheKey = getModelCacheKey(baseUrl);
    const CACHE_TTL = 24 * 60 * 60 * 1000;

    try {
        const cached = localStorage.getItem(cacheKey);
        if (!cached) return true;
        const { timestamp } = JSON.parse(cached);
        return Date.now() - timestamp >= CACHE_TTL;
    } catch {
        return true;
    }
}

