import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeState = {
    selectedTasks: new Set(),
    fieldOrder: [],
    customFields: []
};

const i18nTranslateMock = vi.fn((key) => (key.startsWith('columns.') ? '' : key));

vi.mock('../../../src/core/store.js', () => ({
    state: storeState,
    isFieldEnabled: vi.fn(() => true),
    getViewMode: vi.fn(() => 'table')
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
    extractPlainText: vi.fn((value) => String(value || '')),
    escapeAttr: vi.fn((value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;'))
}));

vi.mock('../../../src/utils/time-formatter.js', () => ({
    formatDuration: vi.fn((value) => `${value}d`),
    exclusiveToInclusive: vi.fn((value) => value),
    isDayPrecision: vi.fn(() => true)
}));

vi.mock('../../../src/features/gantt/column-widths.js', () => ({
    applySavedColumnWidths: vi.fn((columns) => columns),
    loadColumnWidthPrefs: vi.fn(() => ({}))
}));

vi.mock('../../../src/features/gantt/new-task-payload.js', () => ({
    buildNewTaskPayload: vi.fn(() => ({})),
    getTaskByAnyId: vi.fn(() => null)
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: i18nTranslateMock }
}));

vi.mock('../../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: vi.fn()
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));

describe('gantt custom column labels', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storeState.selectedTasks = new Set();
        storeState.fieldOrder = ['text', 'custom_budget'];
        storeState.customFields = [
            { name: 'custom_budget', label: '预算', width: 120 }
        ];
    });

    it('falls back to the custom field label when the column translation is missing', async () => {
        const { __test__ } = await vi.importActual('../../../src/features/gantt/columns.js');

        expect(__test__.getColumnLabel('custom_budget', '预算')).toBe('预算');
    });
});
