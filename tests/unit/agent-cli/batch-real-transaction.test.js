import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCommandsForTest, defineCommand } from '../../../src/features/agent-cli/registry.js';
import { registerTaskCommands } from '../../../src/features/agent-cli/commands/task.js';
import { registerHierarchyCommands } from '../../../src/features/agent-cli/commands/hierarchy.js';
import { batch } from '../../../src/features/agent-cli/runtime/dispatch.js';
import { getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';
import * as undoManager from '../../../src/features/gantt/history/undoManager.js';

// IMPORTANT: do NOT mock transaction.js here — this suite exercises the REAL
// runGanttTransaction rollback path. Only persistence is stubbed.
vi.mock('../../../src/features/gantt/domain/settle.js', () => ({
    settleAndPersist: vi.fn(),
}));

const { settleAndPersist } = await import('../../../src/features/gantt/domain/settle.js');

const projectId = 'batch-real-transaction-test';
const schemaRev = 'schema-test-rev';

function createBatchContext(gantt, overrides = {}) {
    return {
        projectId,
        gantt,
        schemaRev,
        getSchemaRev: () => schemaRev,
        ...overrides,
    };
}

const ORIGINAL_SNAPSHOT = Object.freeze({ data: [{ id: 1, text: 'Before' }], links: [] });

/**
 * A fake gantt that satisfies BOTH the transaction primitives
 * (serialize/clearAll/parse/render) AND the task-ops + undoManager needs
 * (addTask/getTask), so the real create commit pushes onto the undo stack.
 */
function createGantt() {
    const taskMap = new Map();
    let nextId = 100;

    return {
        serialize: vi.fn(() => ORIGINAL_SNAPSHOT),
        clearAll: vi.fn(() => taskMap.clear()),
        parse: vi.fn(),
        render: vi.fn(),
        addTask: vi.fn((task, parent) => {
            const id = task.id ?? nextId++;
            taskMap.set(id, { ...task, id, parent: parent ?? task.parent ?? 0 });
            return id;
        }),
        getTask: vi.fn((id) => {
            const task = taskMap.get(id);
            if (!task) {
                throw new Error(`Task not found: ${id}`);
            }
            return task;
        }),
        getChildren: vi.fn((parent) =>
            [...taskMap.values()].filter((task) => task.parent === parent).map((task) => task.id)
        ),
        moveTask: vi.fn((id, _index, parent) => {
            const task = taskMap.get(id);
            if (task) {
                task.parent = parent;
            }
        }),
        updateTask: vi.fn(),
    };
}

describe('agent batch with real transaction rollback', () => {
    beforeEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        undoManager.clearHistory();
        vi.clearAllMocks();
    });

    afterEach(() => {
        clearCommandsForTest();
        resetProjectRev(projectId);
        undoManager.clearHistory();
        delete globalThis.gantt;
    });

    it('rolls back gantt data and leaves the undo stack untouched when a later step throws', async () => {
        const gantt = createGantt();
        // undoManager's save* helpers read the GLOBAL gantt, not ctx.gantt.
        globalThis.gantt = gantt;

        // Real task.create for step 1 (commits + pushes an add snapshot onto the
        // undo stack). A throwing op for step 2 to trigger rollback.
        registerTaskCommands();
        defineCommand({
            name: 'task.boom',
            summary: 'Throwing commit',
            params: { type: 'object', properties: {}, additionalProperties: false },
            mutating: true,
            op: {
                plan: vi.fn(() => ({
                    diff: {
                        created: [],
                        updated: [],
                        deleted: [],
                        links: { added: [], removed: [] },
                    },
                })),
                commit: vi.fn(() => {
                    throw new Error('step two failed');
                }),
            },
        });

        const restoreSpy = vi.spyOn(undoManager, 'restoreHistoryForTransaction');
        const undoSizeBeforeBatch = undoManager.getUndoStackSize();
        expect(undoSizeBeforeBatch).toBe(0);

        const result = await batch(
            [
                {
                    op: 'task.create',
                    as: 'root',
                    args: { values: { text: 'Parent', assignee: 'Ada' } },
                },
                { op: 'task.boom', args: {} },
            ],
            createBatchContext(gantt)
        );

        // 1. Failure carries the thrown error and the pre-batch rev.
        expect(result).toEqual({
            ok: false,
            error: {
                code: 'EXEC_ERROR',
                message: 'step two failed',
                stepIndex: 1,
                op: 'task.boom',
            },
            rev: 0,
        });

        // 2. No partial state: the real transaction restored the ORIGINAL snapshot,
        //    proving step 1's create did not survive.
        expect(gantt.clearAll).toHaveBeenCalledTimes(1);
        expect(gantt.parse).toHaveBeenCalledTimes(1);
        expect(gantt.parse).toHaveBeenCalledWith(ORIGINAL_SNAPSHOT);
        expect(gantt.render).toHaveBeenCalledTimes(1);

        // 3. Undo stack untouched: the create pushed a snapshot mid-transaction,
        //    but rollback restored the stack, so its size matches the pre-batch state.
        expect(restoreSpy).toHaveBeenCalledTimes(1);
        expect(undoManager.getUndoStackSize()).toBe(undoSizeBeforeBatch);

        // 4. No settle, no rev bump.
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });

    it('resolves forward $ref to real committed ids through real execution', async () => {
        const gantt = createGantt();
        globalThis.gantt = gantt;
        registerTaskCommands();
        registerHierarchyCommands();

        const result = await batch(
            [
                {
                    op: 'task.create',
                    as: 'root',
                    args: { values: { text: 'Parent', assignee: 'Ada' } },
                },
                {
                    op: 'task.create',
                    as: 'child',
                    args: { values: { text: 'Child', assignee: 'Ada' } },
                },
                { op: 'hierarchy.move', args: { id: '$child', parent: '$root' } },
            ],
            createBatchContext(gantt)
        );

        expect(result.ok).toBe(true);
        // Two creates assign ids 100 and 101 from the fake gantt.
        const rootId = 100;
        const childId = 101;
        // hierarchy.move's commit must receive the RESOLVED numeric ids, not $ strings.
        expect(gantt.moveTask).toHaveBeenCalledTimes(1);
        const [movedId, , movedParent] = gantt.moveTask.mock.calls[0];
        expect(movedId).toBe(childId);
        expect(movedParent).toBe(rootId);
        // The child ended up under the parent.
        expect(gantt.getTask(childId).parent).toBe(rootId);

        // Exactly one settle and one rev bump for the whole batch.
        expect(settleAndPersist).toHaveBeenCalledTimes(1);
        expect(result.rev).toBe(1);
        expect(getProjectRev(projectId)).toBe(1);
    });

    it('previews independent steps and defers ref-dependent ones in real dry-run', async () => {
        const gantt = createGantt();
        globalThis.gantt = gantt;
        registerTaskCommands();
        registerHierarchyCommands();

        const result = await batch(
            [
                {
                    op: 'task.create',
                    as: 'root',
                    args: { values: { text: 'Parent', assignee: 'Ada' } },
                },
                {
                    op: 'task.create',
                    as: 'child',
                    args: { values: { text: 'Child', assignee: 'Ada' } },
                },
                { op: 'hierarchy.move', args: { id: '$child', parent: '$root' } },
            ],
            createBatchContext(gantt, { dryRun: true })
        );

        expect(result.ok).toBe(true);
        expect(result.rev).toBe(0);
        // Two independent creates are previewed; the move is deferred.
        expect(result.data.diff.created).toHaveLength(2);
        expect(result.data.diff.updated).toEqual([]);
        expect(result.warnings).toEqual([expect.stringContaining('hierarchy.move')]);
        // Nothing mutated.
        expect(gantt.addTask).not.toHaveBeenCalled();
        expect(gantt.moveTask).not.toHaveBeenCalled();
        expect(settleAndPersist).not.toHaveBeenCalled();
        expect(getProjectRev(projectId)).toBe(0);
    });
});
