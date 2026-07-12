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

        const manifest = buildManifest([command]);
        const entry = manifest.commands.find((item) => item.name === 'task.create');
        const help = buildHelp([command], 'task.create');

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
});
