import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearCommandsForTest,
    defineCommand,
    getCommand,
} from '../../../src/features/agent-cli/registry.js';
import { buildHelp, buildManifest } from '../../../src/features/agent-cli/runtime/manifest.js';
import { createReadAction } from '../../../src/features/agent-cli/runtime/read-action.js';

describe('agent manifest v2 discovery contract', () => {
    beforeEach(() => {
        clearCommandsForTest();
    });

    it('keeps manifest compact and publishes discovery through named help', () => {
        const command = {
            name: 'task.create',
            summary: 'Create a task',
            params: { type: 'object', properties: { values: { type: 'object' } } },
            result: { type: 'object' },
            mutating: true,
            dynamic: true,
            supports: ['dryRun', 'batch'],
            discovery: [
                {
                    when: 'Before filling task fields',
                    command: 'form.describe',
                    args: { form: 'task', mode: 'create' },
                    reason: 'The task form is dynamic.',
                },
            ],
            errors: ['INVALID_FIELD_VALUE'],
            examples: ["app.task.create({ values: { text: 'A' } })"],
        };

        const commands = [
            { name: 'form.describe', summary: 'Describe form', mutating: false },
            command,
        ];
        const manifest = buildManifest(commands);
        const entry = manifest.commands.find((item) => item.name === 'task.create');
        const help = buildHelp(commands, 'task.create');

        expect(manifest.version).toBe(2);
        expect(entry).toEqual({
            name: 'task.create',
            summary: 'Create a task',
            mutating: true,
            dynamic: true,
            supports: ['dryRun', 'batch'],
        });
        expect(help).toMatchObject({
            name: 'task.create',
            params: command.params,
            result: command.result,
            discovery: command.discovery,
            errors: command.errors,
        });
    });

    it('returns a compact v2 command directory from help without a name', () => {
        const help = buildHelp([{ name: 'state.rev', summary: 'Read revision', mutating: false }]);

        expect(help.version).toBe(2);
        expect(help.commands.find((item) => item.name === 'state.rev')).toEqual({
            name: 'state.rev',
            summary: 'Read revision',
            mutating: false,
            dynamic: false,
            supports: [],
        });
        expect(help.howto).toContain("help('command.name')");
    });

    it('constructs a next action only for a registered read command', () => {
        defineCommand({ name: 'form.describe', summary: 'Describe form', mutating: false });

        expect(
            createReadAction('form.describe', { form: 'task' }, 'Read task form', { getCommand })
        ).toEqual({
            command: 'form.describe',
            args: { form: 'task' },
            reason: 'Read task form',
        });
    });

    it('rejects mutating or missing next-action targets', () => {
        defineCommand({ name: 'task.create', summary: 'Create task', mutating: true });

        expect(() => createReadAction('task.create', {}, 'Unsafe action', { getCommand })).toThrow(
            'must target a read-only command'
        );
        expect(() =>
            createReadAction('missing.command', {}, 'Missing action', { getCommand })
        ).toThrow('must target a read-only command');
    });

    it('publishes safe default discovery for built-in dynamic and structural commands', () => {
        const reads = [
            'form.describe',
            'form.field',
            'schedule.describe',
            'calendar.describe',
            'hierarchy.inspect',
            'link.list',
            'project.list',
            'state.rev',
            'task.get',
        ].map((name) => ({ name, summary: name, mutating: false }));
        const commands = [
            ...reads,
            { name: 'task.create', summary: 'Create task', mutating: true },
            { name: 'task.update', summary: 'Update task', mutating: true },
            { name: 'task.list', summary: 'List tasks', mutating: false },
            { name: 'state.export', summary: 'Export tasks', mutating: false },
            { name: 'schedule.move', summary: 'Move schedule', mutating: true },
            { name: 'hierarchy.move', summary: 'Move hierarchy', mutating: true },
            { name: 'link.add', summary: 'Add link', mutating: true },
            { name: 'project.switch', summary: 'Switch project', mutating: true },
        ];

        expect(buildHelp(commands, 'task.create').discovery).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ command: 'form.describe' }),
                expect.objectContaining({ command: 'schedule.describe' }),
            ])
        );
        expect(buildHelp(commands, 'task.update').discovery[0]).toMatchObject({
            command: 'form.describe',
            args: { form: 'task', mode: 'update' },
        });
        expect(buildHelp(commands, 'task.list').discovery[0].command).toBe('form.describe');
        expect(buildHelp(commands, 'state.export').discovery[0].command).toBe('form.describe');
        expect(buildHelp(commands, 'schedule.move').discovery).toEqual(
            expect.arrayContaining([expect.objectContaining({ command: 'calendar.describe' })])
        );
        expect(buildHelp(commands, 'hierarchy.move').discovery[0].command).toBe(
            'hierarchy.inspect'
        );
        expect(buildHelp(commands, 'link.add').discovery[0].command).toBe('link.list');
        expect(buildHelp(commands, 'project.switch').discovery[0].command).toBe('project.list');
    });
});
