import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildHierarchyMap, attachHierarchyIds } from '../../../../src/features/ai/utils/hierarchy-id.js';
import { generateToolSummary, getToolDisplayNameExtended } from '../../../../src/features/ai/tools/hierarchy.js';

describe('hierarchy-id utility', () => {
    it('builds hierarchy map from flat root tasks', () => {
        const tasks = [
            { id: 1 },
            { id: 2 },
            { id: 3 }
        ];

        const eachTask = (fn) => tasks.forEach(fn);
        const getParent = () => null; // all root tasks
        const getChildren = () => [];

        const map = buildHierarchyMap(eachTask, getParent, getChildren);

        expect(map.get(1)).toBe('#1');
        expect(map.get(2)).toBe('#2');
        expect(map.get(3)).toBe('#3');
    });

    it('builds hierarchy map with nested tasks', () => {
        const tasks = [
            { id: 1 },
            { id: 2 },
            { id: 3 },  // child of 1
            { id: 4 },  // child of 1
            { id: 5 }   // child of 2
        ];

        const parentMap = { 3: 1, 4: 1, 5: 2 };
        const eachTask = (fn) => tasks.forEach(fn);
        const getParent = (id) => parentMap[id] || null;
        const getChildren = () => [];

        const map = buildHierarchyMap(eachTask, getParent, getChildren);

        expect(map.get(1)).toBe('#1');
        expect(map.get(2)).toBe('#2');
        expect(map.get(3)).toBe('#1.1');
        expect(map.get(4)).toBe('#1.2');
        expect(map.get(5)).toBe('#2.1');
    });
});

describe('hierarchy.js tool helpers', () => {
    describe('generateToolSummary', () => {
        it('generates summary for task list results', () => {
            const result = {
                tasks: [
                    { id: 1, text: 'Task A' },
                    { id: 2, text: 'Task B' }
                ],
                count: 2
            };
            const summary = generateToolSummary('get_today_tasks', result);
            expect(summary).toContain('2');
        });

        it('generates summary for progress summary results', () => {
            const result = {
                total_tasks: 10,
                completed: 5,
                average_progress: 60
            };
            const summary = generateToolSummary('get_progress_summary', result);
            expect(summary).toContain('10');
            expect(summary).toContain('60');
        });

        it('generates fallback summary for unknown tools', () => {
            const result = { foo: 'bar' };
            const summary = generateToolSummary('unknown_tool', result);
            expect(typeof summary).toBe('string');
            expect(summary.length).toBeGreaterThan(0);
        });

        it('handles empty result gracefully', () => {
            const summary = generateToolSummary('get_today_tasks', { tasks: [], count: 0 });
            expect(summary).toContain('0');
        });
    });

    describe('getToolDisplayNameExtended', () => {
        it('returns display names for all known tools', () => {
            const knownTools = [
                'get_today_tasks',
                'get_overdue_tasks',
                'get_tasks_by_status',
                'get_tasks_by_priority',
                'get_progress_summary'
            ];

            for (const tool of knownTools) {
                const name = getToolDisplayNameExtended(tool);
                expect(name).toBeTruthy();
                expect(name).not.toBe(tool); // should not just echo back the raw name
            }
        });

        it('returns raw name for unknown tools', () => {
            expect(getToolDisplayNameExtended('some_custom_tool')).toBe('some_custom_tool');
        });
    });
});
