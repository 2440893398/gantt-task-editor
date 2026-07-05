import { describe, expect, it, vi } from 'vitest';
import { hierarchyOps } from '../../../../src/features/gantt/domain/hierarchy-ops.js';

function createGantt(tasks = []) {
    const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));

    function getSiblings(parent) {
        return [...taskMap.values()].filter((task) => String(task.parent ?? 0) === String(parent));
    }

    return {
        moveTask: vi.fn((id, index, parent) => {
            const task = taskMap.get(id);
            task.parent = parent;
            task.$index = index;
        }),
        getTask: vi.fn((id) => {
            const task = taskMap.get(id);
            if (!task) {
                throw new Error('Task not found');
            }
            return task;
        }),
        getChildren: vi.fn((id) => getSiblings(id).map((task) => task.id)),
        getPrevSibling: vi.fn((id) => {
            const task = taskMap.get(id);
            const siblings = getSiblings(task.parent ?? 0);
            const index = siblings.findIndex((sibling) => sibling.id === id);
            return index > 0 ? siblings[index - 1].id : null;
        }),
        getNextSibling: vi.fn((id) => {
            const task = taskMap.get(id);
            const siblings = getSiblings(task.parent ?? 0);
            const index = siblings.findIndex((sibling) => sibling.id === id);
            return index >= 0 && index < siblings.length - 1 ? siblings[index + 1].id : null;
        }),
        updateTask: vi.fn(),
        getTaskSnapshot(id) {
            return { ...taskMap.get(id) };
        },
    };
}

describe('hierarchy ops', () => {
    it('plans and commits moving a task to a new parent and index', () => {
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Move me', parent: 0 },
        ]);

        const plan = hierarchyOps.move.plan({ id: 2, parent: 1, index: 0 }, { gantt });

        expect(plan.diff.updated).toEqual([
            {
                id: 2,
                fields: {
                    parent: { old: 0, new: 1 },
                    index: { old: 1, new: 0 },
                },
            },
        ]);
        expect(gantt.moveTask).not.toHaveBeenCalled();

        hierarchyOps.move.commit(plan, { gantt });

        expect(gantt.moveTask).toHaveBeenCalledWith(2, 0, 1);
        expect(gantt.updateTask).toHaveBeenCalledWith(2);
        expect(gantt.getTaskSnapshot(2)).toMatchObject({ parent: 1, $index: 0 });
    });

    it('indents a task under its previous sibling', () => {
        const gantt = createGantt([
            { id: 1, text: 'Previous', parent: 0 },
            { id: 2, text: 'Indent me', parent: 0 },
        ]);

        const plan = hierarchyOps.indent.plan({ id: 2 }, { gantt });

        expect(plan.diff.updated).toEqual([
            {
                id: 2,
                fields: {
                    parent: { old: 0, new: 1 },
                    index: { old: 1, new: 0 },
                },
            },
        ]);

        hierarchyOps.indent.commit(plan, { gantt });

        expect(gantt.moveTask).toHaveBeenCalledWith(2, 0, 1);
    });

    it('outdents a task to its parent sibling level', () => {
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Outdent me', parent: 1 },
            { id: 3, text: 'After parent', parent: 0 },
        ]);

        const plan = hierarchyOps.outdent.plan({ id: 2 }, { gantt });

        expect(plan.diff.updated).toEqual([
            {
                id: 2,
                fields: {
                    parent: { old: 1, new: 0 },
                    index: { old: 0, new: 1 },
                },
            },
        ]);

        hierarchyOps.outdent.commit(plan, { gantt });

        expect(gantt.moveTask).toHaveBeenCalledWith(2, 1, 0);
    });

    it('rejects moving a task under itself or a descendant', () => {
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Child', parent: 1 },
            { id: 3, text: 'Grandchild', parent: 2 },
        ]);

        expect(hierarchyOps.move.plan({ id: 1, parent: 1 }, { gantt })).toEqual({
            ok: false,
            error: {
                code: 'CYCLE',
                message: 'Hierarchy move would create a cycle.',
                hint: 'Choose a parent outside the moved task subtree.',
            },
        });
        expect(hierarchyOps.move.plan({ id: 1, parent: 3 }, { gantt })).toEqual({
            ok: false,
            error: {
                code: 'CYCLE',
                message: 'Hierarchy move would create a cycle.',
                hint: 'Choose a parent outside the moved task subtree.',
            },
        });
        expect(gantt.moveTask).not.toHaveBeenCalled();
    });
});
