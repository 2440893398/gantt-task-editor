import { describe, expect, it } from 'vitest';
import { buildHelp, buildManifest } from '../../../src/features/agent-cli/runtime/manifest.js';

describe('agent manifest runtime', () => {
    it('builds a sorted public manifest without handlers', () => {
        const manifest = buildManifest([
            {
                name: 'task.update',
                summary: 'Update a task',
                params: { type: 'object', properties: {} },
                mutating: true,
                examples: ['task.update --id 1'],
                handler: () => null,
            },
            {
                name: 'task.create',
                summary: 'Create a task',
                params: { type: 'object', properties: { name: { type: 'string' } } },
                mutating: true,
                examples: ['task.create --name Design'],
                handler: () => null,
            },
        ]);

        // `batch` is auto-injected as a synthetic entry; assert the supplied
        // commands are sorted and stripped of handlers independently of it.
        expect(manifest.version).toBe(1);
        expect(manifest.commands.filter((command) => command.name !== 'batch')).toEqual([
            {
                name: 'task.create',
                summary: 'Create a task',
                params: { type: 'object', properties: { name: { type: 'string' } } },
                mutating: true,
                examples: ['task.create --name Design'],
            },
            {
                name: 'task.update',
                summary: 'Update a task',
                params: { type: 'object', properties: {} },
                mutating: true,
                examples: ['task.update --id 1'],
            },
        ]);
    });

    it('injects a synthetic batch entry into the manifest', () => {
        const manifest = buildManifest([]);
        const batchEntry = manifest.commands.find((command) => command.name === 'batch');

        expect(batchEntry).toMatchObject({
            name: 'batch',
            mutating: true,
        });
        expect(batchEntry.params).toEqual(expect.any(Object));
    });

    it('builds detailed help for a named command', () => {
        const help = buildHelp(
            [
                {
                    name: 'task.create',
                    summary: 'Create a task',
                    params: { type: 'object', properties: { name: { type: 'string' } } },
                    mutating: true,
                    examples: ['task.create --name Design'],
                },
            ],
            'task.create'
        );

        expect(help).toEqual({
            name: 'task.create',
            summary: 'Create a task',
            params: { type: 'object', properties: { name: { type: 'string' } } },
            mutating: true,
            examples: ['task.create --name Design'],
        });
    });
});
