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

        expect(manifest).toEqual({
            version: 1,
            commands: [
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
            ],
        });
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
