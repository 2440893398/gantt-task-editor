import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';
import { injectAgentDiscovery } from '../../../src/features/agent-cli/discovery/index.js';
import { initAgentCli } from '../../../src/features/agent-cli/index.js';
import { state } from '../../../src/core/store.js';
import { bumpProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

describe('agent api builder', () => {
    afterEach(() => {
        clearCommandsForTest();
        delete globalThis.app;
        state.currentProjectId = null;
        resetProjectRev('project-a');
        resetProjectRev('project-b');
        resetProjectRev('parse-project');
        document.documentElement.removeAttribute('data-agent-api');
        document.querySelector('meta[name="agent-api"]')?.remove();
    });

    it('maps registry dot names to a nested app API and shared executor', async () => {
        const handler = vi.fn(() => ({ tasks: [] }));
        defineCommand({
            name: 'task.list',
            summary: 'List tasks',
            params: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            },
            mutating: false,
            handler,
        });

        const executeCommand = vi.fn(async (name, args, context) => {
            const command = context.getCommand(name);
            const data = await command.handler(args, context);
            return { ok: true, data, rev: 0 };
        });
        const app = buildApi({ executeCommand, context: { adapter: 'adapter' } });

        await expect(app.task.list({ limit: '2' })).resolves.toEqual({
            ok: true,
            data: { tasks: [] },
            rev: 0,
        });
        expect(executeCommand).toHaveBeenCalledWith(
            'task.list',
            { limit: '2' },
            expect.objectContaining({
                adapter: 'adapter',
                getCommand: expect.any(Function),
            })
        );
        expect(handler).toHaveBeenCalledWith(
            { limit: '2' },
            expect.objectContaining({
                adapter: 'adapter',
            })
        );
    });

    it('exposes exec, help, and manifest helpers', async () => {
        defineCommand({
            name: 'task.list',
            summary: 'List tasks',
            params: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            },
            mutating: false,
            handler: (args) => args,
        });

        const app = buildApi();

        await expect(app.exec('task.list --limit 2')).resolves.toEqual({
            ok: true,
            data: { limit: 2 },
            rev: 0,
        });
        expect(app.help().commands).toEqual([
            {
                name: 'task.list',
                summary: 'List tasks',
                mutating: false,
            },
        ]);
        expect(app.help('task.list')?.name).toBe('task.list');
        expect(app.manifest().commands[0].name).toBe('task.list');
    });

    it('adds current rev to exec parse failures', async () => {
        defineCommand({
            name: 'task.list',
            summary: 'List tasks',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler: () => [],
        });
        bumpProjectRev('parse-project');
        const app = buildApi({ context: { projectId: 'parse-project' } });

        await expect(app.exec('task.missing')).resolves.toEqual({
            ok: false,
            error: {
                code: 'UNKNOWN_COMMAND',
                message: 'Unknown command: task.missing',
            },
            rev: 1,
        });
    });

    it('resolves state project id at command execution time', async () => {
        clearCommandsForTest();
        initAgentCli({
            context: {
                adapter: {
                    getTasks: () => [],
                    getLinks: () => [],
                    serialize: () => ({ data: [], links: [] }),
                },
            },
        });
        bumpProjectRev('project-a');
        bumpProjectRev('project-b');
        bumpProjectRev('project-b');

        state.currentProjectId = 'project-a';
        await expect(globalThis.app.state.rev()).resolves.toEqual({
            ok: true,
            data: { rev: 1 },
            rev: 1,
        });

        state.currentProjectId = 'project-b';
        await expect(globalThis.app.state.rev()).resolves.toEqual({
            ok: true,
            data: { rev: 2 },
            rev: 2,
        });
    });

    it('injects discovery metadata', () => {
        injectAgentDiscovery();

        expect(document.documentElement.dataset.agentApi).toBe('window.app');
        expect(document.querySelector('meta[name="agent-api"]')?.content).toBe('window.app.help()');
    });

    it('bootstraps window.app idempotently', () => {
        defineCommand({
            name: 'external.keep',
            summary: 'Externally registered command',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler: () => 'kept',
        });
        const context = {
            adapter: {
                getTasks: () => [],
                getLinks: () => [],
                serialize: () => ({ data: [], links: [] }),
            },
        };
        const first = initAgentCli({ context });
        const second = initAgentCli({ context });

        expect(first.help().commands.length).toBeGreaterThan(0);
        expect(second.help().commands.length).toBe(first.help().commands.length);
        expect(second.help('external.keep')?.name).toBe('external.keep');
        expect(globalThis.app).toBe(second);
    });

    it('bootstraps when one built-in is already registered and preserves external commands', () => {
        defineCommand({
            name: 'task.list',
            summary: 'Pre-registered task list',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler: () => [],
        });
        defineCommand({
            name: 'external.keep',
            summary: 'Externally registered command',
            params: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            mutating: false,
            handler: () => 'kept',
        });

        expect(() =>
            initAgentCli({
                context: {
                    adapter: {
                        getTasks: () => [],
                        getLinks: () => [],
                        serialize: () => ({ data: [], links: [] }),
                    },
                },
            })
        ).not.toThrow();

        expect(globalThis.app.help('task.list')?.name).toBe('task.list');
        expect(globalThis.app.help('state.rev')?.name).toBe('state.rev');
        expect(globalThis.app.help('task.get')?.name).toBe('task.get');
        expect(globalThis.app.help('link.list')?.name).toBe('link.list');
        expect(globalThis.app.help('external.keep')?.name).toBe('external.keep');
    });
});
