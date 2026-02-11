import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        content: '# mock skill content'
    }))
}));

vi.mock('../../../../src/features/ai/tools/registry.js', () => ({
    getToolsForSkill: vi.fn(() => ({}))
}));

import { executeSkill } from '../../../../src/features/ai/agent/executor.js';

describe('executeSkill markdown formatting rules', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('allows markdown formatting for non field-info skills', async () => {
        await executeSkill('task-query', [{ role: 'user', content: 'test' }], { modelId: 'mock-model' });

        expect(streamTextMock).toHaveBeenCalledTimes(1);
        const args = streamTextMock.mock.calls[0][0];
        expect(args.system).toContain('支持 Markdown 格式输出');
        expect(args.system).not.toContain('不使用 Markdown 表格');
    });
});
