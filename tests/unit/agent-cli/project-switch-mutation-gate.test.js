import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/core/storage.js';
import { state, switchProject } from '../../../src/core/store.js';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { buildApi } from '../../../src/features/agent-cli/runtime/api-builder.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

describe('agent mutation and project switch coordination', () => {
    beforeEach(async () => {
        clearCommandsForTest();
        await db.open();
        await db.projects.clear();
        await db.tasks.clear();
        await db.links.clear();
        state.projects = [
            { id: 'project-a', name: 'A' },
            { id: 'project-b', name: 'B' },
        ];
        state.currentProjectId = 'project-a';
        state.isProjectSwitching = false;
        gantt.serialize = vi.fn(() => ({ data: [], links: [] }));
        gantt.clearAll = vi.fn();
    });

    afterEach(() => {
        clearCommandsForTest();
        document.replaceChildren();
    });

    it('waits to switch projects until an in-flight gantt mutation has settled', async () => {
        let releaseCommit;
        const commitGate = new Promise((resolve) => {
            releaseCommit = resolve;
        });
        let markCommitStarted;
        const commitStarted = new Promise((resolve) => {
            markCommitStarted = resolve;
        });
        const commitProjectIds = [];

        defineCommand({
            name: 'task.slow',
            summary: 'Slow mutation for coordination test',
            params: { type: 'object', properties: {}, additionalProperties: false },
            mutating: true,
            op: {
                plan: async () => ({
                    diff: {
                        created: [{ text: 'Slow task' }],
                        updated: [],
                        deleted: [],
                        links: { added: [], removed: [] },
                    },
                }),
                commit: async () => {
                    markCommitStarted();
                    await commitGate;
                    commitProjectIds.push(state.currentProjectId);
                    return { id: 1 };
                },
            },
        });
        const app = buildApi({ context: { gantt } });

        const mutation = app.task.slow();
        await commitStarted;
        const switching = switchProject('project-b');
        const queuedAfterSwitch = app.task.slow();
        const queuedBatchAfterSwitch = app.batch([{ op: 'task.slow', args: {} }]);
        const switchOutcome = await Promise.race([
            switching.then(() => 'switched'),
            new Promise((resolve) => {
                setTimeout(() => resolve('waiting'), 50);
            }),
        ]);
        const projectBeforeCommitFinished = state.currentProjectId;

        releaseCommit();
        await mutation;
        await switching;
        const queuedResult = await queuedAfterSwitch;
        const queuedBatchResult = await queuedBatchAfterSwitch;

        expect(switchOutcome).toBe('waiting');
        expect(projectBeforeCommitFinished).toBe('project-a');
        expect(commitProjectIds).toEqual(['project-a']);
        expect(state.currentProjectId).toBe('project-b');
        expect(queuedResult).toMatchObject({
            ok: false,
            error: { code: 'CONFLICT' },
        });
        expect(queuedBatchResult).toMatchObject({
            ok: false,
            error: { code: 'CONFLICT' },
        });
    });
});
