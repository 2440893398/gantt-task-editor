import { describe, expect, it } from 'vitest';
import { quickRoute } from '../../../../src/features/ai/agent/router.js';
import { getSkillDescriptions, loadSkill } from '../../../../src/features/ai/skills/registry.js';

describe('router skill expansion', () => {
    describe('keyword routing for new skills', () => {
        const cases = [
            // dependency-analysis
            { input: '分析任务依赖关系', expected: 'dependency-analysis' },
            { input: '关键路径是什么', expected: 'dependency-analysis' },
            { input: '依赖链', expected: 'dependency-analysis' },

            // resource-analysis
            { input: '谁的工作量最大', expected: 'resource-analysis' },
            { input: '资源冲突', expected: 'resource-analysis' },
            { input: 'Alice 的工作量如何', expected: 'resource-analysis' },

            // timeline-analysis
            { input: '下周有哪些截止日期', expected: 'timeline-analysis' },
            { input: '这个月的任务时间线', expected: 'timeline-analysis' },
            { input: '即将到期', expected: 'timeline-analysis' },
            { input: '基线偏差', expected: 'timeline-analysis' },

            // task-detail-query
            { input: '任务详情', expected: 'task-detail-query' },
            { input: '子任务列表', expected: 'task-detail-query' },

            // project-summary
            { input: '项目总结报告', expected: 'project-summary' },
            { input: '整体分析', expected: 'project-summary' },

            // field-info
            { input: '字段配置', expected: 'field-info' },
            { input: '自定义字段', expected: 'field-info' },
            { input: '字段统计', expected: 'field-info' }
        ];

        cases.forEach(({ input, expected }) => {
            it(`routes "${input}" to ${expected}`, () => {
                const result = quickRoute(input);
                expect(result).not.toBeNull();
                expect(result.skill).toBe(expected);
                expect(result.method).toBe('keyword');
            });
        });

        // Existing skills should still work
        it('still routes "今天有什么任务" to task-query', () => {
            const result = quickRoute('今天有什么任务');
            expect(result).not.toBeNull();
            expect(result.skill).toBe('task-query');
        });

        it('still routes "完成率" to progress-analysis', () => {
            const result = quickRoute('完成率');
            expect(result).not.toBeNull();
            expect(result.skill).toBe('progress-analysis');
        });

        it('returns null for unmatched input', () => {
            const result = quickRoute('你好世界');
            expect(result).toBeNull();
        });
    });

    describe('skill registry expansion', () => {
        it('has all 8 skills registered', () => {
            const skills = getSkillDescriptions();
            const names = skills.map(s => s.name);
            expect(names).toContain('task-query');
            expect(names).toContain('progress-analysis');
            expect(names).toContain('dependency-analysis');
            expect(names).toContain('resource-analysis');
            expect(names).toContain('timeline-analysis');
            expect(names).toContain('task-detail-query');
            expect(names).toContain('project-summary');
            expect(names).toContain('field-info');
            expect(skills).toHaveLength(8);
        });

        it('each new skill has allowedTools defined', () => {
            const skills = getSkillDescriptions();
            const newSkills = skills.filter(s =>
                ['dependency-analysis', 'resource-analysis', 'timeline-analysis',
                 'task-detail-query', 'project-summary', 'field-info'].includes(s.name)
            );
            newSkills.forEach(skill => {
                expect(skill.allowedTools).toBeDefined();
                expect(skill.allowedTools.length).toBeGreaterThan(0);
            });
        });

        it('can lazy-load each new skill', async () => {
            const newSkillNames = [
                'dependency-analysis', 'resource-analysis', 'timeline-analysis',
                'task-detail-query', 'project-summary', 'field-info'
            ];
            for (const name of newSkillNames) {
                const skill = await loadSkill(name);
                expect(skill).not.toBeNull();
                expect(skill.name).toBe(name);
                expect(skill.content).toBeTruthy();
            }
        });
    });
});
