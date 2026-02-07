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
 * Debug: Intercept fetch to log actual API endpoints
 * Only enabled when needed for debugging
 */
let fetchInterceptorEnabled = false;
const originalFetch = globalThis.fetch;

function enableFetchInterceptor() {
    if (fetchInterceptorEnabled) return;
    
    globalThis.fetch = async (url, options) => {
        if (typeof url === 'string' && (url.includes('/chat/completions') || url.includes('/responses'))) {
            console.log('[Fetch Interceptor] API Request:', {
                url,
                method: options?.method || 'GET',
                headers: options?.headers ? Object.fromEntries(
                    Object.entries(options.headers).filter(([k]) => k !== 'Authorization')
                ) : {}
            });
        }
        
        try {
            const response = await originalFetch(url, options);
            if (typeof url === 'string' && (url.includes('/chat/completions') || url.includes('/responses'))) {
                console.log('[Fetch Interceptor] API Response:', {
                    url,
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok
                });
            }
            return response;
        } catch (error) {
            if (typeof url === 'string' && (url.includes('/chat/completions') || url.includes('/responses'))) {
                console.error('[Fetch Interceptor] API Error:', {
                    url,
                    error: error.message
                });
            }
            throw error;
        }
    };
    
    fetchInterceptorEnabled = true;
    console.log('[Fetch Interceptor] Enabled');
}

function disableFetchInterceptor() {
    if (!fetchInterceptorEnabled) return;
    globalThis.fetch = originalFetch;
    fetchInterceptorEnabled = false;
    console.log('[Fetch Interceptor] Disabled');
}


/**
 * 根据 baseURL 智能选择 compatibility 模式
 * 
 * @param {string} baseUrl - API 端点 URL
 * @returns {'strict' | 'compatible'} - 兼容模式
 * 
 * 规则：
 * - OpenAI 官方端点 (api.openai.com, openai.azure.com) → 'strict'
 * - 第三方兼容端点 (aihubmix.com, deepseek, 本地等) → 'compatible'
 * - 未设置 baseURL → 'strict' (默认官方端点)
 */
function getCompatibilityMode(baseUrl) {
    // 如果未设置 baseURL，默认使用官方端点
    if (!baseUrl) {
        return 'strict';
    }
    
    // 标准化 URL（去除协议、路径、尾部斜杠）
    const normalizedUrl = baseUrl
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/\/$/, '');
    
    // OpenAI 官方端点列表
    const officialEndpoints = [
        'api.openai.com',
        'openai.azure.com'  // Azure OpenAI Service
    ];
    
    // 检查是否为官方端点
    const isOfficial = officialEndpoints.some(endpoint => 
        normalizedUrl === endpoint || normalizedUrl.endsWith(`.${endpoint}`)
    );
    
    const mode = isOfficial ? 'strict' : 'compatible';
    
    // 开发环境日志
    if (import.meta.env.DEV) {
        console.log(`[AI Client] Using compatibility mode: ${mode} for ${baseUrl || 'default'}`);
    }
    
    return mode;
}

/**
 * 判断是否应该使用 /chat/completions 端点而非 /responses
 * 
 * AI SDK 3.0+ 默认使用 /responses 端点（OpenAI Responses API）
 * 但第三方 API（如 DeepSeek, AiHubMix 等）只支持 /chat/completions
 * 
 * @param {string} baseUrl - API 端点 URL
 * @returns {boolean} - true = 使用 .chat()，false = 使用默认（responses）
 */
function shouldUseChatEndpoint(baseUrl) {
    // 如果未设置 baseURL，默认使用官方端点，支持 /responses
    if (!baseUrl) {
        return false;
    }
    
    // 标准化 URL
    const normalizedUrl = baseUrl
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/\/$/, '');
    
    // 支持 /responses 端点的 API（目前只有 OpenAI 官方）
    const responsesApiSupported = [
        'api.openai.com'
    ];
    
    const supportsResponses = responsesApiSupported.some(endpoint => 
        normalizedUrl === endpoint || normalizedUrl.endsWith(`.${endpoint}`)
    );
    
    const useChatEndpoint = !supportsResponses;
    
    if (import.meta.env.DEV) {
        console.log(`[AI Client] Endpoint selection: ${useChatEndpoint ? '/chat/completions' : '/responses'} for ${baseUrl}`);
    }
    
    return useChatEndpoint;
}

/**
 * 创建模型实例，根据 API 端点自动选择正确的调用方式
 * 
 * @param {ReturnType<typeof createOpenAI>} openaiProvider - OpenAI provider 实例
 * @param {string} modelId - 模型 ID
 * @param {string} baseUrl - API 端点 URL
 * @returns {LanguageModel} - 语言模型实例
 */
function createModel(openaiProvider, modelId, baseUrl) {
    if (shouldUseChatEndpoint(baseUrl)) {
        // 第三方 API：使用 .chat() 强制走 /chat/completions
        return openaiProvider.chat(modelId);
    } else {
        // OpenAI 官方：使用默认（/responses）
        return openaiProvider(modelId);
    }
}

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
            compatibility: getCompatibilityMode(baseUrl)
        });

        // 执行流式调用
        let streamOptions = {
            model: createModel(openai, model || 'gpt-3.5-turbo', baseUrl),
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
            compatibility: getCompatibilityMode(baseUrl)
        });
        
        // 创建正确端点的模型实例
        const modelInstance = createModel(openai, resolvedModel, baseUrl);

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
                const route = await routeToSkill(userMessage, modelInstance);
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
            result = await executeSkill(skillId, messages, modelInstance, {
                onToolCall,
                onToolResult,
                onSkillStart
            });
        } else {
            result = await executeGeneralChat(messages, modelInstance);
        }

        // 使用 fullStream 来正确处理多步骤流（包括工具调用后的继续生成）
        // textStream 在某些情况下可能不会等待所有 steps 完成
        let stepCount = 0;
        console.log('[SmartChat] Starting to consume fullStream...');
        
        for await (const part of result.fullStream) {
            // console.log('[SmartChat] Stream part:', part.type, part);
            
            if (part.type === 'text-delta') {
                // AI SDK 6: 属性名是 text 或 textDelta，需要兼容两种
                const textContent = part.text ?? part.textDelta;
                if (textContent) {
                    onChunk?.(textContent);
                }
            } else if (part.type === 'step-start' || part.type === 'start-step') {
                stepCount++;
                console.log(`[SmartChat] Step ${stepCount} started`);
            } else if (part.type === 'step-finish' || part.type === 'finish-step') {
                console.log(`[SmartChat] Step ${stepCount} finished:`, part.finishReason);
            } else if (part.type === 'tool-call') {
                console.log(`[SmartChat] Tool call:`, part.toolName, part.input);
                onToolCall?.([{ id: part.toolCallId, name: part.toolName, args: part.input }]);
            } else if (part.type === 'tool-result') {
                console.log(`[SmartChat] Tool result:`, part.toolName, part.output);
                onToolResult?.([{ id: part.toolCallId, name: part.toolName, result: part.output }]);
            } else if (part.type === 'finish') {
                console.log(`[SmartChat] Stream finished:`, part.finishReason);
            }
        }
        
        console.log('[SmartChat] fullStream consumption complete, total steps:', stepCount);

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
        return { 
            success: false, 
            message: 'API Key 未配置',
            toolCallSupported: false
        };
    }

    try {
        const compatibilityMode = getCompatibilityMode(baseUrl);
        
        // Enable fetch interceptor to see actual endpoints
        enableFetchInterceptor();
        
        // Debug: Log configuration
        console.log('[Test Connection] Starting with config:', {
            baseURL: baseUrl || '(default: api.openai.com)',
            model: model || 'gpt-3.5-turbo',
            compatibility: compatibilityMode,
            hasApiKey: !!apiKey
        });
        
        const openai = createOpenAI({
            apiKey: apiKey,
            baseURL: baseUrl,
            compatibility: compatibilityMode
        });
        
        // 创建正确端点的模型实例
        const modelInstance = createModel(openai, model || 'gpt-3.5-turbo', baseUrl);

        // 第一步：测试基础连接
        console.log('[Test Connection] Step 1: Basic connection test...');
        const basicTest = streamText({
            model: modelInstance,
            prompt: 'Hi',
            maxTokens: 5
        });

        // 只需要确认能接收到响应
        for await (const _ of basicTest.textStream) {
            break; // 收到第一个 chunk 即可
        }
        
        console.log('[Test Connection] Step 1: ✓ Basic connection successful');

        // 第二步：测试函数调用支持
        console.log('[Test Connection] Step 2: Testing function calling support...');
        let toolCallSupported = false;
        let toolCallError = null;
        
        try {
            const { tool, jsonSchema } = await import('ai');
            
            // 使用 jsonSchema + inputSchema（AI SDK 6 正确用法）
            // 注意：AI SDK 6 使用 inputSchema 而非 parameters！
            const weatherSchema = jsonSchema({
                type: 'object',
                properties: {
                    location: {
                        type: 'string',
                        description: 'The city name'
                    }
                },
                required: ['location'],
                additionalProperties: false
            });
            
            // 创建测试工具
            const testTool = tool({
                description: 'Get the current weather for a given location',
                inputSchema: weatherSchema,
                execute: async ({ location }) => ({ 
                    temperature: 20, 
                    condition: 'sunny',
                    location: location
                })
            });
            
            console.log('[Test Connection] Step 2: Calling streamText with tool...');
            
            // 为 reasoning 模型添加超时保护
            const isReasoningModel = (model || '').toLowerCase().includes('reasoner') || 
                                     (model || '').toLowerCase().includes('o1') ||
                                     (model || '').toLowerCase().includes('o3');
            
            if (isReasoningModel) {
                // Reasoning 模型通常不支持工具调用，跳过测试
                console.log('[Test Connection] Step 2: ⚠ Reasoning model detected, skipping tool call test');
                toolCallSupported = false;
                toolCallError = 'Reasoning models typically do not support tool calling';
            } else {
                // 使用 toolChoice: 'required' 强制模型调用工具
                // 这样可以准确测试 API 是否支持函数调用
                const toolTest = streamText({
                    model: modelInstance,
                    messages: [
                        { role: 'user', content: 'What is the weather in Beijing?' }
                    ],
                    tools: { get_weather: testTool },
                    toolChoice: 'required',  // 强制调用工具
                    maxSteps: 1,  // 只需要一步，不需要多轮
                    maxTokens: 100
                });
                
                console.log('[Test Connection] Step 2: Consuming stream (toolChoice: required)...');
                
                // 必须先消费 stream 才能获取 response/usage
                // 使用 Promise.race 添加超时保护
                const TOOL_TEST_TIMEOUT = 30000; // 30 秒超时
                
                const consumeStream = async () => {
                    let textContent = '';
                    let toolCallDetected = false;
                    let finishReason = null;
                    
                    // 消费 fullStream 以获取完整信息（包括 tool-call 和 tool-result）
                    for await (const part of toolTest.fullStream) {
                        if (part.type === 'tool-call') {
                            toolCallDetected = true;
                            console.log('[Test Connection] Step 2: Tool call detected:', part.toolName, part.args);
                        } else if (part.type === 'tool-result') {
                            console.log('[Test Connection] Step 2: Tool result received:', part.result);
                        } else if (part.type === 'text-delta') {
                            textContent += part.textDelta;
                        } else if (part.type === 'finish') {
                            finishReason = part.finishReason;
                            console.log('[Test Connection] Step 2: Finish reason:', finishReason);
                        }
                    }
                    
                    return { toolCallDetected, textContent, finishReason };
                };
                
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Tool test timeout')), TOOL_TEST_TIMEOUT);
                });
                
                try {
                    const { toolCallDetected, finishReason } = await Promise.race([consumeStream(), timeoutPromise]);
                    
                    if (toolCallDetected || finishReason === 'tool-calls') {
                        toolCallSupported = true;
                        console.log('[Test Connection] Step 2: ✓ Tool calling supported');
                    } else {
                        // 使用了 toolChoice: required 但还是没调用工具
                        // 可能是 API 不支持 toolChoice，我们认为支持是未知的
                        toolCallSupported = null;
                        toolCallError = 'Model did not call tool even with toolChoice: required';
                        console.log('[Test Connection] Step 2: ⚠ Cannot determine - no tool call with required choice');
                    }
                } catch (streamError) {
                    if (streamError.message === 'Tool test timeout') {
                        console.warn('[Test Connection] Step 2: ⚠ Tool test timed out');
                        toolCallSupported = null;
                        toolCallError = 'Tool test timed out - cannot determine support';
                    } else {
                        throw streamError; // Re-throw other errors
                    }
                }
            }
            
        } catch (toolError) {
            toolCallError = toolError.message;
            console.error('[Test Connection] Step 2: Tool call test failed:', {
                message: toolError.message,
                status: toolError.status,
                statusText: toolError.statusText,
                url: toolError.url,
                stack: toolError.stack
            });
            
            // 检查是否是 schema 错误
            if (toolError.message?.includes('Invalid schema') || 
                toolError.message?.includes('type: "None"') ||
                toolError.message?.includes('does not support') ||
                toolError.message?.includes('not supported')) {
                toolCallSupported = false;
                console.log('[Test Connection] Step 2: ✗ Schema error detected - function calling not supported');
            } else if (toolError.status === 404) {
                // 404 错误 - 可能是端点问题
                toolCallSupported = null;
                console.error('[Test Connection] Step 2: ⚠ 404 Error - Wrong endpoint or path?');
            } else {
                // 其他错误可能不是不支持，而是配置问题
                toolCallSupported = null; // 未知
                console.warn('[Test Connection] Step 2: ⚠ Unknown error - cannot determine support');
            }
        }

        // 返回测试结果
        const result = {
            success: true,
            message: '连接成功',
            toolCallSupported: toolCallSupported
        };
        
        // 添加详细说明
        if (toolCallSupported === false) {
            result.message = '✓ 连接成功，但不支持函数调用';
            result.warning = '该 API/模型不支持函数调用，AI 将无法获取实时任务数据';
        } else if (toolCallSupported === true) {
            result.message = '✓ 连接成功，支持函数调用';
        } else {
            result.message = '✓ 连接成功，函数调用支持未知';
            result.warning = '无法确定是否支持函数调用';
        }
        
        // Disable fetch interceptor
        disableFetchInterceptor();
        
        return result;

    } catch (error) {
        // Disable fetch interceptor on error
        disableFetchInterceptor();
        
        console.error('[Test Connection] Failed:', {
            message: error.message,
            status: error.status,
            statusText: error.statusText,
            url: error.url,
            cause: error.cause,
            stack: error.stack
        });
        
        // If it's a 404 error, provide more specific message
        if (error.status === 404) {
            return {
                success: false,
                message: `连接失败 (404): 端点路径错误\n\nbaseURL: ${baseUrl || '(default)'}\nmodel: ${model || 'gpt-3.5-turbo'}\n\n可能原因：\n1. baseURL 路径不正确（需要确认是否包含 /v1）\n2. 模型名称触发了错误的端点选择\n3. API 不支持该端点`,
                toolCallSupported: false
            };
        }
        
        return {
            success: false,
            message: error.message || '连接失败，请检查配置',
            toolCallSupported: false
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

