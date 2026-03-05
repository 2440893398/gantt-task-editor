import { describe, expect, it, vi } from 'vitest';

import {
    renderTaskDiffSummaryCard,
    __test__
} from '../../../../src/features/ai/components/DiffConfirmModal.js';

const {
    normalizeDiffPayload,
    reconcileRowsWithExistingTasks,
    setNodeInclude,
    countIncludedRows,
    applySelectedChanges
} = __test__;

describe('DiffConfirmModal helpers', () => {
    it('normalizes payload and builds nested rows with op counts', () => {
        const payload = {
            type: 'task_diff',
            source: 'import.xlsx',
            changes: [
                { op: 'add', taskId: 'temp-parent', data: { text: '父任务' } },
                { op: 'add', taskId: 'temp-child', parentIndex: 0, data: { text: '子任务' } },
                { op: 'update', taskId: '200', data: { text: '更新标题' } },
                { op: 'delete', taskId: '300', data: { text: '删除项' } }
            ]
        };

        const normalized = normalizeDiffPayload(payload);

        expect(normalized.isValid).toBe(true);
        expect(normalized.counts).toEqual({ add: 2, update: 1, delete: 1 });
        expect(normalized.flatRows).toHaveLength(4);

        const parent = normalized.flatRows.find((row) => row.taskId === 'temp-parent');
        const child = normalized.flatRows.find((row) => row.taskId === 'temp-child');

        expect(parent).toBeTruthy();
        expect(child).toBeTruthy();
        expect(child.level).toBe(1);
        expect(child.parentNodeId).toBe(parent.nodeId);
    });

    it('handles include toggles deterministically for parent and child rows', () => {
        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                { op: 'add', taskId: 'p', data: { text: '父' } },
                { op: 'add', taskId: 'c', parentIndex: 0, data: { text: '子' } }
            ]
        });

        const parent = normalized.flatRows.find((row) => row.taskId === 'p');
        const child = normalized.flatRows.find((row) => row.taskId === 'c');

        expect(countIncludedRows(normalized.flatRows)).toBe(2);

        setNodeInclude(normalized.flatRows, parent.nodeId, false);
        expect(parent.include).toBe(false);
        expect(child.include).toBe(false);

        expect(() => setNodeInclude(normalized.flatRows, child.nodeId, true)).not.toThrow();
        expect(parent.include).toBe(false);
        expect(child.include).toBe(true);
        expect(countIncludedRows(normalized.flatRows)).toBe(1);
    });

    it('applies add/update/delete with undo snapshots and nested ordering', () => {
        const taskStore = {
            u1: { id: 'u1', text: '旧标题', progress: 0.1 },
            d1: { id: 'd1', text: '父删除项' },
            d2: { id: 'd2', text: '子删除项', parent: 'd1' }
        };

        const ganttMock = {
            getTask: vi.fn((id) => taskStore[id] || null),
            isTaskExists: vi.fn((id) => Boolean(taskStore[id])),
            addTask: vi.fn((data, parent) => {
                const id = data.id || `new-${Object.keys(taskStore).length}`;
                taskStore[id] = { ...data, id, parent };
                return id;
            }),
            updateTask: vi.fn((id) => id),
            deleteTask: vi.fn((id) => {
                delete taskStore[id];
            })
        };

        const undoManagerMock = {
            saveAddState: vi.fn(),
            saveState: vi.fn(),
            saveDeleteState: vi.fn()
        };

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                { op: 'add', taskId: 'tmp-parent', data: { id: 'new-parent', text: '新父任务' } },
                { op: 'add', taskId: 'tmp-child', parentIndex: 0, data: { id: 'new-child', text: '新子任务' } },
                { op: 'update', taskId: 'u1', data: { text: '新标题', progress: 0.4 } },
                { op: 'delete', taskId: 'd1', data: { text: '父删除项' } },
                { op: 'delete', taskId: 'd2', parentId: 'd1', data: { text: '子删除项' } }
            ]
        });

        const result = applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi: undoManagerMock
        });

        expect(result.ok).toBe(true);
        expect(result.applied).toEqual({ add: 2, update: 1, delete: 2, skipped: 0, failed: 0 });

        expect(ganttMock.addTask).toHaveBeenCalledTimes(2);
        expect(ganttMock.addTask).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ id: 'new-parent', text: '新父任务' }),
            0
        );
        expect(ganttMock.addTask).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ id: 'new-child', text: '新子任务' }),
            'new-parent'
        );

        expect(undoManagerMock.saveAddState).toHaveBeenNthCalledWith(1, 'new-parent');
        expect(undoManagerMock.saveAddState).toHaveBeenNthCalledWith(2, 'new-child');
        expect(undoManagerMock.saveState).toHaveBeenCalledWith('u1');
        expect(ganttMock.updateTask).toHaveBeenCalledWith('u1');

        expect(undoManagerMock.saveDeleteState).toHaveBeenNthCalledWith(1, 'd2');
        expect(undoManagerMock.saveDeleteState).toHaveBeenNthCalledWith(2, 'd1');
        expect(ganttMock.deleteTask).toHaveBeenNthCalledWith(1, 'd2');
        expect(ganttMock.deleteTask).toHaveBeenNthCalledWith(2, 'd1');
    });

    it('reconciles add rows to update when matching task already exists', () => {
        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                {
                    op: 'add',
                    data: {
                        text: '已有任务',
                        start_date: '2026-03-02',
                        end_date: '2026-03-04',
                        assignee: '张三'
                    }
                }
            ]
        });

        const ganttMock = {
            eachTask: vi.fn((cb) => {
                cb({
                    id: 101,
                    text: '已有任务',
                    start_date: '2026-03-02',
                    end_date: '2026-03-04',
                    assignee: '张三'
                });
            }),
            isTaskExists: vi.fn(() => true)
        };

        const reconciled = reconcileRowsWithExistingTasks(normalized, { ganttApi: ganttMock });

        expect(reconciled.counts).toEqual({ add: 0, update: 1, delete: 0 });
        expect(reconciled.flatRows[0].op).toBe('update');
        expect(reconciled.flatRows[0].reconciledFromAdd).toBe(true);
    });

    it('renders summary counts after reconciling existing tasks', () => {
        const ganttMock = {
            eachTask: vi.fn((cb) => {
                cb({
                    id: '1001',
                    text: '陈龙龙的工时',
                    start_date: '2026-02-02',
                    end_date: '2026-02-13',
                    assignee: '张三'
                });
            }),
            isTaskExists: vi.fn(() => false)
        };

        const html = renderTaskDiffSummaryCard({
            type: 'task_diff',
            source: 'gantt-tasks-2026-03-02.xlsx',
            changes: [
                {
                    op: 'add',
                    data: {
                        text: '陈龙龙的工时',
                        start_date: '2026-02-02',
                        end_date: '2026-02-13',
                        assignee: '张三'
                    }
                }
            ]
        }, { ganttApi: ganttMock });

        expect(html).toMatch(/新增\s*0/);
        expect(html).toMatch(/修改\s*1/);
    });

    it('upserts when add row target already exists', () => {
        const taskStore = {
            existing: { id: 'existing', text: '旧值', priority: 'low' }
        };

        const ganttMock = {
            getTask: vi.fn((id) => taskStore[id] || null),
            isTaskExists: vi.fn((id) => Boolean(taskStore[id])),
            eachTask: vi.fn((cb) => cb(taskStore.existing)),
            addTask: vi.fn(() => 'new-task-id'),
            updateTask: vi.fn((id) => id),
            deleteTask: vi.fn()
        };

        const undoManagerMock = {
            saveAddState: vi.fn(),
            saveState: vi.fn(),
            saveDeleteState: vi.fn()
        };

        const normalized = normalizeDiffPayload({
            type: 'task_diff',
            changes: [
                {
                    op: 'add',
                    taskId: 'existing',
                    data: { id: 'existing', text: '新值', priority: 'high' }
                }
            ]
        });

        const result = applySelectedChanges(normalized.flatRows, {
            ganttApi: ganttMock,
            undoApi: undoManagerMock
        });

        expect(result.ok).toBe(true);
        expect(result.applied).toEqual({ add: 0, update: 1, delete: 0, skipped: 0, failed: 0 });
        expect(ganttMock.addTask).not.toHaveBeenCalled();
        expect(undoManagerMock.saveState).toHaveBeenCalledWith('existing');
        expect(ganttMock.updateTask).toHaveBeenCalledWith('existing');
        expect(taskStore.existing.text).toBe('新值');
    });
});
