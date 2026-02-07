import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the 'ai' module - tool() just returns the definition as-is
vi.mock('ai', () => ({
    tool: vi.fn((def) => def)
}));

import { allTools, getToolsForSkill } from '../../../../src/features/ai/tools/registry.js';

const EXPECTED_TOOL_NAMES = [
    'get_today_tasks',
    'get_tasks_by_status',
    'get_overdue_tasks',
    'get_tasks_by_priority',
    'get_progress_summary'
];

describe('AI Tools Registry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('allTools export', () => {
        it('should contain all 5 tool names', () => {
            const toolNames = Object.keys(allTools);
            expect(toolNames).toHaveLength(5);
            for (const name of EXPECTED_TOOL_NAMES) {
                expect(allTools).toHaveProperty(name);
            }
        });

        it('each tool should have description, parameters, and execute', () => {
            for (const name of EXPECTED_TOOL_NAMES) {
                const tool = allTools[name];
                expect(tool).toBeDefined();
                expect(tool).toHaveProperty('description');
                expect(typeof tool.description).toBe('string');
                expect(tool.description.length).toBeGreaterThan(0);
                expect(tool).toHaveProperty('parameters');
                expect(tool).toHaveProperty('execute');
                expect(typeof tool.execute).toBe('function');
            }
        });
    });

    describe('getToolsForSkill', () => {
        it('should return empty object for null', () => {
            const result = getToolsForSkill(null);
            expect(result).toEqual({});
        });

        it('should return empty object for undefined', () => {
            const result = getToolsForSkill(undefined);
            expect(result).toEqual({});
        });

        it('should return empty object for empty array', () => {
            const result = getToolsForSkill([]);
            expect(result).toEqual({});
        });

        it('should return matching tools for valid names', () => {
            const result = getToolsForSkill(EXPECTED_TOOL_NAMES);
            expect(Object.keys(result)).toHaveLength(5);
            for (const name of EXPECTED_TOOL_NAMES) {
                expect(result).toHaveProperty(name);
                expect(result[name]).toBe(allTools[name]);
            }
        });

        it('should ignore non-existent tool names', () => {
            const result = getToolsForSkill(['non_existent_tool', 'another_fake_tool']);
            expect(result).toEqual({});
        });

        it('should return correct subset of tools', () => {
            const subset = ['get_today_tasks', 'get_overdue_tasks'];
            const result = getToolsForSkill(subset);
            expect(Object.keys(result)).toHaveLength(2);
            expect(result).toHaveProperty('get_today_tasks');
            expect(result).toHaveProperty('get_overdue_tasks');
            expect(result.get_today_tasks).toBe(allTools.get_today_tasks);
            expect(result.get_overdue_tasks).toBe(allTools.get_overdue_tasks);
            expect(result).not.toHaveProperty('get_tasks_by_status');
            expect(result).not.toHaveProperty('get_tasks_by_priority');
            expect(result).not.toHaveProperty('get_progress_summary');
        });

        it('should include valid tools and skip non-existent ones in mixed input', () => {
            const mixed = ['get_today_tasks', 'non_existent', 'get_progress_summary'];
            const result = getToolsForSkill(mixed);
            expect(Object.keys(result)).toHaveLength(2);
            expect(result).toHaveProperty('get_today_tasks');
            expect(result).toHaveProperty('get_progress_summary');
            expect(result).not.toHaveProperty('non_existent');
        });
    });
});
