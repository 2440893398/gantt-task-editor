import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../../src/features/gantt/columns.js');

vi.mock('../../../src/core/store.js', () => ({
    state: {
        selectedTasks: new Set(),
        fieldOrder: ['text', 'start_date', 'duration'],
        customFields: []
    },
    isFieldEnabled: vi.fn(() => true),
    getViewMode: vi.fn(() => 'split')
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

describe('gantt columns actions', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        global.gantt = {
            config: {
                columns: []
            },
            $container: document.createElement('div'),
            render: vi.fn(),
            hasChild: vi.fn(() => false),
            templates: {
                date_grid: vi.fn(() => '2026-03-04')
            }
        };
    });

    it('adds right-most actions column in normal grid mode', async () => {
        const { updateGanttColumns } = await import('../../../src/features/gantt/columns.js');
        updateGanttColumns();

        const cols = global.gantt.config.columns;
        expect(cols.length).toBeGreaterThan(1);
        expect(cols.at(-1).name).toBe('actions');

        const html = cols.at(-1).template({ id: 101, text: 'Task A' });
        expect(html).toContain('data-action="edit"');
        expect(html).toContain('data-action="delete"');
        expect(html).toContain('data-task-id="101"');
    });

    it('keeps actions column visible in gantt-only mode', async () => {
        const { setGanttOnlyColumns } = await import('../../../src/features/gantt/columns.js');
        setGanttOnlyColumns();

        const colNames = global.gantt.config.columns.map((c) => c.name);
        expect(colNames).toEqual(['text', 'actions']);
    });

    it('escapes title attribute in gantt-only text template', async () => {
        const { setGanttOnlyColumns } = await import('../../../src/features/gantt/columns.js');
        setGanttOnlyColumns();

        const textCol = global.gantt.config.columns.find((col) => col.name === 'text');
        const html = textCol.template({
            id: 7,
            text: 'Unsafe \"quote\" <img src=x onerror=alert(1)>'
        });

        expect(html).toContain('title="Unsafe &quot;quote&quot; &lt;img src=x onerror=alert(1)&gt;"');
        expect(html).not.toContain('title="Unsafe "quote" <img src=x onerror=alert(1)>"');
    });

    it('includes add-child affordance in table mode actions', async () => {
        const store = await import('../../../src/core/store.js');
        store.getViewMode.mockReturnValue('table');

        const { updateGanttColumns } = await import('../../../src/features/gantt/columns.js');
        updateGanttColumns();

        const actionsCol = global.gantt.config.columns.at(-1);
        const html = actionsCol.template({ id: 202, text: 'Parent Task' });
        expect(html).toContain('data-action="add-child"');
        expect(html).toContain('data-action="edit"');
        expect(html).toContain('data-action="delete"');
    });
});
