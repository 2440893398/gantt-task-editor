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

    it('passes allowlisted per-call options through nested command methods', async () => {
        defineCommand({
            name: 'task.create',
            summary: 'Create task',
            params: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                },
                additionalProperties: false,
            },
            mutating: true,
            handler: () => ({ id: 1 }),
        });

        const executeCommand = vi.fn(async () => ({ ok: true, data: { id: 1 }, rev: 2 }));
        const app = buildApi({
            executeCommand,
            context: { adapter: 'trusted-adapter', readOnly: true },
        });

        await app.task.create(
            { name: 'Created by agent' },
            {
                ifRev: 7,
                dryRun: true,
                sync: true,
                readOnly: false,
                adapter: 'evil-adapter',
                scheduleCloudSync: () => 'evil',
            }
        );

        expect(executeCommand).toHaveBeenCalledWith(
            'task.create',
            { name: 'Created by agent' },
            expect.objectContaining({
                adapter: 'trusted-adapter',
                readOnly: true,
                ifRev: 7,
                dryRun: true,
                sync: true,
            })
        );
        expect(executeCommand.mock.calls[0][2].scheduleCloudSync).toBeUndefined();
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
        // `batch` is auto-injected as a synthetic command, so assert the
        // registered command is present rather than the exact list.
        expect(app.help().commands).toEqual(
            expect.arrayContaining([
                {
                    name: 'task.list',
                    summary: 'List tasks',
                    mutating: false,
                },
            ])
        );
        expect(app.help('task.list')?.name).toBe('task.list');
        expect(app.manifest().commands.map((command) => command.name)).toContain('task.list');
        expect(app.manifest().commands.map((command) => command.name)).toContain('batch');
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
        injectAgentDiscovery({
            manifest: {
                version: 1,
                commands: [
                    {
                        name: 'state.snapshot',
                        summary: 'Read state',
                        mutating: false,
                    },
                    {
                        name: 'task.create',
                        summary: 'Create task',
                        mutating: true,
                    },
                ],
            },
            readOnly: true,
        });

        expect(document.documentElement.dataset.agentApi).toBe('window.app');
        expect(document.documentElement.dataset.agentApiFallback).toBe('dom-runner');
        expect(document.querySelector('meta[name="agent-api"]')?.content).toContain(
            'window.app.help()'
        );
        expect(document.querySelector('meta[name="agent-api-runner"]')?.content).toContain(
            '#agent-guide-command-input'
        );

        const discovery = JSON.parse(
            document.getElementById('agent-api-discovery')?.textContent || '{}'
        );
        expect(discovery).toMatchObject({
            version: 1,
            readOnly: true,
            primary: {
                object: 'window.app',
            },
            fallback: {
                type: 'visible-dom-runner',
                open: '#agent-guide-btn',
                input: '#agent-guide-command-input',
                run: '#agent-guide-run-command',
                output: '#agent-guide-run-output',
            },
        });
        expect(discovery.commands.map((command) => command.name)).toContain('task.create');

        const manifest = JSON.parse(document.getElementById('agent-api-manifest')?.textContent);
        expect(manifest.commands.map((command) => command.name)).toContain('state.snapshot');
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
