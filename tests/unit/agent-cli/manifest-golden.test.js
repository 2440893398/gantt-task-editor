import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { resetProjectRev } from '../../../src/features/gantt/domain/rev.js';
import { registerHierarchyCommands } from '../../../src/features/agent-cli/commands/hierarchy.js';
import { registerLinkCommands } from '../../../src/features/agent-cli/commands/link.js';
import { registerScheduleCommands } from '../../../src/features/agent-cli/commands/schedule.js';
import { registerSessionCommands } from '../../../src/features/agent-cli/commands/session.js';
import { registerStateCommands } from '../../../src/features/agent-cli/commands/state.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';

// The frozen v1 command surface. Any command added or removed from the manifest
// without updating this list is a contract change and MUST fail this test.
const V1_COMMANDS = [
    'task.get',
    'task.list',
    'task.today',
    'task.overdue',
    'task.create',
    'task.update',
    'task.delete',
    'hierarchy.move',
    'hierarchy.indent',
    'hierarchy.outdent',
    'link.add',
    'link.remove',
    'link.list',
    'schedule.setDates',
    'schedule.move',
    'schedule.recalc',
    'state.snapshot',
    'state.export',
    'state.rev',
    'session.undo',
    'session.redo',
    'session.history',
    'session.log',
    'batch',
    'operation.start',
    'operation.status',
    'operation.cancel',
    'operation.result',
];

const projectId = 'manifest-golden';

describe('agent command manifest golden contract', () => {
    let app;

    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        registerStateCommands();
        registerTaskCommands();
        registerHierarchyCommands();
        registerLinkCommands();
        registerScheduleCommands();
        registerSessionCommands();
        app = buildApi({
            context: {
                adapter: {
                    getTasks: () => [],
                    getLinks: () => [],
                    serialize: () => ({ data: [], links: [] }),
                },
                projectId,
            },
        });
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
    });

    it('exposes exactly the v1 commands', () => {
        const manifest = app.manifest();
        const names = manifest.commands.map((command) => command.name);

        expect(manifest.version).toBe(1);
        // Exact-set comparison (order-independent): flags any missing OR extra.
        expect(new Set(names)).toEqual(new Set(V1_COMMANDS));
        expect(names).toHaveLength(V1_COMMANDS.length);
    });

    it('includes a batch entry marked as mutating with params', () => {
        const manifest = app.manifest();
        const batchEntry = manifest.commands.find((command) => command.name === 'batch');

        expect(batchEntry).toBeDefined();
        expect(batchEntry.mutating).toBe(true);
        expect(batchEntry.summary).toEqual(expect.any(String));
        expect(batchEntry.params).toEqual(expect.any(Object));
    });

    it('keeps help() consistent with manifest()', () => {
        const helpNames = app.help().commands.map((command) => command.name);
        const manifestNames = app.manifest().commands.map((command) => command.name);

        expect(new Set(helpNames)).toEqual(new Set(manifestNames));
        expect(app.help('batch')?.name).toBe('batch');
    });
});
