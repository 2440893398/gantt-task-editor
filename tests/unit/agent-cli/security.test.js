import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { dispatch, batch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import { initAgentCli } from '../../../src/features/agent-cli/index.js';
import { state } from '../../../src/core/store.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const { runGanttTransaction } = await import('../../../src/features/gantt/domain/transaction.js');
const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');

const projectId = 'security-test';

function registerReadCommand(handler = vi.fn(() => ({ tasks: [] }))) {
    defineCommand({
        name: 'task.list',
        summary: 'List tasks',
        params: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
        mutating: false,
        handler,
    });
    return handler;
}

function registerWriteCommand({ commit = vi.fn(() => ({ id: 1 })) } = {}) {
    const plan = vi.fn(() => ({
        diff: {
            created: [{ id: 1, text: 'Created' }],
            updated: [],
            deleted: [],
            links: { added: [], removed: [] },
        },
    }));

    defineCommand({
        name: 'task.create',
        summary: 'Create task',
        params: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                dryRun: { type: 'boolean' },
                sync: { type: 'boolean' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        op: { plan, commit },
    });

    return { plan, commit };
}

function readOnlyResult(command) {
    return {
        ok: false,
        error: {
            code: 'CONSTRAINT',
            message: 'Agent command layer is read-only.',
            hint: 'Use read commands only or enable write mode in app configuration.',
            nextAction: {
                command: 'help',
                args: { command },
                reason: 'Read the command constraints and discovery paths.',
            },
        },
        rev: 0,
    };
}

describe('agent command security controls', () => {
    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        vi.clearAllMocks();
        delete globalThis.app;
        state.currentProjectId = null;
        document.documentElement.removeAttribute('data-agent-api');
        document.documentElement.removeAttribute('data-agent-api-fallback');
        document.querySelector('meta[name="agent-api"]')?.remove();
        document.querySelector('meta[name="agent-api-runner"]')?.remove();
        document.getElementById('agent-api-discovery')?.remove();
        document.getElementById('agent-api-manifest')?.remove();
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        delete globalThis.app;
        delete globalThis.gantt;
        state.currentProjectId = null;
        document.documentElement.removeAttribute('data-agent-api');
        document.documentElement.removeAttribute('data-agent-api-fallback');
        document.querySelector('meta[name="agent-api"]')?.remove();
        document.querySelector('meta[name="agent-api-runner"]')?.remove();
        document.getElementById('agent-api-discovery')?.remove();
        document.getElementById('agent-api-manifest')?.remove();
    });

    describe('enabled:false', () => {
        it('does not expose window.app or inject discovery metadata', () => {
            const result = initAgentCli({ enabled: false });

            expect(globalThis.app).toBeUndefined();
            expect(result == null).toBe(true);
            expect(document.documentElement.dataset.agentApi).toBeUndefined();
            expect(document.documentElement.dataset.agentApiFallback).toBeUndefined();
            expect(document.querySelector('meta[name="agent-api"]')).toBeNull();
            expect(document.querySelector('meta[name="agent-api-runner"]')).toBeNull();
            expect(document.getElementById('agent-api-discovery')).toBeNull();
            expect(document.getElementById('agent-api-manifest')).toBeNull();
        });

        it('exposes window.app and discovery metadata when enabled (default)', () => {
            const app = initAgentCli({
                context: {
                    adapter: {
                        getTasks: () => [],
                        getLinks: () => [],
                        serialize: () => ({ data: [], links: [] }),
                    },
                },
            });

            expect(globalThis.app).toBe(app);
            expect(document.documentElement.dataset.agentApi).toBe('window.app');
            expect(document.documentElement.dataset.agentApiFallback).toBe('dom-runner');
            expect(document.querySelector('meta[name="agent-api"]')?.content).toContain(
                'window.app.help()'
            );
            expect(document.querySelector('meta[name="agent-api-runner"]')?.content).toContain(
                '#agent-guide-command-input'
            );
            expect(document.getElementById('agent-api-discovery')).toBeTruthy();
            expect(document.getElementById('agent-api-manifest')).toBeTruthy();
            const discovery = JSON.parse(
                document.getElementById('agent-api-discovery').textContent
            );
            expect(discovery.version).toBe(2);
            expect(discovery.progressiveDisclosure).toMatchObject({
                commandHelp: expect.stringContaining("help('task.create')"),
                taskForm: expect.stringContaining('form.describe'),
                errorRecovery: expect.stringContaining('nextAction'),
            });
        });
    });

    describe('readOnly enforcement', () => {
        it('rejects mutating commands with a CONSTRAINT result carrying current rev', async () => {
            const command = registerWriteCommand();

            const result = await dispatch(
                'task.create',
                { name: 'Created' },
                { projectId, gantt: {}, readOnly: true }
            );

            expect(result).toEqual(readOnlyResult('task.create'));
            expect(command.plan).not.toHaveBeenCalled();
            expect(command.commit).not.toHaveBeenCalled();
            expect(runGanttTransaction).not.toHaveBeenCalled();
            expect(settleAndPersist).not.toHaveBeenCalled();
            expect(getProjectRev(projectId)).toBe(0);
        });

        it('still allows read commands in read-only mode', async () => {
            const handler = registerReadCommand();

            const result = await dispatch('task.list', {}, { projectId, readOnly: true });

            expect(result).toEqual({ ok: true, data: { tasks: [] }, rev: 0 });
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('rejects batch in read-only mode with a CONSTRAINT result', async () => {
            const command = registerWriteCommand();

            const result = await batch([{ op: 'task.create', args: { name: 'Created' } }], {
                projectId,
                gantt: {},
                readOnly: true,
            });

            expect(result).toEqual(readOnlyResult('batch'));
            expect(command.plan).not.toHaveBeenCalled();
            expect(command.commit).not.toHaveBeenCalled();
            expect(runGanttTransaction).not.toHaveBeenCalled();
            expect(settleAndPersist).not.toHaveBeenCalled();
            expect(getProjectRev(projectId)).toBe(0);
        });

        it('exposes mutating methods through the API but rejects them with CONSTRAINT', async () => {
            registerWriteCommand();
            initAgentCli({
                readOnly: true,
                context: {
                    projectId,
                    gantt: {},
                    adapter: {
                        getTasks: () => [],
                        getLinks: () => [],
                        serialize: () => ({ data: [], links: [] }),
                    },
                },
            });

            expect(typeof globalThis.app.task.create).toBe('function');
            const result = await globalThis.app.task.create({ name: 'Created' });

            expect(result).toEqual(readOnlyResult('task.create'));
        });

        it('rejects mutating commands issued through app.exec in read-only mode', async () => {
            const command = registerWriteCommand();
            initAgentCli({
                readOnly: true,
                context: {
                    projectId,
                    gantt: {},
                    adapter: {
                        getTasks: () => [],
                        getLinks: () => [],
                        serialize: () => ({ data: [], links: [] }),
                    },
                },
            });

            const result = await globalThis.app.exec('task.create --name Created');

            expect(result).toEqual(readOnlyResult('task.create'));
            expect(command.plan).not.toHaveBeenCalled();
            expect(command.commit).not.toHaveBeenCalled();
            expect(runGanttTransaction).not.toHaveBeenCalled();
            expect(settleAndPersist).not.toHaveBeenCalled();
            expect(getProjectRev(projectId)).toBe(0);
        });

        it('does not let app.exec callers clear readOnly to bypass the guard', async () => {
            // Regression guard: a raw { ...context, ...execOptions } spread let a
            // caller pass { readOnly: false } to re-enable writes. exec must apply
            // only an allowlist of per-call options, never security/injection fields.
            const command = registerWriteCommand();
            initAgentCli({
                readOnly: true,
                context: {
                    projectId,
                    gantt: {},
                    adapter: {
                        getTasks: () => [],
                        getLinks: () => [],
                        serialize: () => ({ data: [], links: [] }),
                    },
                },
            });

            const result = await globalThis.app.exec('task.create --name Created', {
                readOnly: false,
            });

            expect(result).toEqual(readOnlyResult('task.create'));
            expect(command.plan).not.toHaveBeenCalled();
            expect(command.commit).not.toHaveBeenCalled();
            expect(runGanttTransaction).not.toHaveBeenCalled();
            expect(settleAndPersist).not.toHaveBeenCalled();
            expect(getProjectRev(projectId)).toBe(0);
        });

        it('does not let app.exec callers inject their own scheduleCloudSync', async () => {
            // scheduleCloudSync is a trusted injected field; a caller must not be
            // able to supply their own via execOptions.
            registerWriteCommand();
            const trusted = vi.fn();
            const attacker = vi.fn();
            initAgentCli({
                scheduleCloudSync: trusted,
                context: {
                    projectId,
                    gantt: {},
                    adapter: {
                        getTasks: () => [],
                        getLinks: () => [],
                        serialize: () => ({ data: [], links: [] }),
                    },
                },
            });

            const result = await globalThis.app.exec('task.create --name Created --sync', {
                scheduleCloudSync: attacker,
            });

            expect(result.ok).toBe(true);
            expect(attacker).not.toHaveBeenCalled();
            expect(trusted).toHaveBeenCalledTimes(1);
            expect(trusted).toHaveBeenCalledWith(projectId);
        });
    });

    describe('cloud sync gating', () => {
        it('does not trigger cloud sync by default', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn();

            const result = await dispatch(
                'task.create',
                { name: 'Created' },
                { projectId, gantt: {}, scheduleCloudSync }
            );

            expect(result.ok).toBe(true);
            expect(scheduleCloudSync).not.toHaveBeenCalled();
        });

        it('marks the next autosave as local-only for default local writes', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn();
            const markNextAutosaveLocalOnly = vi.fn();

            const result = await dispatch(
                'task.create',
                { name: 'Created' },
                { projectId, gantt: {}, scheduleCloudSync, markNextAutosaveLocalOnly }
            );

            expect(result.ok).toBe(true);
            expect(markNextAutosaveLocalOnly).toHaveBeenCalledTimes(1);
            expect(markNextAutosaveLocalOnly).toHaveBeenCalledWith(projectId);
            expect(scheduleCloudSync).not.toHaveBeenCalled();
        });

        it('triggers cloud sync only when a successful mutating command passes sync:true', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn();
            const markNextAutosaveLocalOnly = vi.fn();

            const result = await dispatch(
                'task.create',
                { name: 'Created', sync: true },
                { projectId, gantt: {}, scheduleCloudSync, markNextAutosaveLocalOnly }
            );

            expect(result.ok).toBe(true);
            expect(scheduleCloudSync).toHaveBeenCalledTimes(1);
            expect(scheduleCloudSync).toHaveBeenCalledWith(projectId);
            expect(markNextAutosaveLocalOnly).not.toHaveBeenCalled();
        });

        it('honors sync passed through the dispatch context', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn();

            const result = await dispatch(
                'task.create',
                { name: 'Created' },
                { projectId, gantt: {}, scheduleCloudSync, sync: true }
            );

            expect(result.ok).toBe(true);
            expect(scheduleCloudSync).toHaveBeenCalledTimes(1);
            expect(scheduleCloudSync).toHaveBeenCalledWith(projectId);
        });

        it('does not trigger cloud sync when the mutating command fails', async () => {
            registerWriteCommand({
                commit: vi.fn(() => {
                    throw new Error('commit failed');
                }),
            });
            runGanttTransaction.mockImplementationOnce(async ({ work }) => {
                try {
                    await work();
                    return { ok: true, data: null };
                } catch (error) {
                    return { ok: false, error };
                }
            });
            const scheduleCloudSync = vi.fn();

            const result = await dispatch(
                'task.create',
                { name: 'Created', sync: true },
                { projectId, gantt: {}, scheduleCloudSync }
            );

            expect(result.ok).toBe(false);
            expect(scheduleCloudSync).not.toHaveBeenCalled();
        });

        it('does not mark local-only autosave when settle rolls back a dispatch write', async () => {
            registerWriteCommand();
            settleAndPersist.mockRejectedValueOnce(new Error('persist failed'));
            runGanttTransaction.mockImplementationOnce(async ({ work }) => {
                try {
                    await work();
                    return { ok: true, data: null };
                } catch (error) {
                    return { ok: false, error };
                }
            });
            const markNextAutosaveLocalOnly = vi.fn();

            const result = await dispatch(
                'task.create',
                { name: 'Created' },
                { projectId, gantt: {}, markNextAutosaveLocalOnly }
            );

            expect(result.ok).toBe(false);
            expect(markNextAutosaveLocalOnly).not.toHaveBeenCalled();
        });

        it('triggers cloud sync after a successful batch when sync:true', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn();

            const result = await batch([{ op: 'task.create', args: { name: 'Created' } }], {
                projectId,
                gantt: {},
                scheduleCloudSync,
                sync: true,
            });

            expect(result.ok).toBe(true);
            expect(scheduleCloudSync).toHaveBeenCalledTimes(1);
            expect(scheduleCloudSync).toHaveBeenCalledWith(projectId);
        });

        it('does not trigger cloud sync after a batch by default', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn();
            const markNextAutosaveLocalOnly = vi.fn();

            const result = await batch([{ op: 'task.create', args: { name: 'Created' } }], {
                projectId,
                gantt: {},
                scheduleCloudSync,
                markNextAutosaveLocalOnly,
            });

            expect(result.ok).toBe(true);
            expect(scheduleCloudSync).not.toHaveBeenCalled();
            expect(markNextAutosaveLocalOnly).toHaveBeenCalledTimes(1);
            expect(markNextAutosaveLocalOnly).toHaveBeenCalledWith(projectId);
        });

        it('does not mark local-only autosave when settle rolls back a batch write', async () => {
            registerWriteCommand();
            settleAndPersist.mockRejectedValueOnce(new Error('persist failed'));
            runGanttTransaction.mockImplementationOnce(async ({ work }) => {
                try {
                    await work();
                    return { ok: true, data: null };
                } catch (error) {
                    return { ok: false, error };
                }
            });
            const markNextAutosaveLocalOnly = vi.fn();

            const result = await batch([{ op: 'task.create', args: { name: 'Created' } }], {
                projectId,
                gantt: {},
                markNextAutosaveLocalOnly,
            });

            expect(result.ok).toBe(false);
            expect(markNextAutosaveLocalOnly).not.toHaveBeenCalled();
        });

        it('reports a committed write as ok even when cloud sync throws (dispatch)', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn(() => {
                throw new Error('cloud sync exploded');
            });

            const result = await dispatch(
                'task.create',
                { name: 'Created', sync: true },
                { projectId, gantt: {}, scheduleCloudSync }
            );

            expect(result).toMatchObject({
                ok: true,
                data: { diff: { created: [{ id: 1, text: 'Created' }] } },
                rev: 1,
            });
            expect(scheduleCloudSync).toHaveBeenCalledTimes(1);
            expect(getProjectRev(projectId)).toBe(1);
        });

        it('reports a committed batch as ok even when cloud sync throws (batch)', async () => {
            registerWriteCommand();
            const scheduleCloudSync = vi.fn(() => {
                throw new Error('cloud sync exploded');
            });

            const result = await batch([{ op: 'task.create', args: { name: 'Created' } }], {
                projectId,
                gantt: {},
                scheduleCloudSync,
                sync: true,
            });

            expect(result.ok).toBe(true);
            expect(result.rev).toBe(1);
            expect(scheduleCloudSync).toHaveBeenCalledTimes(1);
            expect(getProjectRev(projectId)).toBe(1);
        });
    });
});
