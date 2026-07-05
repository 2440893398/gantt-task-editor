import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCommandsForTest, getCommands } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { resetProjectRev, getProjectRev } from '../../../src/features/gantt/domain/rev.js';
import { registerLinkCommands } from '../../../src/features/agent-cli/commands/link.js';
import { registerStateCommands } from '../../../src/features/agent-cli/commands/state.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';

const projectId = 'agent-read-test';

const tasks = [
    {
        id: 1,
        text: 'Active today',
        start_date: new Date('2026-06-30T00:00:00Z'),
        end_date: new Date('2026-07-02T00:00:00Z'),
        progress: 0.25,
        status: 'in_progress',
        priority: 'high',
        assignee: 'Ada',
        parent: 0,
    },
    {
        id: 2,
        text: 'Overdue task',
        start_date: new Date('2026-06-01T00:00:00Z'),
        end_date: new Date('2026-06-10T00:00:00Z'),
        progress: 0.5,
        status: 'todo',
        priority: 'medium',
        assignee: 'Grace',
        parent: 0,
    },
    {
        id: 3,
        text: 'Done task',
        start_date: new Date('2026-06-01T00:00:00Z'),
        end_date: new Date('2026-06-10T00:00:00Z'),
        progress: 1,
        status: 'done',
        priority: 'low',
        assignee: 'Ada',
        parent: 1,
    },
];

const dateOnlyTasks = [
    {
        id: 20,
        text: 'Date-only today',
        start_date: '2026-06-30',
        end_date: '2026-06-30',
        progress: 0,
        status: 'todo',
        parent: 0,
    },
    {
        id: 21,
        text: 'Date-only overdue',
        start_date: '2026-06-28',
        end_date: '2026-06-29',
        progress: 0.5,
        status: 'todo',
        parent: 0,
    },
    {
        id: 22,
        text: 'Date-only future',
        start_date: '2026-07-01',
        end_date: '2026-07-01',
        progress: 0,
        status: 'todo',
        parent: 0,
    },
];

const links = [
    { id: 10, source: 1, target: 2, type: '0' },
    { id: 11, source: 3, target: 2, type: '0' },
];

function createAdapter() {
    return {
        getTask(id) {
            const normalizedId = Number(id);
            const task = tasks.find((item) => item.id === normalizedId);

            if (!task) {
                throw new Error('Task not found');
            }

            return { ...task };
        },
        getTasks() {
            return tasks.map((task) => ({ ...task }));
        },
        getLinks() {
            return links.map((link) => ({ ...link }));
        },
        serialize() {
            return {
                data: tasks.map((task) => ({ ...task })),
                links: links.map((link) => ({ ...link })),
            };
        },
    };
}

function createDateOnlyAdapter() {
    return {
        getTask(id) {
            return dateOnlyTasks.find((task) => task.id === Number(id));
        },
        getTasks() {
            return dateOnlyTasks.map((task) => ({ ...task }));
        },
        getLinks() {
            return [];
        },
        serialize() {
            return { data: dateOnlyTasks.map((task) => ({ ...task })), links: [] };
        },
    };
}

describe('read-only agent commands', () => {
    let app;

    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        registerStateCommands();
        registerTaskCommands();
        registerLinkCommands();
        app = buildApi({
            context: {
                adapter: createAdapter(),
                projectId,
                today: new Date('2026-06-30T12:00:00Z'),
            },
        });
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
    });

    it('registers read-only commands as non-mutating', () => {
        expect(getCommands().map((command) => [command.name, command.mutating])).toEqual([
            ['link.add', true],
            ['link.list', false],
            ['link.remove', true],
            ['state.export', false],
            ['state.rev', false],
            ['state.snapshot', false],
            ['task.create', true],
            ['task.delete', true],
            ['task.get', false],
            ['task.list', false],
            ['task.overdue', false],
            ['task.today', false],
            ['task.update', true],
        ]);
    });

    it('returns rev and snapshots without bumping project rev', async () => {
        const before = getProjectRev(projectId);

        await expect(app.state.rev()).resolves.toEqual({
            ok: true,
            data: { rev: before },
            rev: before,
        });

        await expect(app.state.snapshot({ level: 'summary' })).resolves.toEqual({
            ok: true,
            data: {
                rev: before,
                taskCount: 3,
                linkCount: 2,
            },
            rev: before,
        });

        expect(getProjectRev(projectId)).toBe(before);
    });

    it('gets, lists, and filters tasks without bumping project rev', async () => {
        const before = getProjectRev(projectId);

        await expect(app.task.get({ id: 1 })).resolves.toMatchObject({
            ok: true,
            data: { id: 1, text: 'Active today' },
            rev: before,
        });

        await expect(
            app.task.list({ assignee: 'Ada', fields: ['id', 'text'], limit: 10 })
        ).resolves.toEqual({
            ok: true,
            data: [
                { id: 1, text: 'Active today' },
                { id: 3, text: 'Done task' },
            ],
            rev: before,
        });

        await expect(app.task.today()).resolves.toMatchObject({
            ok: true,
            data: [{ id: 1, text: 'Active today' }],
            rev: before,
        });

        await expect(app.task.overdue()).resolves.toMatchObject({
            ok: true,
            data: [{ id: 2, text: 'Overdue task' }],
            rev: before,
        });

        expect(getProjectRev(projectId)).toBe(before);
    });

    it('returns NOT_FOUND for missing task without bumping project rev', async () => {
        const before = getProjectRev(projectId);

        await expect(app.task.get({ id: 999 })).resolves.toEqual({
            ok: false,
            error: {
                code: 'NOT_FOUND',
                message: 'Task not found: 999',
            },
            rev: before,
        });

        expect(getProjectRev(projectId)).toBe(before);
    });

    it('returns NOT_FOUND when the adapter returns no task data', async () => {
        const emptyAdapterApp = buildApi({
            context: {
                adapter: {
                    getTask: () => undefined,
                    getTasks: () => [],
                    getLinks: () => [],
                    serialize: () => ({ data: [], links: [] }),
                },
                projectId,
            },
        });
        const before = getProjectRev(projectId);

        await expect(emptyAdapterApp.task.get({ id: 999 })).resolves.toEqual({
            ok: false,
            error: {
                code: 'NOT_FOUND',
                message: 'Task not found: 999',
            },
            rev: before,
        });

        expect(getProjectRev(projectId)).toBe(before);
    });

    it('lists links and filters by task id without bumping project rev', async () => {
        const before = getProjectRev(projectId);

        await expect(app.link.list({ taskId: 1 })).resolves.toEqual({
            ok: true,
            data: [{ id: 10, source: 1, target: 2, type: 'fs' }],
            rev: before,
        });

        await expect(app.link.list()).resolves.toEqual({
            ok: true,
            data: [
                { id: 10, source: 1, target: 2, type: 'fs' },
                { id: 11, source: 3, target: 2, type: 'fs' },
            ],
            rev: before,
        });

        expect(getProjectRev(projectId)).toBe(before);
    });

    it('handles date-only strings as local dates for dateRange filters', async () => {
        const dateOnlyApp = buildApi({
            context: {
                adapter: createDateOnlyAdapter(),
                projectId,
                today: new Date(2026, 5, 30, 12),
            },
        });

        await expect(
            dateOnlyApp.task.list({
                dateRange: { start: '2026-06-30', end: '2026-06-30' },
                fields: ['id', 'text'],
            })
        ).resolves.toMatchObject({
            ok: true,
            data: [{ id: 20, text: 'Date-only today' }],
        });
    });

    it('rejects invalid date-only strings in dateRange filters', async () => {
        const dateOnlyApp = buildApi({
            context: {
                adapter: createDateOnlyAdapter(),
                projectId,
                today: '2026-06-30',
            },
        });

        await expect(
            dateOnlyApp.task.list({
                dateRange: { start: '2026-02-31', end: '2026-03-01' },
            })
        ).resolves.toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Invalid date for dateRange.start: 2026-02-31',
                hint: 'Use YYYY-MM-DD or a valid date value.',
            },
            rev: 0,
        });
    });

    it('handles date-only strings as local dates for today and overdue commands', async () => {
        const dateOnlyApp = buildApi({
            context: {
                adapter: createDateOnlyAdapter(),
                projectId,
                today: '2026-06-30',
            },
        });

        await expect(dateOnlyApp.task.today()).resolves.toMatchObject({
            ok: true,
            data: [{ id: 20, text: 'Date-only today' }],
        });

        await expect(dateOnlyApp.task.overdue()).resolves.toMatchObject({
            ok: true,
            data: [{ id: 21, text: 'Date-only overdue' }],
        });
    });
});
