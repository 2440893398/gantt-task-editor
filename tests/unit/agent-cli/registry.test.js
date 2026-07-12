import { afterEach, describe, expect, it } from 'vitest';
import {
    clearCommandsForTest,
    defineCommand,
    getCommand,
    getCommands,
} from '../../../src/features/agent-cli/registry.js';
import { buildHelp, buildManifest } from '../../../src/features/agent-cli/runtime/manifest.js';

const SYNTHETIC_COMMANDS = new Set([
    'batch',
    'operation.start',
    'operation.status',
    'operation.cancel',
    'operation.result',
]);

describe('agent command registry', () => {
    afterEach(() => {
        clearCommandsForTest();
    });

    it('rejects missing command names', () => {
        expect(() => defineCommand({ summary: 'Missing name' })).toThrow(
            'Command name is required'
        );
        expect(() => defineCommand()).toThrow('Command name is required');
    });

    it('rejects duplicate command names', () => {
        defineCommand({ name: 'task.create', summary: 'Create a task' });

        expect(() => defineCommand({ name: 'task.create', summary: 'Duplicate' })).toThrow(
            'Duplicate command: task.create'
        );
    });

    it('returns commands sorted by name', () => {
        defineCommand({ name: 'task.update', summary: 'Update a task' });
        defineCommand({ name: 'task.create', summary: 'Create a task' });

        expect(getCommands().map((command) => command.name)).toEqual([
            'task.create',
            'task.update',
        ]);
        expect(getCommand('task.create')?.summary).toBe('Create a task');
    });

    it('returns null for unknown commands', () => {
        expect(getCommand('task.missing')).toBeNull();
    });
});

describe('agent command manifest', () => {
    it('keeps manifest entries compact', () => {
        const manifest = buildManifest([
            {
                name: 'task.create',
                summary: 'Create a task',
                mutating: true,
                dynamic: false,
                supports: [],
            },
        ]);

        // `batch` is auto-injected; assert the supplied command independently.
        expect(
            manifest.commands.filter((command) => !SYNTHETIC_COMMANDS.has(command.name))
        ).toEqual([
            {
                name: 'task.create',
                summary: 'Create a task',
                mutating: true,
                dynamic: false,
                supports: [],
            },
        ]);
    });

    it('builds a compact command index when no command name is passed', () => {
        const help = buildHelp([
            {
                name: 'task.update',
                summary: 'Update a task',
                mutating: true,
            },
            {
                name: 'task.create',
                summary: 'Create a task',
                mutating: true,
            },
        ]);

        expect(help.version).toBe(2);
        expect(help.howto).toContain("help('command.name')");
        // `batch` is auto-injected; assert the supplied commands independently.
        expect(help.commands.filter((command) => !SYNTHETIC_COMMANDS.has(command.name))).toEqual([
            {
                name: 'task.create',
                summary: 'Create a task',
                mutating: true,
                dynamic: false,
                supports: [],
            },
            {
                name: 'task.update',
                summary: 'Update a task',
                mutating: true,
                dynamic: false,
                supports: [],
            },
        ]);
    });
});
