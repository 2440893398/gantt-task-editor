import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { batch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import { clearCommandLog, getCommandLog } from '../../../src/features/agent-cli/runtime/log.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

vi.mock('../../../src/features/gantt/domain/transaction.js', () => ({
    runGanttTransaction: vi.fn(async ({ work }) => ({ ok: true, data: await work() })),
}));

vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const { runGanttTransaction } = await import('../../../src/features/gantt/domain/transaction.js');
const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');

const projectId = 'batch-test';

function emptyDiff() {
    return {
        created: [],
        updated: [],
        deleted: [],
        links: { added: [], removed: [] },
    };
}

/**
 * Registers a deterministic `task.create` command whose commit returns a
 * sequential id. `$ref` should resolve to that committed id.
 */
function registerCreateCommand({ commit } = {}) {
    let nextId = 100;

    const plan = vi.fn((args) => {
        const diff = emptyDiff();
        diff.created.push({ text: args.name, parent: args.parent ?? 0 });
        return { args, parent: args.parent ?? 0, diff };
    });

    const defaultCommit = vi.fn((plan) => {
        const id = nextId++;
        return { id, task: { id, text: plan.args.name, parent: plan.parent } };
    });

    defineCommand({
        name: 'task.create',
        summary: 'Create task',
        params: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                parent: { type: 'integer' },
            },
            required: ['name'],
            additionalProperties: false,
        },
        mutating: true,
        op: { plan, commit: commit || defaultCommit },
    });

    return { plan, commit: commit || defaultCommit };
}

describe('agent batch dispatch', () => {
    beforeEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        resetProjectRev(projectId);
        vi.clearAllMocks();
        runGanttTransaction.mockImplementation(async ({ work }) => ({
            ok: true,
            data: await work(),
        }));
    });

    afterEach(() => {
        clearCommandsForTest();
        clearCommandLog();
        resetProjectRev(projectId);
    });

    it('bumps project rev exactly once after a successful batch', async () => {
        const command = registerCreateCommand();

        const result = await batch(
            [
                { op: 'task.create', args: { name: 'First' } },
                { op: 'task.create', args: { name: 'Second' } },
            ],
            { projectId, gantt: {} }
        );

        expect(result.ok).toBe(true);
        expect(result.rev).toBe(1);
        expect(getProjectRev(projectId)).toBe(1);
        expect(command.commit).toHaveBeenCalledTimes(2);
        expect(runGanttTransaction).toHaveBeenCalledTimes(1);
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
    });

    it('returns per-step data and a merged diff on success', async () => {
        registerCreateCommand();

        const result = await batch(
            [
                { op: 'task.create', args: { name: 'First' } },
                { op: 'task.create', args: { name: 'Second' } },
            ],
            { projectId, gantt: {} }
        );

        expect(result.ok).toBe(true);
        expect(result.data.steps).toHaveLength(2);
        expect(result.data.steps[0]).toMatchObject({ id: 100 });
        expect(result.data.steps[1]).toMatchObject({ id: 101 });
        expect(result.data.diff).toEqual({
            created: [
                { text: 'First', parent: 0 },
                { text: 'Second', parent: 0 },
            ],
            updated: [],
            deleted: [],
            links: { added: [], removed: [] },
        });
    });

    it('rolls back all changes and does not bump rev when a later step fails', async () => {
        const commit = vi.fn((plan) => {
            if (plan.args.name === 'Boom') {
                throw new Error('commit failed');
            }
            return { id: 200, task: { id: 200, text: plan.args.name } };
        });
        registerCreateCommand({ commit });
        runGanttTransaction.mockImplementationOnce(async ({ work }) => {
            try {
                return { ok: true, data: await work() };
            } catch (error) {
                return { ok: false, error };
            }
        });

        const result = await batch(
            [
                { op: 'task.create', args: { name: 'Good' } },
                { op: 'task.create', args: { name: 'Boom' } },
            ],
            { projectId, gantt: {} }
        );

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('EXEC_ERROR');
        expect(result.rev).toBe(0);
        expect(getProjectRev(projectId)).toBe(0);
        expect(settleAndPersist).not.toHaveBeenCalled();
    });

    it('resolves $ref to the committed id of an earlier step', async () => {
        const commit = vi.fn((plan) => {
            if (plan.args.name === 'Parent') {
                return { id: 500, task: { id: 500, text: 'Parent' } };
            }
            return { id: 501, task: { id: 501, text: plan.args.name, parent: plan.args.parent } };
        });
        registerCreateCommand({ commit });

        const result = await batch(
            [
                { op: 'task.create', as: 'root', args: { name: 'Parent' } },
                { op: 'task.create', args: { name: 'Child', parent: '$root' } },
            ],
            { projectId, gantt: {} }
        );

        expect(result.ok).toBe(true);
        // The second step's commit must receive the resolved parent id (500).
        expect(commit).toHaveBeenLastCalledWith(
            expect.objectContaining({ args: expect.objectContaining({ parent: 500 }) }),
            expect.anything()
        );
    });

    it('fails with BAD_ARGS when a $ref names an unknown alias', async () => {
        registerCreateCommand();

        const result = await batch(
            [{ op: 'task.create', args: { name: 'Child', parent: '$missing' } }],
            { projectId, gantt: {} }
        );

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('BAD_ARGS');
        expect(result.error.hint).toContain('missing');
        expect(result.rev).toBe(0);
        expect(runGanttTransaction).not.toHaveBeenCalled();
    });

    it('previews ref-independent steps in dry-run and defers ref-dependent ones with warnings', async () => {
        const command = registerCreateCommand();

        const result = await batch(
            [
                { op: 'task.create', as: 'root', args: { name: 'Parent' } },
                { op: 'task.create', args: { name: 'Child', parent: '$root' } },
            ],
            { projectId, gantt: {}, dryRun: true }
        );

        expect(result.ok).toBe(true);
        expect(result.rev).toBe(0);
        // Only the ref-independent step is previewed; the dependent step cannot be
        // previewed because its parent id does not exist yet.
        expect(result.data.diff).toEqual({
            created: [{ text: 'Parent', parent: 0 }],
            updated: [],
            deleted: [],
            links: { added: [], removed: [] },
        });
        expect(result.warnings).toEqual([expect.stringContaining('Step 2')]);
        expect(result.warnings[0]).toContain('task.create');
        expect(command.commit).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('returns CONFLICT before the transaction when ifRev mismatches', async () => {
        const command = registerCreateCommand();

        const result = await batch([{ op: 'task.create', args: { name: 'First' } }], {
            projectId,
            gantt: {},
            ifRev: 7,
        });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'CONFLICT',
                message: 'Project revision changed.',
                hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
            },
            rev: 0,
        });
        expect(command.plan).not.toHaveBeenCalled();
        expect(command.commit).not.toHaveBeenCalled();
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('fails with UNKNOWN_COMMAND for an unregistered op', async () => {
        const result = await batch([{ op: 'nope.missing', args: {} }], { projectId, gantt: {} });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('UNKNOWN_COMMAND');
        expect(result.rev).toBe(0);
        expect(runGanttTransaction).not.toHaveBeenCalled();
    });

    it('propagates a step validation failure with the pre-batch rev', async () => {
        registerCreateCommand();

        const result = await batch([{ op: 'task.create', args: { name: 'First', bogus: 'x' } }], {
            projectId,
            gantt: {},
        });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('BAD_ARGS');
        expect(result.rev).toBe(0);
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('treats an empty batch as a no-op without transaction, settle, or rev bump', async () => {
        const result = await batch([], { projectId, gantt: {} });

        expect(result).toEqual({
            ok: true,
            data: {
                steps: [],
                diff: emptyDiff(),
            },
            rev: 0,
        });
        expect(runGanttTransaction).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('treats an all-no-op batch as a no-op without settle or rev bump', async () => {
        const plan = vi.fn(() => ({ diff: emptyDiff() }));
        const commit = vi.fn(() => ({ id: 1 }));
        defineCommand({
            name: 'task.noop',
            summary: 'No-op update',
            params: { type: 'object', properties: {}, additionalProperties: false },
            mutating: true,
            op: { plan, commit, skipEmptyDiff: true },
        });

        const result = await batch(
            [
                { op: 'task.noop', args: {} },
                { op: 'task.noop', args: {} },
            ],
            { projectId, gantt: {} }
        );

        expect(result).toEqual({
            ok: true,
            data: {
                steps: [],
                diff: emptyDiff(),
            },
            rev: 0,
        });
        // skipEmptyDiff steps with an empty diff must not commit.
        expect(commit).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('records a single command log entry for the batch', async () => {
        registerCreateCommand();

        await batch(
            [
                { op: 'task.create', args: { name: 'First' } },
                { op: 'task.create', args: { name: 'Second' } },
            ],
            { projectId, gantt: {} }
        );

        expect(getCommandLog({ limit: 1 })).toEqual([
            expect.objectContaining({
                name: 'batch',
                args: { steps: 2 },
                ok: true,
                rev: 1,
                ms: expect.any(Number),
            }),
        ]);
    });
});
