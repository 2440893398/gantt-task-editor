import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../../src/features/gantt/columns.js');

vi.mock('../../../src/core/store.js', () => ({
    state: {
        selectedTasks: new Set(),
        fieldOrder: ['text', 'start_date', 'duration'],
        customFields: []
    },
    isFieldEnabled: vi.fn(() => true),
    getViewMode: vi.fn(() => 'gantt')
}));

vi.mock('../../../src/data/fields.js', () => ({
    INTERNAL_FIELDS: [],
    SYSTEM_FIELD_CONFIG: {}
}));

vi.mock('../../../src/features/gantt/templates.js', () => ({
    renderPriorityBadge: vi.fn(() => '<span>priority</span>'),
    renderStatusBadge: vi.fn(() => '<span>status</span>'),
    renderAssignee: vi.fn(() => '<span>assignee</span>'),
    renderProgressBar: vi.fn(() => '<span>progress</span>')
}));

vi.mock('../../../src/utils/dom.js', () => ({
    extractPlainText: vi.fn((v) => String(v || '')),
    escapeAttr: vi.fn((v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'))
}));

vi.mock('../../../src/utils/time-formatter.js', () => ({
    formatDuration: vi.fn((v) => `${v}d`),
    exclusiveToInclusive: vi.fn((v) => v),
    isDayPrecision: vi.fn(() => true)
}));

vi.mock('../../../src/features/gantt/column-widths.js', () => ({
    applySavedColumnWidths: vi.fn((cols) => cols),
    loadColumnWidthPrefs: vi.fn(() => ({}))
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: vi.fn((key) => key) }
}));

vi.mock('../../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: vi.fn()
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));

// Mocks for init.js dependencies
vi.mock('../../../src/data/tasks.js', () => ({ defaultTasks: { data: [], links: [] } }));
vi.mock('../../../src/features/gantt/resizer.js', () => ({ initResizer: vi.fn() }));
vi.mock('../../../src/features/lightbox/customization.js', () => ({
    registerCustomFieldsBlock: vi.fn(),
    configureLightbox: vi.fn(),
    registerNameInput: vi.fn()
}));
vi.mock('../../../src/features/selection/selectionManager.js', () => ({
    updateSelectedTasksUI: vi.fn(),
    applySelectionStyles: vi.fn()
}));
vi.mock('../../../src/features/gantt/navigation.js', () => ({
    initNavigation: vi.fn(),
    refreshUndoRedoButtons: vi.fn()
}));
vi.mock('../../../src/features/gantt/markers.js', () => ({ initMarkers: vi.fn() }));
vi.mock('../../../src/features/gantt/zoom.js', () => ({
    initZoom: vi.fn(),
    refreshZoomBindings: vi.fn()
}));
vi.mock('../../../src/features/gantt/scheduler.js', () => ({ initScheduler: vi.fn() }));
vi.mock('../../../src/features/gantt/responsive.js', () => ({ initResponsive: vi.fn() }));
vi.mock('../../../src/features/gantt/inline-edit.js', () => ({
    initInlineEdit: vi.fn(),
    addInlineEditStyles: vi.fn()
}));
vi.mock('../../../src/features/gantt/critical-path.js', () => ({ initCriticalPath: vi.fn() }));
vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        canUndo: vi.fn(() => false),
        canRedo: vi.fn(() => false),
        undo: vi.fn(),
        redo: vi.fn(),
        isApplyingHistoryOperation: vi.fn(() => false),
        saveState: vi.fn()
    }
}));
vi.mock('../../../src/features/gantt/baseline.js', () => ({
    initBaseline: vi.fn(),
    handleSaveBaseline: vi.fn(),
    handleToggleBaseline: vi.fn()
}));
vi.mock('../../../src/features/gantt/resource-conflict.js', () => ({ detectResourceConflicts: vi.fn(async () => ({ conflictTaskIds: new Set(), conflictDetails: {} })) }));
vi.mock('../../../src/features/gantt/export-image.js', () => ({
    exportCurrentView: vi.fn(),
    exportFullGantt: vi.fn()
}));
vi.mock('../../../src/features/config/configIO.js', () => ({ exportToExcel: vi.fn() }));
vi.mock('../../../src/features/gantt/snapping.js', () => ({ initSnapping: vi.fn() }));
vi.mock('../../../src/features/gantt/column-reorder-sync.js', () => ({
    computeFieldOrderFromGridColumns: vi.fn((prev) => prev),
    hasFieldOrderChanged: vi.fn(() => false)
}));
vi.mock('../../../src/features/calendar/holidayFetcher.js', () => ({ prefetchHolidays: vi.fn(async () => {}) }));
vi.mock('../../../src/core/storage.js', () => ({
    getAllCustomDays: vi.fn(async () => []),
    getCalendarSettings: vi.fn(async () => ({ countryCode: 'CN' })),
    db: { calendar_holidays: { where: () => ({ anyOf: () => ({ filter: () => ({ toArray: async () => [] }) }) }) } }
}));

describe('gantt-only action affordances', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.openNewTaskDetailsPanel = vi.fn();
        window.openTaskDetailsPanel = vi.fn();

        global.gantt = {
            config: {
                columns: []
            },
            $container: document.createElement('div'),
            render: vi.fn(),
            hasChild: vi.fn(() => false),
            isTaskExists: vi.fn((id) => id === 321 || id === 654),
            getTask: vi.fn((id) => ({
                id,
                text: 'Parent Task',
                start_date: new Date('2026-03-10T00:00:00.000Z'),
                duration: 3
            })),
            addTask: vi.fn(() => 9901),
            templates: {
                date_grid: vi.fn(() => '2026-03-10')
            }
        };
    });

    it('opens new-task flow with parent context on add-child click', async () => {
        const { setGanttOnlyColumns } = await import('../../../src/features/gantt/columns.js');
        setGanttOnlyColumns();

        const actionsCol = global.gantt.config.columns.find((col) => col.name === 'actions');
        const html = actionsCol.template({ id: 321, text: 'Parent Task' });
        document.body.innerHTML = html;

        document.querySelector('[data-action="add-child"]').click();

        expect(window.openNewTaskDetailsPanel).toHaveBeenCalledTimes(1);
        const payload = window.openNewTaskDetailsPanel.mock.calls[0][0];
        expect(String(payload.parentTaskId)).toBe('321');
        expect(String(payload.defaults.parent)).toBe('321');
        expect(payload.defaults.duration).toBe(1);
        expect(payload.defaults.start_date).toBeInstanceOf(Date);
    });

    it('falls back to gantt.addTask when openNewTaskDetailsPanel is unavailable', async () => {
        window.openNewTaskDetailsPanel = undefined;

        const { setGanttOnlyColumns } = await import('../../../src/features/gantt/columns.js');
        setGanttOnlyColumns();

        const actionsCol = global.gantt.config.columns.find((col) => col.name === 'actions');
        const html = actionsCol.template({ id: 321, text: 'Parent Task' });
        document.body.innerHTML = html;

        document.querySelector('[data-action="add-child"]').click();

        expect(global.gantt.addTask).toHaveBeenCalledTimes(1);
        const [defaults, parentId] = global.gantt.addTask.mock.calls[0];
        expect(defaults.start_date).toBeInstanceOf(Date);
        expect(defaults.start_date.getHours()).toBe(0);
        expect(parentId).toBe(321);
        expect(window.openTaskDetailsPanel).toHaveBeenCalledWith(9901);
    });

    it('resolves action task lookup for mixed string/number ids', async () => {
        global.gantt.isTaskExists = vi.fn((id) => id === 654);
        global.gantt.getTask = vi.fn((id) => {
            if (id === 654) {
                return {
                    id: 654,
                    text: 'Numeric Parent',
                    start_date: new Date('2026-03-11T09:30:00.000Z'),
                    duration: 2
                };
            }
            return null;
        });

        const { setGanttOnlyColumns } = await import('../../../src/features/gantt/columns.js');
        setGanttOnlyColumns();

        const actionsCol = global.gantt.config.columns.find((col) => col.name === 'actions');
        const html = actionsCol.template({ id: '654', text: 'Mixed Id Parent' });
        document.body.innerHTML = html;

        document.querySelector('[data-action="add-child"]').click();

        expect(window.openNewTaskDetailsPanel).toHaveBeenCalledTimes(1);
        const payload = window.openNewTaskDetailsPanel.mock.calls[0][0];
        expect(payload.parentTaskId).toBe(654);
        expect(payload.defaults.parent).toBe(654);
        expect(payload.defaults.start_date).toBeInstanceOf(Date);
        expect(payload.defaults.start_date.getHours()).toBe(0);
    });
});

describe('timeline empty-area create action', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.openNewTaskDetailsPanel = vi.fn();

        const taskData = document.createElement('div');
        const emptyCell = document.createElement('div');
        taskData.appendChild(emptyCell);
        document.body.appendChild(taskData);

        global.gantt = {
            $task_data: taskData,
            attachEvent: vi.fn(),
            dateFromPos: vi.fn(() => new Date('2026-04-02T13:45:00.000Z')),
            addTask: vi.fn(() => 8801)
        };
    });

    it('creates a new task from empty-area context with clicked start_date', async () => {
        const { bindTimelineEmptyAreaCreateAction } = await import('../../../src/features/gantt/init.js');
        bindTimelineEmptyAreaCreateAction();

        const onContextMenu = global.gantt.attachEvent.mock.calls.find(([name]) => name === 'onContextMenu')[1];
        const target = global.gantt.$task_data.firstElementChild;
        const preventDefault = vi.fn();
        const event = {
            target,
            clientX: 120,
            preventDefault
        };

        const result = onContextMenu(null, null, event);

        expect(result).toBe(false);
        expect(preventDefault).toHaveBeenCalled();
        expect(window.openNewTaskDetailsPanel).toHaveBeenCalledTimes(1);
        const payload = window.openNewTaskDetailsPanel.mock.calls[0][0];
        expect(payload.defaults.start_date).toBeInstanceOf(Date);
        expect(payload.defaults.start_date.getFullYear()).toBe(2026);
        expect(payload.defaults.start_date.getMonth()).toBe(3);
        expect(payload.defaults.start_date.getDate()).toBe(2);
        expect(payload.defaults.start_date.getHours()).toBe(0);
    });

    it('uses addTask fallback when details panel API is unavailable', async () => {
        window.openNewTaskDetailsPanel = undefined;
        window.openTaskDetailsPanel = vi.fn();

        const { bindTimelineEmptyAreaCreateAction } = await import('../../../src/features/gantt/init.js');
        bindTimelineEmptyAreaCreateAction();

        const onContextMenu = global.gantt.attachEvent.mock.calls.find(([name]) => name === 'onContextMenu')[1];
        const target = global.gantt.$task_data.firstElementChild;
        const event = {
            target,
            clientX: 80,
            preventDefault: vi.fn()
        };

        onContextMenu(null, null, event);

        expect(global.gantt.addTask).toHaveBeenCalledTimes(1);
        const [defaults, parentId] = global.gantt.addTask.mock.calls[0];
        expect(defaults.start_date).toBeInstanceOf(Date);
        expect(defaults.start_date.getHours()).toBe(0);
        expect(parentId).toBe(0);
        expect(window.openTaskDetailsPanel).toHaveBeenCalledWith(8801);
    });
});
