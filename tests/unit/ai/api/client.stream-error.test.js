import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/core/store.js', () => ({
    getAiConfigState: vi.fn(),
    setAiStatus: vi.fn()
}));

vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: vi.fn()
}));

vi.mock('../../../../src/features/ai/agent/router.js', () => ({
    quickRoute: vi.fn(),
    routeToSkill: vi.fn()
}));

vi.mock('../../../../src/features/ai/agent/executor.js', () => ({
    executeSkill: vi.fn(),
    executeGeneralChat: vi.fn()
}));

import { runSmartChat } from '../../../../src/features/ai/api/client.js';
import { getAiConfigState, setAiStatus } from '../../../../src/core/store.js';
import { createOpenAI } from '@ai-sdk/openai';
import { quickRoute, routeToSkill } from '../../../../src/features/ai/agent/router.js';
import { executeGeneralChat } from '../../../../src/features/ai/agent/executor.js';

describe('runSmartChat stream error propagation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getAiConfigState.mockReturnValue({
            apiKey: 'test-key',
            baseUrl: '',
            model: 'gpt-4'
        });
        createOpenAI.mockReturnValue((model) => `openai-${model}`);
        quickRoute.mockReturnValue(null);
        routeToSkill.mockResolvedValue({ skill: null, confidence: 0.1, reasoning: 'fallback' });
    });

    it('surfaces API error from fullStream error part instead of NoOutput wrapper', async () => {
        const apiError = new Error('This token is not enabled (tid: 2026020712001069300011984354875)');
        apiError.name = 'AI_APICallError';

        executeGeneralChat.mockResolvedValue({
            fullStream: (async function* () {
                yield { type: 'error', error: apiError };
            })(),
            usage: Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
        });

        const onError = vi.fn();
        const onChunk = vi.fn();

        await runSmartChat('项目整体进度如何？', [], { onError, onChunk });

        expect(onChunk).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledWith(apiError);
        expect(setAiStatus).toHaveBeenLastCalledWith('error');
    });
});
