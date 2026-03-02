import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/core/store.js', () => ({
    getAiConfigState: vi.fn(() => ({
        apiKey: 'k',
        baseUrl: '',
        model: 'gpt-4'
    })),
    setAiStatus: vi.fn()
}));

const providerMock = vi.fn(() => ({ modelId: 'mock-model' }));

vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: vi.fn(() => providerMock)
}));

vi.mock('../../../../src/features/ai/agent/router.js', () => ({
    quickRoute: vi.fn(() => null),
    routeToSkill: vi.fn(async () => ({ skill: null, confidence: 0, reasoning: '' }))
}));

const streamResult = {
    fullStream: (async function* () {
        yield { type: 'finish', finishReason: 'stop' };
    })(),
    usage: Promise.resolve({ promptTokens: 1, completionTokens: 1 })
};

vi.mock('../../../../src/features/ai/agent/executor.js', () => ({
    executeSkill: vi.fn(async () => streamResult),
    executeGeneralChat: vi.fn(async () => streamResult)
}));

import { runSmartChat } from '../../../../src/features/ai/api/client.js';
import { executeSkill, executeGeneralChat } from '../../../../src/features/ai/agent/executor.js';
import { routeToSkill } from '../../../../src/features/ai/agent/router.js';

describe('runSmartChat import-analysis routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forces import-analysis skill when attachment context exists', async () => {
        await runSmartChat('[Attachment Context]\nexcel parsed rows\n\n[User Question]\n请导入', [], {});

        expect(executeSkill).toHaveBeenCalledTimes(1);
        expect(executeSkill.mock.calls[0][0]).toBe('import-analysis');
        expect(routeToSkill).not.toHaveBeenCalled();
        expect(executeGeneralChat).not.toHaveBeenCalled();
    });
});
