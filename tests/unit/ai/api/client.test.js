
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgentStream, testConnection, isLocalUrl } from '../../../../src/features/ai/api/client.js';
import { getAiConfigState, setAiStatus } from '../../../../src/core/store.js';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Mock dependencies
vi.mock('../../../../src/core/store.js', () => ({
    getAiConfigState: vi.fn(),
    setAiStatus: vi.fn()
}));

vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: vi.fn()
}));

vi.mock('ai', () => ({
    streamText: vi.fn()
}));

describe('AI Client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('isLocalUrl', () => {
        it('should return true for localhost', () => {
            expect(isLocalUrl('http://localhost:11434')).toBe(true);
            expect(isLocalUrl('http://127.0.0.1:8000')).toBe(true);
        });

        it('should return true for local network IPs', () => {
            expect(isLocalUrl('http://192.168.1.5:1234')).toBe(true);
            expect(isLocalUrl('http://10.0.0.1')).toBe(true);
        });

        it('should return false for public URLs', () => {
            expect(isLocalUrl('https://api.openai.com')).toBe(false);
            expect(isLocalUrl('https://www.google.com')).toBe(false);
        });

        it('should return false for invalid URLs', () => {
            expect(isLocalUrl('invalid-url')).toBe(false);
            expect(isLocalUrl('')).toBe(false);
            expect(isLocalUrl(null)).toBe(false);
        });
    });

    describe('runAgentStream', () => {
        const mockConfig = {
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com',
            model: 'gpt-4'
        };

        const mockAgentConfig = {
            system: 'system prompt',
            userPrompt: 'user prompt'
        };

        beforeEach(() => {
            getAiConfigState.mockReturnValue(mockConfig);
            createOpenAI.mockReturnValue(vi.fn());
        });

        it('should handle missing API key', async () => {
            getAiConfigState.mockReturnValue({ ...mockConfig, apiKey: '' });
            const onError = vi.fn();

            await runAgentStream(mockAgentConfig, {}, null, null, onError);

            expect(onError).toHaveBeenCalledWith(expect.any(Error));
            expect(onError.mock.calls[0][0].message).toBe('AI_NOT_CONFIGURED');
        });

        it('should execute stream successfully', async () => {
            const mockStream = {
                textStream: (async function* () {
                    yield 'Hello';
                    yield ' World';
                })()
            };
            streamText.mockReturnValue(mockStream);

            const onChunk = vi.fn();
            const onFinish = vi.fn();

            await runAgentStream(mockAgentConfig, {}, onChunk, onFinish, null);

            expect(createOpenAI).toHaveBeenCalledWith({
                apiKey: mockConfig.apiKey,
                baseURL: mockConfig.baseUrl,
                compatibility: 'strict'
            });
            expect(streamText).toHaveBeenCalled();
            expect(setAiStatus).toHaveBeenCalledWith('loading');
            // 注意：streaming 状态已在代码重构中移除，直接从 loading -> idle
            expect(onChunk).toHaveBeenCalledTimes(2);
            expect(onChunk).toHaveBeenCalledWith('Hello');
            expect(onChunk).toHaveBeenCalledWith(' World');
            expect(setAiStatus).toHaveBeenCalledWith('idle');
            expect(onFinish).toHaveBeenCalled();
        });

        it('should handle dynamic user prompt function', async () => {
            const dynamicPromptAgent = {
                system: 'sys',
                userPrompt: (ctx) => `Context: ${ctx.data}`
            };
            const context = { data: 'test' };

            const mockStream = {
                textStream: (async function* () { yield 'ok'; })()
            };
            streamText.mockReturnValue(mockStream);

            await runAgentStream(dynamicPromptAgent, context, null, null, null);

            expect(streamText).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Context: test'
            }));
        });

        it('should handle stream errors', async () => {
            const error = new Error('Stream failed');
            streamText.mockImplementation(() => { throw error; });
            const onError = vi.fn();

            await runAgentStream(mockAgentConfig, {}, null, null, onError);

            expect(setAiStatus).toHaveBeenCalledWith('error');
            expect(onError).toHaveBeenCalledWith(error);
        });
    });

    describe('testConnection', () => {
        const mockConfig = {
            apiKey: 'test-key',
            baseUrl: 'https://api.test.com'
        };

        beforeEach(() => {
            getAiConfigState.mockReturnValue(mockConfig);
            createOpenAI.mockReturnValue(vi.fn());
        });

        it('should return success when stream works', async () => {
            const mockStream = {
                textStream: (async function* () {
                    yield 'Connected';
                })()
            };
            streamText.mockReturnValue(mockStream);

            const result = await testConnection();

            expect(result).toEqual({ success: true, message: '连接成功' });
        });

        it('should return failure when API key is missing', async () => {
            getAiConfigState.mockReturnValue({ ...mockConfig, apiKey: '' });

            const result = await testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toContain('API Key');
        });

        it('should return failure on exception', async () => {
            streamText.mockImplementation(() => { throw new Error('Network error'); });

            const result = await testConnection();

            expect(result.success).toBe(false);
            expect(result.message).toBe('Network error');
        });
    });
});
