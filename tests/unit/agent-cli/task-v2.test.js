import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, getCommand } from '../../../src/features/agent-cli/registry.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';

const formState = {
    fieldOrder: ['text', 'assignee', 'risk_level', 'start_date', 'end_date', 'duration', 'status'],
    customFields: [
        { name: 'assignee', label: '负责人', type: 'text', required: true },
        { name: 'risk_level', label: '风险', type: 'select', options: ['high', 'low'] },
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
});
