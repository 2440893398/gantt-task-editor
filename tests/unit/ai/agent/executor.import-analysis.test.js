import { beforeEach, describe, expect, it, vi } from 'vitest';

const { streamTextMock } = vi.hoisted(() => ({
    streamTextMock: vi.fn(() => ({
        fullStream: (async function* () {})(),
        usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 })
    }))
}));

vi.mock('ai', () => ({
    streamText: streamTextMock,
    stepCountIs: vi.fn(() => 5)
}));

vi.mock('../../../../src/features/ai/skills/registry.js', () => ({
    loadSkill: vi.fn(async (skillId) => ({
        name: skillId,
        allowedTools: [],
        content: '# skill'
    }))
}));

vi.mock('../../../../src/features/ai/tools/registry.js', () => ({
    getToolsForSkill: vi.fn(() => ({}))
}));

import { executeSkill, executeGeneralChat } from '../../../../src/features/ai/agent/executor.js';

describe('executor import-analysis guidance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('injects import guidance and schema for import-analysis skill', async () => {
        await executeSkill('import-analysis', [{ role: 'user', content: 'please parse attachment' }], { modelId: 'mock' });

        expect(streamTextMock).toHaveBeenCalledTimes(1);
        const args = streamTextMock.mock.calls[0][0];
        expect(args.system).toContain('Attachment Import Guidance');
        expect(args.system).toContain('DIFF_JSON_SCHEMA');
        expect(args.system).toContain('task_diff');
    });

    it('injects import hint in general chat when attachment context exists', async () => {
        await executeGeneralChat(
            [{ role: 'user', content: '[Attachment Context]\nexcel rows...' }],
            { modelId: 'mock' }
        );

        expect(streamTextMock).toHaveBeenCalledTimes(1);
        const args = streamTextMock.mock.calls[0][0];
        expect(args.system).toContain('Attachment detected');
        expect(args.system).toContain('structured task diff JSON');
    });
});
