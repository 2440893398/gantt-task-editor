import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { analysisTools } from '../../../../src/features/ai/tools/analysisTools.js';

// Mock gantt globally
let mockTasks = [];
let mockLinks = [];

function setupGantt(tasks = [], links = []) {
    mockTasks = tasks;
    mockLinks = links;
    globalThis.gantt = {
        eachTask: (fn) => mockTasks.forEach(fn),
        getTask: (id) => mockTasks.find(t => t.id === id) || null,
        getParent: (id) => {
            const t = mockTasks.find(t => t.id === id);
            return t?._parent || null;
        },
        getChildren: (id) => mockTasks.filter(t => t._parent === id).map(t => t.id),
        getLinks: () => mockLinks,
        getLink: (id) => mockLinks.find(l => l.id === id) || null,
        config: {
            columns: [
                { name: 'text', label: '任务名称', width: 200 },
                { name: 'start_date', label: '开始日期', width: 120 },
                { name: 'duration', label: '工期', width: 80 },
                { name: 'priority', label: '优先级', width: 80 }
            ]
        },
        serverList: (name) => {
            if (name === 'priority') return [
                { key: 'high', label: '高' },
                { key: 'medium', label: '中' },
                { key: 'low', label: '低' }
            ];
            return [];
        }
    };
}

function teardownGantt() {
    delete globalThis.gantt;
    mockTasks = [];
    mockLinks = [];
}

describe('analysisTools', () => {
    afterEach(() => teardownGantt());

    it('exports all 13 tools', () => {
        const toolNames = Object.keys(analysisTools);
        expect(toolNames).toContain('get_task_dependencies');
        expect(toolNames).toContain('get_critical_path');
        expect(toolNames).toContain('get_resource_workload');
        expect(toolNames).toContain('get_tasks_by_assignee');
        expect(toolNames).toContain('get_resource_conflicts');
        expect(toolNames).toContain('get_tasks_in_range');
        expect(toolNames).toContain('get_upcoming_deadlines');
        expect(toolNames).toContain('get_baseline_deviation');
        expect(toolNames).toContain('get_task_detail');
        expect(toolNames).toContain('get_subtasks');
        expect(toolNames).toContain('get_field_config');
        expect(toolNames).toContain('get_custom_fields');
        expect(toolNames).toContain('get_field_statistics');
        expect(toolNames).toHaveLength(13);
    });

    describe('get_task_dependencies', () => {
        it('returns dependencies for a task', async () => {
            setupGantt(
                [
                    { id: 1, text: 'Task A' },
                    { id: 2, text: 'Task B' },
                    { id: 3, text: 'Task C' }
                ],
                [
                    { id: 'l1', source: 1, target: 2, type: '0' },
                    { id: 'l2', source: 2, target: 3, type: '0' }
                ]
            );
            const result = await analysisTools.get_task_dependencies.execute({ task_id: 2 });
            expect(result.predecessors).toBeDefined();
            expect(result.successors).toBeDefined();
        });

        it('returns error when gantt not initialized', async () => {
            const result = await analysisTools.get_task_dependencies.execute({ task_id: 1 });
            expect(result.error).toBeTruthy();
        });
    });

    describe('get_critical_path', () => {
        it('returns critical path tasks', async () => {
            setupGantt([
                { id: 1, text: 'Task A', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-05'), duration: 4, progress: 0 },
                { id: 2, text: 'Task B', start_date: new Date('2026-01-05'), end_date: new Date('2026-01-10'), duration: 5, progress: 0 }
            ], [
                { id: 'l1', source: 1, target: 2, type: '0' }
            ]);
            const result = await analysisTools.get_critical_path.execute();
            expect(result.critical_path).toBeDefined();
            expect(Array.isArray(result.critical_path)).toBe(true);
        });
    });

    describe('get_resource_workload', () => {
        it('returns workload per assignee', async () => {
            setupGantt([
                { id: 1, text: 'Task A', assignee: 'Alice', duration: 3 },
                { id: 2, text: 'Task B', assignee: 'Alice', duration: 5 },
                { id: 3, text: 'Task C', assignee: 'Bob', duration: 2 }
            ]);
            const result = await analysisTools.get_resource_workload.execute();
            expect(result.workload).toBeDefined();
            expect(result.workload['Alice']).toBeDefined();
            expect(result.workload['Alice'].task_count).toBe(2);
            expect(result.workload['Bob'].task_count).toBe(1);
        });
    });

    describe('get_tasks_by_assignee', () => {
        it('returns tasks for a specific assignee', async () => {
            setupGantt([
                { id: 1, text: 'Task A', assignee: 'Alice' },
                { id: 2, text: 'Task B', assignee: 'Bob' },
                { id: 3, text: 'Task C', assignee: 'Alice' }
            ]);
            const result = await analysisTools.get_tasks_by_assignee.execute({ assignee: 'Alice' });
            expect(result.tasks).toHaveLength(2);
            expect(result.count).toBe(2);
        });
    });

    describe('get_resource_conflicts', () => {
        it('detects overlapping tasks for same assignee', async () => {
            setupGantt([
                { id: 1, text: 'Task A', assignee: 'Alice', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-10') },
                { id: 2, text: 'Task B', assignee: 'Alice', start_date: new Date('2026-01-05'), end_date: new Date('2026-01-15') },
                { id: 3, text: 'Task C', assignee: 'Bob', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-05') }
            ]);
            const result = await analysisTools.get_resource_conflicts.execute();
            expect(result.conflicts).toBeDefined();
            expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('get_tasks_in_range', () => {
        it('returns tasks within date range', async () => {
            setupGantt([
                { id: 1, text: 'Task A', start_date: new Date('2026-01-01'), end_date: new Date('2026-01-05') },
                { id: 2, text: 'Task B', start_date: new Date('2026-02-01'), end_date: new Date('2026-02-10') },
                { id: 3, text: 'Task C', start_date: new Date('2026-01-03'), end_date: new Date('2026-01-08') }
            ]);
            const result = await analysisTools.get_tasks_in_range.execute({
                start: '2026-01-01',
                end: '2026-01-10'
            });
            expect(result.tasks).toHaveLength(2);
            expect(result.tasks.map(t => t.id)).toContain(1);
            expect(result.tasks.map(t => t.id)).toContain(3);
        });
    });

    describe('get_upcoming_deadlines', () => {
        it('returns tasks with upcoming deadlines', async () => {
            const today = new Date();
            const soon = new Date(today);
            soon.setDate(soon.getDate() + 3);
            const far = new Date(today);
            far.setDate(far.getDate() + 30);

            setupGantt([
                { id: 1, text: 'Task A', end_date: soon, progress: 0 },
                { id: 2, text: 'Task B', end_date: far, progress: 0 },
                { id: 3, text: 'Task C', end_date: soon, progress: 1 } // completed
            ]);
            const result = await analysisTools.get_upcoming_deadlines.execute({ days: 7 });
            expect(result.tasks).toHaveLength(1); // Only Task A
            expect(result.tasks[0].id).toBe(1);
        });
    });

    describe('get_baseline_deviation', () => {
        it('returns deviation info', async () => {
            setupGantt([
                { id: 1, text: 'Task A', end_date: new Date('2026-01-10'), planned_end: new Date('2026-01-08'), progress: 0.5 },
                { id: 2, text: 'Task B', end_date: new Date('2026-01-15'), planned_end: new Date('2026-01-15'), progress: 0 }
            ]);
            const result = await analysisTools.get_baseline_deviation.execute();
            expect(result.deviations).toBeDefined();
            expect(Array.isArray(result.deviations)).toBe(true);
        });
    });

    describe('get_task_detail', () => {
        it('returns detailed info for a task', async () => {
            setupGantt([
                { id: 1, text: 'Task A', priority: 'high', status: 'in_progress', progress: 0.5, start_date: new Date('2026-01-01'), end_date: new Date('2026-01-10'), assignee: 'Alice' }
            ]);
            const result = await analysisTools.get_task_detail.execute({ task_id: 1 });
            expect(result.task).toBeDefined();
            expect(result.task.text).toBe('Task A');
            expect(result.task.assignee).toBe('Alice');
        });

        it('returns error for nonexistent task', async () => {
            setupGantt([]);
            const result = await analysisTools.get_task_detail.execute({ task_id: 999 });
            expect(result.error).toBeTruthy();
        });
    });

    describe('get_subtasks', () => {
        it('returns child tasks', async () => {
            setupGantt([
                { id: 1, text: 'Parent' },
                { id: 2, text: 'Child A', _parent: 1 },
                { id: 3, text: 'Child B', _parent: 1 },
                { id: 4, text: 'Other' }
            ]);
            const result = await analysisTools.get_subtasks.execute({ task_id: 1 });
            expect(result.subtasks).toHaveLength(2);
        });
    });

    describe('get_field_config', () => {
        it('returns column configuration', async () => {
            setupGantt([]);
            const result = await analysisTools.get_field_config.execute();
            expect(result.columns).toBeDefined();
            expect(result.columns.length).toBeGreaterThanOrEqual(1);
        });

        it('returns field management configuration from current system state', async () => {
            setupGantt([]);
            const result = await analysisTools.get_field_config.execute();

            expect(result.field_management).toBeDefined();
            expect(Array.isArray(result.field_management.system_fields)).toBe(true);
            expect(Array.isArray(result.field_management.custom_fields)).toBe(true);
            expect(Array.isArray(result.field_management.field_order)).toBe(true);
            expect(result.field_management.system_fields.length).toBeGreaterThan(0);
        });
    });

    describe('get_custom_fields', () => {
        it('returns custom field values for a task', async () => {
            setupGantt([
                { id: 1, text: 'Task A', custom_field_1: 'val1', custom_field_2: 42, priority: 'high', status: 'pending', progress: 0 }
            ]);
            const result = await analysisTools.get_custom_fields.execute({ task_id: 1 });
            expect(result.fields).toBeDefined();
        });
    });

    describe('get_field_statistics', () => {
        it('returns statistics for a field', async () => {
            setupGantt([
                { id: 1, text: 'A', priority: 'high' },
                { id: 2, text: 'B', priority: 'high' },
                { id: 3, text: 'C', priority: 'low' }
            ]);
            const result = await analysisTools.get_field_statistics.execute({ field: 'priority' });
            expect(result.statistics).toBeDefined();
            expect(result.statistics['high']).toBe(2);
            expect(result.statistics['low']).toBe(1);
        });
    });
});
