import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCommandsForTest, getCommand } from '../../../src/features/agent-cli/registry.js';
import { registerHierarchyCommands } from '../../../src/features/agent-cli/commands/hierarchy.js';
import { registerScheduleCommands } from '../../../src/features/agent-cli/commands/schedule.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';
import { withErrorNavigation } from '../../../src/features/agent-cli/runtime/result.js';

function createGanttWithoutTask() {
    return {
        getTask(id) {
            throw new Error(`Task not found id=${id}`);
        },
        isTaskExists: () => false,
        getChildren: () => [],
    };
}

describe('discovery commands with a missing task', () => {
    beforeEach(() => {
        clearCommandsForTest();
        registerScheduleCommands();
        registerHierarchyCommands();
        registerTaskCommands();
    });

    afterEach(() => clearCommandsForTest());

    it('returns NOT_FOUND from schedule.describe instead of throwing', async () => {
        const result = await getCommand('schedule.describe').handler(
            { taskId: 999 },
            { gantt: createGanttWithoutTask() }
        );

        expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('returns NOT_FOUND from hierarchy.inspect instead of throwing', () => {
        const result = getCommand('hierarchy.inspect').handler(
            { taskId: 999 },
            { gantt: createGanttWithoutTask() }
        );

        expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    });

    it('navigates schedule NOT_FOUND errors to task.list', () => {
        const result = withErrorNavigation(
            { ok: false, error: { code: 'NOT_FOUND', message: 'Task not found: 999' } },
            { command: 'schedule.describe', args: { taskId: 999 }, getCommand }
        );

        expect(result.error.nextAction).toMatchObject({ command: 'task.list' });
    });
});
