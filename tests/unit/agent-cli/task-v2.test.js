import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, getCommand } from '../../../src/features/agent-cli/registry.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';

const formState = {
    fieldOrder: [
        'text',
        'assignee',
        'risk_level',
        'review_at',
        'start_date',
        'end_date',
        'duration',
        'status',
    ],
    customFields: [
        { name: 'assignee', label: '负责人', type: 'text', required: true },
        { name: 'risk_level', label: '风险', type: 'select', options: ['high', 'low'] },
        { name: 'review_at', label: 'Review at', type: 'datetime' },
    ],
    systemFieldSettings: { enabled: {}, typeOverrides: {} },
};

function createGantt(tasks = []) {
    const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));
    return {
        addTask: vi.fn((task, parent) => {
            const id = Math.max(0, ...taskMap.keys()) + 1;
            taskMap.set(id, { ...task, id, parent });
            return id;
        }),
        getTask: (id) => taskMap.get(id),
        getChildren: () => [],
        updateTask: vi.fn(),
        calculateDuration: (start, end) => Math.round((end - start) / 86400000),
    };
}

const undoManager = {
    saveAddState: vi.fn(),
    saveState: vi.fn(),
};

describe('agent task v2 contract', () => {
    beforeEach(() => {
        clearCommandsForTest();
        registerTaskCommands();
    });

    afterEach(() => clearCommandsForTest());

    it('creates from values with dynamic fields and inclusive end_date', () => {
        const gantt = createGantt();
        const command = getCommand('task.create');
        const plan = command.op.plan(
            {
                parent: 0,
                values: {
                    text: '接口联调',
                    assignee: '张三',
                    risk_level: 'high',
                    start_date: '2026-07-13',
                    end_date: '2026-07-17',
                },
            },
            { gantt, formState }
        );

        expect(plan.task).toMatchObject({
            text: '接口联调',
            assignee: '张三',
            risk_level: 'high',
            duration: 5,
        });
        expect(plan.task.end_date).toEqual(new Date(2026, 6, 18));

        const result = command.op.commit(plan, { gantt, undoManager });
        expect(result.task.risk_level).toBe('high');
    });

    it('supplies a valid one-day schedule when create values omit dates', () => {
        const command = getCommand('task.create');
        const plan = command.op.plan(
            { values: { text: 'Unscheduled input', assignee: 'Ada' } },
            { gantt: createGantt(), formState, today: new Date(2026, 6, 13) }
        );

        expect(plan.task).toMatchObject({
            text: 'Unscheduled input',
            start_date: new Date(2026, 6, 13),
            duration: 1,
        });
    });

    it.each([
        ['start only', { start_date: '2026-07-13' }, new Date(2026, 6, 13), 1],
        ['end only', { end_date: '2026-07-17' }, new Date(2026, 6, 17), 1],
        ['duration only', { duration: 3 }, new Date(2026, 6, 13), 3],
    ])('creates a coherent schedule from %s values', (label, schedule, start, duration) => {
        const command = getCommand('task.create');
        const plan = command.op.plan(
            { values: { text: label, assignee: 'Ada', ...schedule } },
            { gantt: createGantt(), formState, today: new Date(2026, 6, 13) }
        );

        expect(plan.task.start_date).toEqual(start);
        expect(plan.task.duration).toBe(duration);
    });

    it('accepts and preserves ISO datetime custom field writes', () => {
        const command = getCommand('task.create');
        const plan = command.op.plan(
            {
                values: {
                    text: 'Timed review',
                    assignee: 'Ada',
                    review_at: '2026-07-15T12:30:00',
                },
            },
            { gantt: createGantt(), formState, today: new Date(2026, 6, 13) }
        );

        expect(plan.task.review_at).toBe('2026-07-15T12:30:00');
    });

    it('rejects invalid dynamic values before planning a write', () => {
        const command = getCommand('task.create');
        const result = command.op.plan(
            {
                values: {
                    text: '接口联调',
                    assignee: '张三',
                    risk_level: 'urgent',
                },
            },
            { gantt: createGantt(), formState }
        );

        expect(result).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'risk_level' },
        });
    });

    it('rejects inconsistent start, inclusive end, and duration values', () => {
        const command = getCommand('task.create');
        const result = command.op.plan(
            {
                values: {
                    text: 'Inconsistent schedule',
                    assignee: 'Ada',
                    start_date: '2026-07-13',
                    end_date: '2026-07-17',
                    duration: 2,
                },
            },
            { gantt: createGantt(), formState }
        );

        expect(result).toMatchObject({
            ok: false,
            error: {
                code: 'INVALID_FIELD_VALUE',
                field: 'duration',
            },
        });
    });

    it('filters and projects dynamic fields', () => {
        const command = getCommand('task.list');
        const result = command.handler(
            {
                filters: [{ field: 'risk_level', operator: 'eq', value: 'high' }],
                fields: ['id', 'text', 'risk_level'],
            },
            {
                formState,
                adapter: {
                    getTasks: () => [
                        { id: 1, text: 'A', risk_level: 'high' },
                        { id: 2, text: 'B', risk_level: 'low' },
                    ],
                },
            }
        );

        expect(result).toEqual([{ id: 1, text: 'A', risk_level: 'high' }]);
    });

    it('filters date fields with the advertised before operator', () => {
        const command = getCommand('task.list');
        const context = {
            formState,
            adapter: {
                getTasks: () => [
                    { id: 1, text: 'Earlier', start_date: new Date(2026, 6, 10) },
                    { id: 2, text: 'Boundary', start_date: new Date(2026, 6, 15) },
                    { id: 3, text: 'Later', start_date: new Date(2026, 6, 20) },
                ],
            },
        };

        const before = command.handler(
            { filters: [{ field: 'start_date', operator: 'before', value: '2026-07-15' }] },
            context
        );
        expect(before.map((task) => task.text)).toEqual(['Earlier']);
    });

    it('filters end_date against the inclusive public boundary', () => {
        const command = getCommand('task.list');
        const result = command.handler(
            {
                filters: [{ field: 'end_date', operator: 'before', value: '2026-07-18' }],
            },
            {
                formState,
                adapter: {
                    getTasks: () => [
                        { id: 1, text: 'Public 17th', end_date: new Date(2026, 6, 18) },
                        { id: 2, text: 'Public 18th', end_date: new Date(2026, 6, 19) },
                    ],
                },
            }
        );

        expect(result.map((task) => task.text)).toEqual(['Public 17th']);
    });

    it('filters datetime fields with the advertised after operator', () => {
        const command = getCommand('task.list');
        const context = {
            formState,
            adapter: {
                getTasks: () => [
                    { id: 1, text: 'Earlier', review_at: '2026-07-15T08:00:00Z' },
                    { id: 2, text: 'Boundary', review_at: '2026-07-15T12:00:00Z' },
                    { id: 3, text: 'Later', review_at: '2026-07-15T16:00:00Z' },
                ],
            },
        };

        const after = command.handler(
            {
                filters: [
                    {
                        field: 'review_at',
                        operator: 'after',
                        value: '2026-07-15T12:00:00Z',
                    },
                ],
            },
            context
        );

        expect(after.map((task) => task.text)).toEqual(['Later']);
    });

    it('rejects unknown query fields and unsupported operators', () => {
        const command = getCommand('task.list');
        const context = { formState, adapter: { getTasks: () => [] } };

        expect(
            command.handler(
                { filters: [{ field: 'missing_field', operator: 'eq', value: 'x' }] },
                context
            )
        ).toMatchObject({ ok: false, error: { code: 'INVALID_FIELD' } });
        expect(
            command.handler(
                { filters: [{ field: 'risk_level', operator: 'gt', value: 'high' }] },
                context
            )
        ).toMatchObject({
            ok: false,
            error: { code: 'INVALID_FIELD_VALUE', field: 'risk_level' },
        });
    });

    it('returns user-facing inclusive end_date values', () => {
        const command = getCommand('task.get');
        const result = command.handler(
            { id: 1 },
            {
                adapter: {
                    getTask: () => ({
                        id: 1,
                        text: 'A',
                        start_date: new Date(2026, 6, 13),
                        end_date: new Date(2026, 6, 18),
                    }),
                },
            }
        );

        expect(result).toMatchObject({
            start_date: '2026-07-13',
            end_date: '2026-07-17',
        });
    });

    it('projects selected fields from task.get', () => {
        const command = getCommand('task.get');
        const result = command.handler(
            { id: 1, fields: ['id', 'risk_level'] },
            {
                formState,
                adapter: {
                    getTask: () => ({ id: 1, text: 'A', risk_level: 'high' }),
                },
            }
        );

        expect(result).toEqual({ id: 1, risk_level: 'high' });
    });
});
