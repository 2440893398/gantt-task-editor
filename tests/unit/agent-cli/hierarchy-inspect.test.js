import { describe, expect, it } from 'vitest';
import { inspectHierarchy } from '../../../src/features/gantt/domain/hierarchy-context.js';

function createGantt(tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const children = (parent) =>
        tasks.filter((task) => task.parent === parent).map((task) => task.id);
    return {
        getTask: (id) => byId.get(id),
        getChildren: children,
        getPrevSibling(id) {
            const task = byId.get(id);
            const siblings = children(task.parent);
            const index = siblings.indexOf(id);
            return index > 0 ? siblings[index - 1] : null;
        },
        getNextSibling(id) {
            const task = byId.get(id);
            const siblings = children(task.parent);
            const index = siblings.indexOf(id);
            return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
        },
    };
}

describe('hierarchy context discovery', () => {
    it('returns ancestors, siblings, children, and available operations', () => {
        const gantt = createGantt([
            { id: 1, text: 'Root', parent: 0 },
            { id: 2, text: 'Parent', parent: 1 },
            { id: 3, text: 'Target', parent: 2 },
            { id: 4, text: 'Sibling', parent: 2 },
            { id: 5, text: 'Child', parent: 3 },
        ]);

        expect(inspectHierarchy({ taskId: 3, depth: 1, gantt })).toEqual({
            task: { id: 3, text: 'Target', parent: 2 },
            ancestors: [
                { id: 1, text: 'Root', parent: 0 },
                { id: 2, text: 'Parent', parent: 1 },
            ],
            children: [{ id: 5, text: 'Child', parent: 3 }],
            previousSibling: null,
            nextSibling: { id: 4, text: 'Sibling', parent: 2 },
            siblingIndex: 0,
            canIndent: false,
            canOutdent: true,
        });
    });

    it('bounds descendant disclosure to the requested depth', () => {
        const gantt = createGantt([
            { id: 1, text: 'Target', parent: 0 },
            { id: 2, text: 'Child', parent: 1 },
            { id: 3, text: 'Grandchild', parent: 2 },
            { id: 4, text: 'Great-grandchild', parent: 3 },
        ]);

        expect(inspectHierarchy({ taskId: 1, depth: 0, gantt }).children).toEqual([]);
        expect(inspectHierarchy({ taskId: 1, depth: 1, gantt }).children).toEqual([
            { id: 2, text: 'Child', parent: 1 },
        ]);
        expect(inspectHierarchy({ taskId: 1, depth: 2, gantt }).children).toEqual([
            {
                id: 2,
                text: 'Child',
                parent: 1,
                children: [{ id: 3, text: 'Grandchild', parent: 2 }],
            },
        ]);
        expect(JSON.stringify(inspectHierarchy({ taskId: 1, depth: 2, gantt }))).not.toContain(
            'Great-grandchild'
        );
    });
});
