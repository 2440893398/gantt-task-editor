import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCommandsForTest } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { resetProjectRev } from '../../../src/features/gantt/domain/rev.js';
import { registerHierarchyCommands } from '../../../src/features/agent-cli/commands/hierarchy.js';
import { registerLinkCommands } from '../../../src/features/agent-cli/commands/link.js';
import { registerFormCommands } from '../../../src/features/agent-cli/commands/form.js';
import { registerCalendarCommands } from '../../../src/features/agent-cli/commands/calendar.js';
import { registerProjectCommands } from '../../../src/features/agent-cli/commands/project.js';
import { registerScheduleCommands } from '../../../src/features/agent-cli/commands/schedule.js';
import { registerSessionCommands } from '../../../src/features/agent-cli/commands/session.js';
import { registerStateCommands } from '../../../src/features/agent-cli/commands/state.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';

// The frozen v2 command surface. Any command added or removed from the manifest
// without updating this list is a contract change and MUST fail this test.
const V2_COMMANDS = [
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
    'hierarchy.inspect',
    'link.add',
    'link.remove',
    'link.list',
    'schedule.setDates',
    'schedule.move',
    'schedule.recalc',
    'schedule.describe',
    'form.describe',
    'form.field',
    'form.options',
    'calendar.describe',
    'project.list',
    'project.create',
    'project.switch',
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
        registerFormCommands();
        registerCalendarCommands();
        registerTaskCommands();
        registerHierarchyCommands();
        registerLinkCommands();
        registerScheduleCommands();
        registerSessionCommands();
        registerProjectCommands();
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

    it('exposes exactly the v2 commands', () => {
        const manifest = app.manifest();
        const names = manifest.commands.map((command) => command.name);

        expect(manifest.version).toBe(2);
        // Exact-set comparison (order-independent): flags any missing OR extra.
        expect(new Set(names)).toEqual(new Set(V2_COMMANDS));
        expect(names).toHaveLength(V2_COMMANDS.length);
    });

    it('keeps batch compact in manifest and detailed in help', () => {
        const manifest = app.manifest();
        const batchEntry = manifest.commands.find((command) => command.name === 'batch');

        expect(batchEntry).toBeDefined();
        expect(batchEntry.mutating).toBe(true);
        expect(batchEntry.summary).toEqual(expect.any(String));
        expect(batchEntry).not.toHaveProperty('params');
        expect(app.help('batch').params).toEqual(expect.any(Object));
    });

    it('keeps help() consistent with manifest()', () => {
        const helpNames = app.help().commands.map((command) => command.name);
        const manifestNames = app.manifest().commands.map((command) => command.name);

        expect(new Set(helpNames)).toEqual(new Set(manifestNames));
        expect(app.help('batch')?.name).toBe('batch');
    });

    it('publishes project configuration reuse and direct-link help', () => {
        const createHelp = app.help('project.create');

        expect(createHelp.params.properties.copyConfigFrom).toEqual({ type: 'string' });
        expect(createHelp.summary).toContain('copyConfigFrom');
        expect(createHelp.summary).toContain('result.url');
        expect(createHelp.discovery).toEqual(
            expect.arrayContaining([expect.objectContaining({ command: 'project.list' })])
        );
    });
});
