import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quickRoute, routeToSkill, routeWithCache } from '../../../../src/features/ai/agent/router.js';
import { generateObject } from 'ai';
import { getSkillDescriptions } from '../../../../src/features/ai/skills/registry.js';

vi.mock('ai', () => ({
    generateObject: vi.fn(),
    tool: vi.fn((def) => def)
}));

vi.mock('../../../../src/features/ai/skills/registry.js', () => ({
    getSkillDescriptions: vi.fn(() => [
        { name: 'task-query', description: '查询任务数据', allowedTools: [] },
        { name: 'progress-analysis', description: '分析项目进度', allowedTools: [] }
    ])
}));

describe('AI Router', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ---------------------------------------------------------------
    // quickRoute
    // ---------------------------------------------------------------
    describe('quickRoute', () => {
        describe('task-query keyword patterns', () => {
            const taskQueryInputs = [
                '今天的任务有哪些',
                '有逾期的吗',
                '哪些任务需要处理',
                '任务当前状态',
                '待办理事项',
                '未完成的工作',
                '高优先级的任务',
                '按优先级排列'
            ];

            it.each(taskQueryInputs)(
                'returns task-query for message: "%s"',
                (message) => {
                    const result = quickRoute(message);
                    expect(result).not.toBeNull();
                    expect(result.skill).toBe('task-query');
                    expect(result.method).toBe('keyword');
                }
            );
        });

        describe('progress-analysis keyword patterns', () => {
            const progressInputs = [
                '项目进度如何',
                '当前完成率是多少',
                '项目整体情况',
                '项目概况总结',
                '有什么风险',
                '总体进展如何'
            ];

            it.each(progressInputs)(
                'returns progress-analysis for message: "%s"',
                (message) => {
                    const result = quickRoute(message);
                    expect(result).not.toBeNull();
                    expect(result.skill).toBe('progress-analysis');
                    expect(result.method).toBe('keyword');
                }
            );
        });

        describe('unmatched messages', () => {
            const unmatchedInputs = [
                'hello',
                '你好',
                'random text'
            ];

            it.each(unmatchedInputs)(
                'returns null for unmatched message: "%s"',
                (message) => {
                    const result = quickRoute(message);
                    expect(result).toBeNull();
                }
            );
        });

        it('returns correct structure with skill and method keyword', () => {
            const result = quickRoute('今天的任务');
            expect(result).toEqual({
                skill: 'task-query',
                method: 'keyword'
            });
        });
    });

    // ---------------------------------------------------------------
    // routeToSkill
    // ---------------------------------------------------------------
    describe('routeToSkill', () => {
        const mockOpenai = vi.fn((model) => `openai-${model}`);
        const mockModel = 'gpt-4';

        it('calls generateObject with correct parameters', async () => {
            generateObject.mockResolvedValueOnce({
                object: { skill: 'task-query', confidence: 0.95, reasoning: '用户在查询任务' }
            });

            await routeToSkill('今天有什么任务', mockOpenai, mockModel);

            expect(generateObject).toHaveBeenCalledTimes(1);
            const callArgs = generateObject.mock.calls[0][0];
            expect(callArgs).toHaveProperty('model', 'openai-gpt-4');
            expect(callArgs).toHaveProperty('schema');
            expect(callArgs).toHaveProperty('system');
            expect(callArgs).toHaveProperty('prompt', '今天有什么任务');
            expect(callArgs.system).toContain('task-query');
            expect(callArgs.system).toContain('progress-analysis');
            expect(getSkillDescriptions).toHaveBeenCalled();
        });

        it('returns the object from generateObject result', async () => {
            const expectedObject = { skill: 'progress-analysis', confidence: 0.88, reasoning: '用户在询问进度' };
            generateObject.mockResolvedValueOnce({ object: expectedObject });

            const result = await routeToSkill('项目进展如何', mockOpenai, mockModel);

            expect(result).toEqual(expectedObject);
        });
    });

    // ---------------------------------------------------------------
    // routeWithCache
    // ---------------------------------------------------------------
    describe('routeWithCache', () => {
        const mockOpenai = vi.fn((model) => `openai-${model}`);
        const mockModel = 'gpt-4';

        it('uses keyword match first and does not call AI', async () => {
            const result = await routeWithCache('今天的任务有哪些', mockOpenai, mockModel);

            expect(result).toEqual({
                skill: 'task-query',
                confidence: 0.9,
                method: 'keyword'
            });
            expect(generateObject).not.toHaveBeenCalled();
        });

        it('falls back to AI when no keyword match', async () => {
            const aiResult = { skill: 'task-query', confidence: 0.85, reasoning: 'AI判断' };
            generateObject.mockResolvedValueOnce({ object: aiResult });

            const result = await routeWithCache('帮我看看有什么要做的', mockOpenai, mockModel);

            expect(generateObject).toHaveBeenCalledTimes(1);
            expect(result).toEqual({
                ...aiResult,
                method: 'ai'
            });
        });

        it('returns method fallback when AI fails', async () => {
            generateObject.mockRejectedValueOnce(new Error('API Error'));

            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await routeWithCache('一个完全不匹配的句子xyz', mockOpenai, mockModel);

            expect(result).toEqual({
                skill: null,
                confidence: 0,
                method: 'fallback'
            });

            warnSpy.mockRestore();
        });
    });
});
