import { beforeEach, describe, expect, it, vi } from 'vitest';

let sortableOptions = null;

const destroyMock = vi.fn();
const saveReorderStateMock = vi.fn();
const isApplyingHistoryOperationMock = vi.fn(() => false);
const storeState = { sortableInstance: null };

vi.mock('sortablejs', () => ({
    default: {
        create: vi.fn((element, options) => {
            sortableOptions = options;
            return {
                destroy: destroyMock,
            };
        })
    }
}));

vi.mock('../../../src/core/store.js', () => ({
    state: storeState,
}));

vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        isApplyingHistoryOperation: isApplyingHistoryOperationMock,
        saveReorderState: saveReorderStateMock,
    }
}));

function createRow(taskId) {
    const row = document.createElement('div');
    row.className = 'gantt_row';
    row.setAttribute('task_id', String(taskId));
    row.innerHTML = '<span class="gantt-drag-handle">⠿</span>';
    return row;
}

describe('row reorder drop logic', () => {
    let tasks;
    let gridData;

    beforeEach(() => {
        vi.clearAllMocks();
        sortableOptions = null;
        storeState.sortableInstance = null;
        document.body.innerHTML = '';

        gridData = document.createElement('div');
        gridData.className = 'gantt_grid_data';
        gridData.append(createRow(1), createRow(2), createRow(3));
        document.body.appendChild(gridData);

        tasks = {
            '1': { id: '1', parent: 0, text: 'Project #1', $level: 0 },
            '2': { id: '2', parent: '1', text: 'Child #2', $level: 1 },
            '3': { id: '3', parent: 0, text: 'Root #3', $level: 0 },
        };

        global.gantt = {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)] || null),
            updateTask: vi.fn(),
            moveTask: vi.fn(),
            render: vi.fn(),
            hasChild: vi.fn((id) => String(id) === '1'),
            getChildren: vi.fn((id) => {
                if (String(id) === '1') return ['2'];
                return [];
            }),
            eachTask: vi.fn((callback) => {
                Object.values(tasks).forEach((task) => callback(task));
            }),
        };
    });

    it('uses gantt.moveTask to keep a root task as a sibling when dropped after a parent row', async () => {
        const { initRowSortable } = await import('../../../src/features/gantt/row-reorder.js');
        initRowSortable();

        const row2 = gridData.querySelector('[task_id="2"]');
        const row3 = gridData.querySelector('[task_id="3"]');
        gridData.insertBefore(row3, row2);

        sortableOptions.onEnd({
            item: row3,
            oldIndex: 2,
            newIndex: 1,
            originalEvent: { clientX: 100 },
        });

        expect(global.gantt.moveTask).toHaveBeenCalledWith('3', 1, 0);
        expect(tasks['3'].parent).toBe(0);
    });

    it('rejects dropping a task onto its own descendant and clears the drop indicator classes', async () => {
        const { initRowSortable } = await import('../../../src/features/gantt/row-reorder.js');
        initRowSortable();

        const row1 = gridData.querySelector('[task_id="1"]');
        const row2 = gridData.querySelector('[task_id="2"]');
        const row3 = gridData.querySelector('[task_id="3"]');

        sortableOptions.onStart({ originalEvent: { clientX: 100 } });
        sortableOptions.onMove({
            related: row2,
            willInsertAfter: true,
            originalEvent: { clientX: 150 },
        });

        gridData.insertBefore(row1, row3);

        sortableOptions.onEnd({
            item: row1,
            oldIndex: 0,
            newIndex: 1,
            originalEvent: { clientX: 150 },
        });

        expect(global.gantt.moveTask).not.toHaveBeenCalled();
        expect(tasks['1'].parent).toBe(0);
        expect(row2.classList.contains('row-drop-indicator-before')).toBe(false);
        expect(row2.classList.contains('row-drop-indicator-after')).toBe(false);
    });

    it('shows a child-intent indicator and keeps only one active drop marker at a time', async () => {
        const { initRowSortable } = await import('../../../src/features/gantt/row-reorder.js');
        initRowSortable();

        const row1 = gridData.querySelector('[task_id="1"]');
        const row2 = gridData.querySelector('[task_id="2"]');
        const row3 = gridData.querySelector('[task_id="3"]');

        sortableOptions.onStart({ item: row3, originalEvent: { clientX: 100 } });
        sortableOptions.onMove({
            dragged: row3,
            related: row1,
            willInsertAfter: false,
            originalEvent: { clientX: 140 },
        });

        expect(row1.classList.contains('row-drop-indicator-child')).toBe(true);
        expect(row1.classList.contains('row-drop-indicator-before')).toBe(false);
        expect(row1.classList.contains('row-drop-indicator-after')).toBe(false);

        sortableOptions.onMove({
            dragged: row3,
            related: row2,
            willInsertAfter: true,
            originalEvent: { clientX: 100 },
        });

        expect(row1.classList.contains('row-drop-indicator-child')).toBe(false);
        expect(row2.classList.contains('row-drop-indicator-after')).toBe(true);
    });
});
