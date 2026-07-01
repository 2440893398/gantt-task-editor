import { describe, expect, it, vi } from 'vitest';
import { taskOps } from '../../../../src/features/gantt/domain/task-ops.js';

function createGantt(tasks = []) {
    const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));

    return {
        addTask: vi.fn((task, parent) => {
            const id = task.id ?? 100;
            taskMap.set(id, { ...task, id, parent: parent ?? task.parent ?? 0 });
            return id;
        }),
        deleteTask: vi.fn((id) => {
            taskMap.delete(id);
        }),
        getTask: vi.fn((id) => {
            const task = taskMap.get(id);
            if (!task) {
                throw new Error('Task not found');
            }
            return task;
        }),
        getChildren: vi.fn((id) =>
            [...taskMap.values()].filter((task) => task.parent === id).map((task) => task.id)
        ),
        updateTask: vi.fn(),
    };
}

function createUndoManager() {
    return {
        saveAddState: vi.fn(),
        saveState: vi.fn(),
        saveDeleteState: vi.fn(),
        saveDeleteBatchState: vi.fn(),
    };
}

describe('task ops', () => {
    it('plans task creation without adding a task', () => {
        const gantt = createGantt();

        const plan = taskOps.create.plan(
            { name: 'Write spec', parent: 7, start: '2026-07-01', duration: 3 },
            { gantt }
        );

        expect(plan.diff.created).toEqual([
            expect.objectContaining({
                text: 'Write spec',
                parent: 7,
                start_date: '2026-07-01',
                duration: 3,
            }),
        ]);
        expect(gantt.addTask).not.toHaveBeenCalled();
    });

    it('commits task creation by adding a task', () => {
        const gantt = createGantt();
        const undoManager = createUndoManager();
        const plan = taskOps.create.plan({ name: 'Build task', parent: 2 }, { gantt });

        const result = taskOps.create.commit(plan, { gantt, undoManager });

        expect(gantt.addTask).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'Build task' }),
            2
        );
        expect(undoManager.saveAddState).toHaveBeenCalledWith(100);
        expect(result).toEqual(expect.objectContaining({ id: 100 }));
    });

    it('commits task creation with date-only start as a local Date', () => {
        const gantt = createGantt();
        const undoManager = createUndoManager();
        const plan = taskOps.create.plan({ name: 'Dated task', start: '2026-07-01' }, { gantt });

        taskOps.create.commit(plan, { gantt, undoManager });

        const task = gantt.addTask.mock.calls[0][0];
        expect(task.start_date).toBeInstanceOf(Date);
        expect(task.start_date.getFullYear()).toBe(2026);
        expect(task.start_date.getMonth()).toBe(6);
        expect(task.start_date.getDate()).toBe(1);
    });

    it('plans task updates with old and new field values', () => {
        const gantt = createGantt([{ id: 4, text: 'Old name', duration: 2, progress: 0.1 }]);

        const plan = taskOps.update.plan({ id: 4, name: 'New name', duration: 5 }, { gantt });

        expect(plan.diff.updated).toEqual([
            {
                id: 4,
                fields: {
                    text: { old: 'Old name', new: 'New name' },
                    duration: { old: 2, new: 5 },
                },
            },
        ]);
    });

    it('commits task updates with date-only start and end as local Dates', () => {
        const gantt = createGantt([{ id: 4, text: 'Old name', start_date: null, end_date: null }]);
        const undoManager = createUndoManager();
        const plan = taskOps.update.plan(
            { id: 4, start: '2026-07-01', end: '2026-07-03' },
            { gantt }
        );

        taskOps.update.commit(plan, { gantt, undoManager });

        const task = gantt.getTask(4);
        expect(task.start_date).toBeInstanceOf(Date);
        expect(task.start_date.getFullYear()).toBe(2026);
        expect(task.start_date.getMonth()).toBe(6);
        expect(task.start_date.getDate()).toBe(1);
        expect(task.end_date).toBeInstanceOf(Date);
        expect(task.end_date.getFullYear()).toBe(2026);
        expect(task.end_date.getMonth()).toBe(6);
        expect(task.end_date.getDate()).toBe(3);
    });

    it('plans same local-day date-only task updates as no-ops', () => {
        const gantt = createGantt([
            {
                id: 4,
                text: 'Dated task',
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
            },
        ]);

        const plan = taskOps.update.plan(
            { id: 4, start: '2026-07-01', end: '2026-07-03' },
            { gantt }
        );

        expect(plan.changes).toEqual({});
        expect(plan.diff.updated).toEqual([]);
    });

    it('plans cascade deletion with all descendant ids', () => {
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Child A', parent: 1 },
            { id: 3, text: 'Child B', parent: 1 },
            { id: 4, text: 'Grandchild', parent: 2 },
        ]);

        const plan = taskOps.delete.plan({ id: 1, cascade: true }, { gantt });

        expect(plan.diff.deleted.map((task) => task.id)).toEqual([1, 2, 4, 3]);
        expect(gantt.deleteTask).not.toHaveBeenCalled();
    });

    it('plans default non-leaf deletion with all ids Gantt will delete', () => {
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Child A', parent: 1 },
            { id: 3, text: 'Child B', parent: 1 },
        ]);

        const plan = taskOps.delete.plan({ id: 1 }, { gantt });

        expect(plan.ids).toEqual([1, 2, 3]);
        expect(plan.diff.deleted.map((task) => task.id)).toEqual([1, 2, 3]);
        expect(gantt.deleteTask).not.toHaveBeenCalled();
    });

    it('saves cascade deletion as a single command-level undo snapshot', () => {
        const gantt = createGantt([
            { id: 1, text: 'Parent', parent: 0 },
            { id: 2, text: 'Child A', parent: 1 },
            { id: 3, text: 'Child B', parent: 1 },
            { id: 4, text: 'Grandchild', parent: 2 },
        ]);
        const undoManager = createUndoManager();
        const plan = taskOps.delete.plan({ id: 1, cascade: true }, { gantt });

        taskOps.delete.commit(plan, { gantt, undoManager });

        expect(undoManager.saveDeleteBatchState).toHaveBeenCalledWith([1, 2, 4, 3]);
        expect(undoManager.saveDeleteState).not.toHaveBeenCalled();
        expect(gantt.deleteTask).toHaveBeenCalledWith(1);
    });
});
