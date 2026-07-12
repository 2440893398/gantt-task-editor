import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { registerCalendarCommands } from '../../../src/features/agent-cli/commands/calendar.js';
import { registerHierarchyCommands } from '../../../src/features/agent-cli/commands/hierarchy.js';
import { registerScheduleCommands } from '../../../src/features/agent-cli/commands/schedule.js';

function createGantt() {
    const tasks = new Map([
        [1, { id: 1, text: 'Root', parent: 0 }],
        [2, { id: 2, text: 'Child', parent: 1 }],
    ]);
    return {
        getTask: (id) => tasks.get(id),
        getChildren: (id) =>
            [...tasks.values()].filter((task) => task.parent === id).map((task) => task.id),
        getPrevSibling: () => null,
        getNextSibling: () => null,
    };
}

describe('agent domain discovery commands', () => {
    let app;

    beforeEach(() => {
        clearCommandsForTest();
        registerCalendarCommands();
        registerScheduleCommands();
        registerHierarchyCommands();
        app = buildApi({
            context: {
                projectId: 'discovery-test',
                adapter: {
                    gantt: createGantt(),
                    getTasks: () => [],
                    getLinks: () => [],
                    serialize: () => ({ data: [], links: [] }),
                },
                schedulePolicyDeps: {
                    loadSettings: async () => ({ workdaysOfWeek: [1, 2, 3, 4, 5] }),
                    loadHolidays: async () => [],
                    loadCustomDays: async () => [],
                    loadLeaves: async () => [],
                },
                calendarQueryDeps: {
                    loadSettings: async () => ({ hoursPerDay: 8 }),
                    loadHolidays: async () => [],
                    loadCustomDays: async () => [],
                    loadLeaves: async () => [],
                },
            },
        });
    });

    afterEach(() => clearCommandsForTest());

    it('exposes schedule, calendar, and hierarchy descriptions as read commands', async () => {
        expect((await app.schedule.describe({})).data).toMatchObject({
            endDateSemantics: 'inclusive',
        });
        expect((await app.calendar.describe({ include: ['settings'] })).data.settings).toEqual({
            hoursPerDay: 8,
        });
        expect((await app.hierarchy.inspect({ taskId: 2, depth: 1 })).data).toMatchObject({
            task: { id: 2 },
            ancestors: [{ id: 1 }],
        });

        const names = ['schedule.describe', 'calendar.describe', 'hierarchy.inspect'];
        expect(
            app
                .manifest()
                .commands.filter((command) => names.includes(command.name))
                .every((command) => command.mutating === false)
        ).toBe(true);
    });

    it('requires a bounded range before disclosing exceptions or leaves', async () => {
        const result = await app.calendar.describe({ include: ['exceptions'] });

        expect(result).toMatchObject({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                nextAction: {
                    command: 'help',
                    args: { command: 'calendar.describe' },
                },
            },
        });
    });
});
