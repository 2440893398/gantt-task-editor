import { afterEach, describe, expect, test, vi } from 'vitest';
import Sortable from 'sortablejs';
import undoManager from '../../../src/features/ai/services/undoManager.js';
import { state } from '../../../src/core/store.js';

vi.mock('sortablejs', () => ({
    default: {
        create: vi.fn(),
    },
}));

vi.mock('../../../src/core/store.js', () => ({
    state: {
        sortableInstance: null,
    },
}));

vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        isApplyingHistoryOperation: vi.fn(() => false),
        saveReorderState: vi.fn(),
    },
}));

import {
    initRowSortable,
    wouldCreateHierarchyCycle,
} from '../../../src/features/gantt/row-reorder.js';

function setupGantt({ tasks, links = [] }) {
    const taskMap = new Map(Object.entries(tasks));

    vi.stubGlobal('gantt', {
        getTask: vi.fn((id) => taskMap.get(String(id))),
        getLinks: vi.fn(() => links),
    });
}

describe('row reorder hierarchy guard', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        state.sortableInstance = null;
    });

    test('rejects moving a task under itself', () => {
        setupGantt({
            tasks: {
                parent: { id: 'parent', parent: 0 },
            },
        });

        expect(wouldCreateHierarchyCycle('parent', 'parent')).toBe(true);
    });

    test('rejects moving a parent under its child', () => {
        setupGantt({
            tasks: {
                parent: { id: 'parent', parent: 0 },
                child: { id: 'child', parent: 'parent' },
            },
        });

        expect(wouldCreateHierarchyCycle('parent', 'child')).toBe(true);
    });

    test('rejects moving a parent under a nested descendant', () => {
        setupGantt({
            tasks: {
                parent: { id: 'parent', parent: 0 },
                child: { id: 'child', parent: 'parent' },
                grandchild: { id: 'grandchild', parent: 'child' },
            },
        });

        expect(wouldCreateHierarchyCycle('parent', 'grandchild')).toBe(true);
    });

    test('allows moving under a sibling or root', () => {
        setupGantt({
            tasks: {
                parent: { id: 'parent', parent: 0 },
                sibling: { id: 'sibling', parent: 0 },
            },
        });

        expect(wouldCreateHierarchyCycle('parent', 'sibling')).toBe(false);
        expect(wouldCreateHierarchyCycle('parent', 0)).toBe(false);
    });

    test('keeps the linked downstream parent-path guard', () => {
        setupGantt({
            tasks: {
                parent: { id: 'parent', parent: 0 },
                downstream: { id: 'downstream', parent: 0 },
                downstreamChild: { id: 'downstreamChild', parent: 'downstream' },
            },
            links: [{ source: 'parent', target: 'downstream' }],
        });

        expect(wouldCreateHierarchyCycle('parent', 'downstreamChild')).toBe(true);
    });
});

describe('row reorder move position', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        document.body.innerHTML = '';
        state.sortableInstance = null;
    });

    test('moves task #2 before task #1 within the same parent', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="2"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            2: { id: '2', parent: '1' },
            3: { id: '3', parent: '1' },
        };
        const gridData = document.querySelector('.gantt_grid_data');

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn((id) => String(id) === '1'),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        const draggedRow = gridData.querySelector('[task_id="3"]');

        sortableOptions.onEnd({
            item: draggedRow,
            oldIndex: 2,
            newIndex: 1,
        });

        expect(gantt.moveTask).toHaveBeenCalledWith('3', 0, '1');
        expect(gantt.render).toHaveBeenCalled();
        expect(undoManager.saveReorderState).not.toHaveBeenCalled();
    });

    test('drops a task onto a parent row as its first child', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="2"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            2: { id: '2', parent: '1' },
            3: { id: '3', parent: 0 },
        };
        const gridData = document.querySelector('.gantt_grid_data');
        const parentRow = gridData.querySelector('[task_id="1"]');
        const draggedRow = gridData.querySelector('[task_id="3"]');

        parentRow.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            height: 40,
        }));

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn((id) => String(id) === '1'),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        sortableOptions.onMove({
            dragged: draggedRow,
            related: parentRow,
            willInsertAfter: false,
            originalEvent: { clientY: 120 },
        });

        expect(parentRow.classList.contains('row-drop-indicator-child')).toBe(true);

        sortableOptions.onEnd({
            item: draggedRow,
            oldIndex: 1,
            newIndex: 1,
        });

        expect(gantt.moveTask).toHaveBeenCalledWith('3', 0, '1');
        expect(gantt.render).toHaveBeenCalled();
    });

    test('uses a line indicator at the top edge of a parent row', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            3: { id: '3', parent: 0 },
        };
        const gridData = document.querySelector('.gantt_grid_data');
        const parentRow = gridData.querySelector('[task_id="1"]');
        const draggedRow = gridData.querySelector('[task_id="3"]');

        parentRow.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            height: 40,
        }));

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn((id) => String(id) === '1'),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        sortableOptions.onMove({
            dragged: draggedRow,
            related: parentRow,
            willInsertAfter: false,
            originalEvent: { clientY: 104 },
        });

        expect(parentRow.classList.contains('row-drop-indicator-before')).toBe(true);
        expect(parentRow.classList.contains('row-drop-indicator-child')).toBe(false);
    });

    test('drops onto a leaf task and makes it a parent', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="2"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            2: { id: '2', parent: 0 },
            3: { id: '3', parent: 0 },
        };
        const gridData = document.querySelector('.gantt_grid_data');
        const leafRow = gridData.querySelector('[task_id="2"]');
        const draggedRow = gridData.querySelector('[task_id="3"]');

        leafRow.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            height: 40,
        }));

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn(() => false),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        sortableOptions.onMove({
            dragged: draggedRow,
            related: leafRow,
            willInsertAfter: false,
            originalEvent: { clientY: 124 },
        });

        expect(leafRow.classList.contains('row-drop-indicator-child')).toBe(true);

        sortableOptions.onEnd({
            item: draggedRow,
            oldIndex: 2,
            newIndex: 1,
        });

        expect(gantt.moveTask).toHaveBeenCalledWith('3', 0, '2');
        expect(gantt.render).toHaveBeenCalled();
    });

    test('promotes a child task to root when dropped before a root sibling', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="2"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            2: { id: '2', parent: '1' },
            3: { id: '3', parent: 0 },
        };
        const gridData = document.querySelector('.gantt_grid_data');
        const targetRow = gridData.querySelector('[task_id="3"]');
        const draggedRow = gridData.querySelector('[task_id="2"]');

        targetRow.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            height: 40,
        }));

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn((id) => String(id) === '1'),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        sortableOptions.onMove({
            dragged: draggedRow,
            related: targetRow,
            willInsertAfter: false,
            originalEvent: { clientY: 104 },
        });

        sortableOptions.onEnd({
            item: draggedRow,
            oldIndex: 1,
            newIndex: 2,
        });

        expect(gantt.moveTask).toHaveBeenCalledWith('2', 1, 0);
        expect(gantt.render).toHaveBeenCalled();
    });

    test('keeps target parent when inserting after a child row', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="2"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="4"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            2: { id: '2', parent: '1' },
            3: { id: '3', parent: 0 },
            4: { id: '4', parent: '1' },
        };
        const gridData = document.querySelector('.gantt_grid_data');
        const targetRow = gridData.querySelector('[task_id="2"]');
        const draggedRow = gridData.querySelector('[task_id="4"]');

        targetRow.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            height: 40,
        }));

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn((id) => String(id) === '1'),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        sortableOptions.onMove({
            dragged: draggedRow,
            related: targetRow,
            willInsertAfter: true,
            originalEvent: { clientY: 102 },
        });

        sortableOptions.onEnd({
            item: draggedRow,
            oldIndex: 2,
            newIndex: 2,
        });

        expect(gantt.moveTask).toHaveBeenCalledWith('4', 1, '1');
        expect(gantt.render).toHaveBeenCalled();
    });

    test('inserts after a root row without making it a child', () => {
        document.body.innerHTML = `
            <div class="gantt_grid_data">
                <div class="gantt_row" task_id="1"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="2"><span class="gantt-drag-handle"></span></div>
                <div class="gantt_row" task_id="3"><span class="gantt-drag-handle"></span></div>
            </div>
        `;

        const tasks = {
            1: { id: '1', parent: 0 },
            2: { id: '2', parent: 0 },
            3: { id: '3', parent: 0 },
        };
        const gridData = document.querySelector('.gantt_grid_data');
        const targetRow = gridData.querySelector('[task_id="1"]');
        const draggedRow = gridData.querySelector('[task_id="3"]');

        targetRow.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            height: 40,
        }));

        vi.stubGlobal('gantt', {
            $grid_data: gridData,
            getTask: vi.fn((id) => tasks[String(id)]),
            getLinks: vi.fn(() => []),
            hasChild: vi.fn(() => false),
            moveTask: vi.fn(),
            render: vi.fn(),
        });

        initRowSortable();

        const sortableOptions = Sortable.create.mock.calls[0][1];
        sortableOptions.onMove({
            dragged: draggedRow,
            related: targetRow,
            willInsertAfter: true,
            originalEvent: { clientY: 138 },
        });

        expect(targetRow.classList.contains('row-drop-indicator-after')).toBe(true);

        sortableOptions.onEnd({
            item: draggedRow,
            oldIndex: 2,
            newIndex: 1,
        });

        expect(gantt.moveTask).toHaveBeenCalledWith('3', 1, 0);
        expect(gantt.render).toHaveBeenCalled();
    });
});
