import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { registerHierarchyCommands } from '../../../src/features/agent-cli/commands/hierarchy.js';
import { registerLinkCommands } from '../../../src/features/agent-cli/commands/link.js';
import { registerScheduleCommands } from '../../../src/features/agent-cli/commands/schedule.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

vi.mock('../../../src/features/gantt/scheduler.js', () => ({
    addWorkDays: vi.fn(async (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }),
    recalculateProjectSchedule: vi.fn(),
}));

const { runGanttTransaction } = await import('../../../src/features/gantt/domain/transaction.js');
const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');
const scheduler = await import('../../../src/features/gantt/scheduler.js');

const projectId = 'project-commands-test';

function createGantt({ tasks = [], links = [] } = {}) {
    const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));
    const linkMap = new Map(links.map((link) => [link.id, { ...link }]));

    function getSiblings(parent) {
        return [...taskMap.values()].filter((task) => String(task.parent ?? 0) === String(parent));
    }

    return {
        moveTask: vi.fn((id, index, parent) => {
            const task = taskMap.get(id);
            task.parent = parent;
            task.$index = index;
        }),
        addLink: vi.fn((link) => {
            const id = link.id ?? Math.max(0, ...linkMap.keys()) + 1;
            linkMap.set(id, { ...link, id });
            return id;
        }),
        deleteLink: vi.fn((id) => {
            linkMap.delete(id);
        }),
        getLinks: vi.fn(() => [...linkMap.values()].map((link) => ({ ...link }))),
        getTask: vi.fn((id) => {
            const task = taskMap.get(id);
            if (!task) {
                throw new Error('Task not found');
            }
            return task;
        }),
        getChildren: vi.fn((id) => getSiblings(id).map((task) => task.id)),
        getPrevSibling: vi.fn((id) => {
            const task = taskMap.get(id);
            const siblings = getSiblings(task.parent ?? 0);
            const index = siblings.findIndex((sibling) => sibling.id === id);
            return index > 0 ? siblings[index - 1].id : null;
        }),
        getNextSibling: vi.fn((id) => {
            const task = taskMap.get(id);
            const siblings = getSiblings(task.parent ?? 0);
            const index = siblings.findIndex((sibling) => sibling.id === id);
            return index >= 0 && index < siblings.length - 1 ? siblings[index + 1].id : null;
        }),
        updateTask: vi.fn(),
        serialize: vi.fn(() => ({
            data: [...taskMap.values()].map((task) => ({ ...task })),
            links: [...linkMap.values()].map((link) => ({ ...link })),
        })),
        getLinksSnapshot() {
            return [...linkMap.values()].map((link) => ({ ...link }));
        },
    };
}

function createApp(gantt) {
    registerHierarchyCommands();
    registerLinkCommands();
    registerScheduleCommands();

    return buildApi({
        context: {
            adapter: {
                gantt,
                getLinks: () => gantt.getLinks(),
                getTasks: () => [],
                serialize: () => gantt.serialize(),
            },
            gantt,
            projectId,
        },
    });
}

describe('agent project hierarchy, link, and schedule commands', () => {
    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        vi.clearAllMocks();
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
    });

    it('registers hierarchy and schedule write commands with dry-run support', async () => {
        const gantt = createGantt({
            tasks: [
                { id: 1, text: 'Parent', parent: 0 },
                { id: 2, text: 'Move me', parent: 0 },
            ],
        });
        const app = createApp(gantt);

        const result = await app.hierarchy.move({ id: 2, parent: 1, index: 0, dryRun: true });

        expect(result).toMatchObject({
            ok: true,
            data: {
                diff: {
                    updated: [
                        {
                            id: 2,
                            fields: {
                                parent: { old: 0, new: 1 },
                                index: { old: 1, new: 0 },
                            },
                        },
                    ],
                },
            },
            rev: 0,
        });
        expect(gantt.moveTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('commits link add/remove writes and keeps link.list read-only', async () => {
        const gantt = createGantt({
            links: [{ id: 5, source: 3, target: 4, type: '0' }],
        });
        const app = createApp(gantt);

        await expect(app.link.add({ source: 1, target: 2, type: 'ss' })).resolves.toMatchObject({
            ok: true,
            data: {
                diff: {
                    links: {
                        added: [{ source: 1, target: 2, type: 'ss' }],
                    },
                },
            },
            rev: 1,
        });
        expect(gantt.addLink).toHaveBeenCalledWith({ source: 1, target: 2, type: '1' });
        expect(settleAndPersist).toHaveBeenCalledTimes(1);

        await expect(app.link.list({ taskId: 1 })).resolves.toEqual({
            ok: true,
            data: [{ id: 6, source: 1, target: 2, type: 'ss' }],
            rev: 1,
        });
        expect(getProjectRev(projectId)).toBe(1);

        await expect(app.link.remove({ source: 1, target: 2 })).resolves.toMatchObject({
            ok: true,
            rev: 2,
        });
        expect(gantt.deleteLink).toHaveBeenCalledWith(6);
    });

    it('rejects link cycles without transaction or rev bump', async () => {
        const gantt = createGantt({
            links: [
                { id: 1, source: 1, target: 2, type: '0' },
                { id: 2, source: 2, target: 3, type: '0' },
            ],
        });
        const app = createApp(gantt);

        await expect(app.link.add({ source: 3, target: 1, type: 'fs' })).resolves.toEqual({
            ok: false,
            error: {
                code: 'CYCLE',
                message: 'Dependency would create a cycle.',
                hint: 'Remove or reverse an existing dependency, then retry link.add.',
            },
            rev: 0,
        });
        expect(gantt.addLink).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('moves schedules through scheduler utilities and exposes recalc command', async () => {
        const gantt = createGantt({
            tasks: [
                {
                    id: 1,
                    start_date: new Date(2026, 6, 1),
                    end_date: new Date(2026, 6, 3),
                    duration: 2,
                },
            ],
        });
        const app = createApp(gantt);

        await expect(app.schedule.move({ id: 1, days: 2 })).resolves.toMatchObject({
            ok: true,
            data: {
                diff: {
                    updated: [
                        {
                            id: 1,
                            fields: {
                                start_date: { new: new Date(2026, 6, 3) },
                                end_date: { new: new Date(2026, 6, 5) },
                            },
                        },
                    ],
                },
            },
            rev: 1,
        });
        expect(scheduler.addWorkDays).toHaveBeenCalled();
        expect(gantt.updateTask).toHaveBeenCalledWith(1);

        await expect(app.schedule.recalc({ fromTaskId: 1 })).resolves.toMatchObject({
            ok: true,
            rev: 2,
        });
        expect(scheduler.recalculateProjectSchedule).toHaveBeenCalledWith(1);
    });

    it('rejects non-positive schedule.move days before scheduler, transaction, or rev bump', async () => {
        const gantt = createGantt({
            tasks: [
                {
                    id: 1,
                    start_date: new Date(2026, 6, 1),
                    end_date: new Date(2026, 6, 3),
                    duration: 2,
                },
            ],
        });
        const app = createApp(gantt);

        await expect(app.schedule.move({ id: 1, days: -1 })).resolves.toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'days must be at least 1',
                hint: 'Use --days 1 or greater.',
            },
            rev: 0,
        });
        await expect(app.schedule.move({ id: 1, days: 0 })).resolves.toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'days must be at least 1',
                hint: 'Use --days 1 or greater.',
            },
            rev: 0,
        });
        expect(scheduler.addWorkDays).not.toHaveBeenCalled();
        expect(gantt.updateTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('rejects schedule.move for tasks without dates before transaction or rev bump', async () => {
        const gantt = createGantt({
            tasks: [{ id: 1, text: 'Undated task' }],
        });
        const app = createApp(gantt);

        await expect(app.schedule.move({ id: 1, days: 2 })).resolves.toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Task has no schedule dates to move.',
                hint: 'Set start_date or end_date before using schedule.move.',
            },
            rev: 0,
        });
        expect(scheduler.addWorkDays).not.toHaveBeenCalled();
        expect(gantt.updateTask).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });
});
