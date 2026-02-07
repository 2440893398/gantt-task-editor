import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSmartChat } from '../../../../src/features/ai/api/client.js';
import { getAiConfigState, setAiStatus } from '../../../../src/core/store.js';
import { createOpenAI } from '@ai-sdk/openai';
import { quickRoute, routeToSkill } from '../../../../src/features/ai/agent/router.js';
import { executeSkill, executeGeneralChat } from '../../../../src/features/ai/agent/executor.js';

// Mock dependencies
vi.mock('../../../../src/core/store.js', () => ({
    getAiConfigState: vi.fn(),
    setAiStatus: vi.fn()
}));

vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: vi.fn()
}));

vi.mock('ai', () => ({
    streamText: vi.fn(),
    tool: vi.fn((definition) => definition)
}));

vi.mock('../../../../src/features/ai/agent/router.js', () => ({
    quickRoute: vi.fn(),
    routeToSkill: vi.fn()
}));

vi.mock('../../../../src/features/ai/agent/executor.js', () => ({
    executeSkill: vi.fn(),
    executeGeneralChat: vi.fn()
}));

describe('runSmartChat', () => {
    const mockConfig = {
        apiKey: 'test-key',
        baseUrl: 'https://api.test.com',
        model: 'gpt-4'
    };

    const mockOpenai = vi.fn((model) => `openai-${model}`);

    const createMockResult = (textChunks = ['Hello', ' World']) => ({
        textStream: (async function* () {
            for (const chunk of textChunks) {
                yield chunk;
            }
        })(),
        usage: Promise.resolve({
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30
        })
    });

    beforeEach(() => {
        vi.clearAllMocks();
        getAiConfigState.mockReturnValue(mockConfig);
        createOpenAI.mockReturnValue(mockOpenai);
    });

    // ---------------------------------------------------------------
    // 1. Configuration Validation
    // ---------------------------------------------------------------
    describe('Configuration Validation', () => {
        it('should call onError when apiKey is missing', async () => {
            getAiConfigState.mockReturnValue({ ...mockConfig, apiKey: '' });
            const onError = vi.fn();

            await runSmartChat('test message', [], { onError });

            expect(onError).toHaveBeenCalledWith(expect.any(Error));
            expect(onError.mock.calls[0][0].message).toBe('AI_NOT_CONFIGURED');
            expect(quickRoute).not.toHaveBeenCalled();
            expect(routeToSkill).not.toHaveBeenCalled();
        });

        it('should not call routing or execution when apiKey is missing', async () => {
            getAiConfigState.mockReturnValue({ apiKey: null });

            await runSmartChat('test', [], {});

            expect(createOpenAI).not.toHaveBeenCalled();
            expect(executeSkill).not.toHaveBeenCalled();
            expect(executeGeneralChat).not.toHaveBeenCalled();
        });
    });

    // ---------------------------------------------------------------
    // 2. Routing Logic
    // ---------------------------------------------------------------
    describe('Routing Logic', () => {
        it('should use quickRoute result when keyword match found', async () => {
            quickRoute.mockReturnValue({ skill: 'task-query', method: 'keyword' });
            executeSkill.mockResolvedValue(createMockResult());

            await runSmartChat('今天的任务', [], {});

            expect(quickRoute).toHaveBeenCalledWith('今天的任务');
            expect(routeToSkill).not.toHaveBeenCalled();
            expect(executeSkill).toHaveBeenCalledWith(
                'task-query',
                expect.any(Array),
                mockOpenai,
                'gpt-4',
                expect.any(Object)
            );
        });

        it('should use routeToSkill when quickRoute returns null', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({
                skill: 'progress-analysis',
                confidence: 0.85,
                reasoning: 'AI判断'
            });
            executeSkill.mockResolvedValue(createMockResult());

            await runSmartChat('项目进展如何', [], {});

            expect(quickRoute).toHaveBeenCalledWith('项目进展如何');
            expect(routeToSkill).toHaveBeenCalledWith('项目进展如何', mockOpenai, 'gpt-4');
            expect(executeSkill).toHaveBeenCalledWith(
                'progress-analysis',
                expect.any(Array),
                mockOpenai,
                'gpt-4',
                expect.any(Object)
            );
        });

        it('should use AI route skill when confidence > 0.7', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({
                skill: 'task-query',
                confidence: 0.8,
                reasoning: '高置信度'
            });
            executeSkill.mockResolvedValue(createMockResult());

            await runSmartChat('有什么要做的', [], {});

            expect(executeSkill).toHaveBeenCalledWith(
                'task-query',
                expect.any(Array),
                mockOpenai,
                'gpt-4',
                expect.any(Object)
            );
        });

        it('should use general chat when AI route confidence <= 0.7', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({
                skill: 'task-query',
                confidence: 0.5,
                reasoning: '低置信度'
            });
            executeGeneralChat.mockResolvedValue(createMockResult());

            await runSmartChat('你好', [], {});

            expect(executeSkill).not.toHaveBeenCalled();
            expect(executeGeneralChat).toHaveBeenCalledWith(
                expect.any(Array),
                mockOpenai,
                'gpt-4'
            );
        });

        it('should fallback to general chat when routeToSkill throws error', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockRejectedValue(new Error('API Error'));
            executeGeneralChat.mockResolvedValue(createMockResult());

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            await runSmartChat('test', [], {});

            expect(warnSpy).toHaveBeenCalledWith(
                '[SmartChat] Route failed, fallback to general:',
                expect.any(Error)
            );
            expect(executeGeneralChat).toHaveBeenCalled();

            warnSpy.mockRestore();
        });
    });

    // ---------------------------------------------------------------
    // 3. Execution Paths
    // ---------------------------------------------------------------
    describe('Execution Paths', () => {
        it('should call executeSkill with correct parameters when skillId exists', async () => {
            quickRoute.mockReturnValue({ skill: 'task-query', method: 'keyword' });
            executeSkill.mockResolvedValue(createMockResult());

            const callbacks = {
                onToolCall: vi.fn(),
                onToolResult: vi.fn(),
                onSkillStart: vi.fn()
            };

            await runSmartChat('test', [], callbacks);

            expect(executeSkill).toHaveBeenCalledWith(
                'task-query',
                [{ role: 'user', content: 'test' }],
                mockOpenai,
                'gpt-4',
                {
                    onToolCall: callbacks.onToolCall,
                    onToolResult: callbacks.onToolResult,
                    onSkillStart: callbacks.onSkillStart
                }
            );
        });

        it('should call executeGeneralChat when skillId is null', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0.3, reasoning: '通用对话' });
            executeGeneralChat.mockResolvedValue(createMockResult());

            await runSmartChat('hello', [], {});

            expect(executeGeneralChat).toHaveBeenCalledWith(
                [{ role: 'user', content: 'hello' }],
                mockOpenai,
                'gpt-4'
            );
            expect(executeSkill).not.toHaveBeenCalled();
        });

        it('should transform history array to messages format', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult());

            const history = [
                { role: 'user', content: 'first message' },
                { role: 'assistant', content: 'first response' }
            ];

            await runSmartChat('second message', history, {});

            expect(executeGeneralChat).toHaveBeenCalledWith(
                [
                    { role: 'user', content: 'first message' },
                    { role: 'assistant', content: 'first response' },
                    { role: 'user', content: 'second message' }
                ],
                mockOpenai,
                'gpt-4'
            );
        });

        it('should create openai instance with correct config', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult());

            await runSmartChat('test', [], {});

            expect(createOpenAI).toHaveBeenCalledWith({
                apiKey: 'test-key',
                baseURL: 'https://api.test.com',
                compatibility: 'strict'
            });
        });

        it('should use default model when config.model is undefined', async () => {
            getAiConfigState.mockReturnValue({ ...mockConfig, model: undefined });
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult());

            await runSmartChat('test', [], {});

            expect(routeToSkill).toHaveBeenCalledWith('test', mockOpenai, 'gpt-3.5-turbo');
            expect(executeGeneralChat).toHaveBeenCalledWith(
                expect.any(Array),
                mockOpenai,
                'gpt-3.5-turbo'
            );
        });
    });

    // ---------------------------------------------------------------
    // 4. Streaming Response
    // ---------------------------------------------------------------
    describe('Streaming Response', () => {
        it('should trigger onChunk for each text part', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult(['Hello', ' ', 'World']));

            const onChunk = vi.fn();

            await runSmartChat('test', [], { onChunk });

            expect(onChunk).toHaveBeenCalledTimes(3);
            expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello');
            expect(onChunk).toHaveBeenNthCalledWith(2, ' ');
            expect(onChunk).toHaveBeenNthCalledWith(3, 'World');
        });

        it('should call onFinish with usage data after stream completes', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });

            const usageData = { promptTokens: 15, completionTokens: 25, totalTokens: 40 };
            const mockResult = {
                textStream: (async function* () { yield 'done'; })(),
                usage: Promise.resolve(usageData)
            };
            executeGeneralChat.mockResolvedValue(mockResult);

            const onFinish = vi.fn();

            await runSmartChat('test', [], { onFinish });

            expect(onFinish).toHaveBeenCalledWith(usageData);
        });

        it('should process text chunks in order', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult(['A', 'B', 'C', 'D']));

            const chunks = [];
            const onChunk = vi.fn((chunk) => chunks.push(chunk));

            await runSmartChat('test', [], { onChunk });

            expect(chunks).toEqual(['A', 'B', 'C', 'D']);
        });
    });

    // ---------------------------------------------------------------
    // 5. Callback Propagation
    // ---------------------------------------------------------------
    describe('Callback Propagation', () => {
        it('should pass tool callbacks to executeSkill', async () => {
            quickRoute.mockReturnValue({ skill: 'task-query', method: 'keyword' });
            executeSkill.mockResolvedValue(createMockResult());

            const onToolCall = vi.fn();
            const onToolResult = vi.fn();
            const onSkillStart = vi.fn();

            await runSmartChat('test', [], { onToolCall, onToolResult, onSkillStart });

            const executorCallbacks = executeSkill.mock.calls[0][4];
            expect(executorCallbacks).toMatchObject({
                onToolCall,
                onToolResult,
                onSkillStart
            });
        });

        it('should handle missing callbacks gracefully', async () => {
            quickRoute.mockReturnValue({ skill: 'task-query', method: 'keyword' });
            executeSkill.mockResolvedValue(createMockResult());

            await runSmartChat('test', [], {});

            expect(executeSkill).toHaveBeenCalled();
            const executorCallbacks = executeSkill.mock.calls[0][4];
            expect(executorCallbacks).toEqual({
                onToolCall: undefined,
                onToolResult: undefined,
                onSkillStart: undefined
            });
        });
    });

    // ---------------------------------------------------------------
    // 6. Status Management
    // ---------------------------------------------------------------
    describe('Status Management', () => {
        it('should set status to loading at start', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult());

            await runSmartChat('test', [], {});

            expect(setAiStatus).toHaveBeenCalledWith('loading');
        });

        it('should set status to idle after successful completion', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockResolvedValue(createMockResult());

            await runSmartChat('test', [], {});

            expect(setAiStatus).toHaveBeenCalledWith('idle');
        });

        it('should set status to error on exception', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockRejectedValue(new Error('Execution failed'));

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await runSmartChat('test', [], {});

            expect(setAiStatus).toHaveBeenCalledWith('error');

            errorSpy.mockRestore();
        });
    });

    // ---------------------------------------------------------------
    // 7. Error Handling
    // ---------------------------------------------------------------
    describe('Error Handling', () => {
        it('should call onError when execution throws exception', async () => {
            const error = new Error('Stream failed');
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockRejectedValue(error);

            const onError = vi.fn();
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await runSmartChat('test', [], { onError });

            expect(onError).toHaveBeenCalledWith(error);

            errorSpy.mockRestore();
        });

        it('should log error to console when exception occurs', async () => {
            const error = new Error('Test error');
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockRejectedValue(error);

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await runSmartChat('test', [], {});

            expect(errorSpy).toHaveBeenCalledWith('[AI Client] Smart chat error:', error);

            errorSpy.mockRestore();
        });

        it('should handle both setAiStatus and onError on exception', async () => {
            quickRoute.mockReturnValue(null);
            routeToSkill.mockResolvedValue({ skill: null, confidence: 0, reasoning: '' });
            executeGeneralChat.mockRejectedValue(new Error('Failed'));

            const onError = vi.fn();
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await runSmartChat('test', [], { onError });

            expect(setAiStatus).toHaveBeenCalledWith('error');
            expect(onError).toHaveBeenCalled();

            errorSpy.mockRestore();
        });
    });
});
