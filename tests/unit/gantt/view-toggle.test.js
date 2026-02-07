/**
 * 视图切换模块测试
 * 测试 initViewToggle 以及内部的 applyViewMode / updateViewToggleUI 逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('../../../src/core/store.js', () => ({
    getViewMode: vi.fn(() => 'split'),
    setViewMode: vi.fn()
}));

vi.mock('../../../src/features/gantt/columns.js', () => ({
    updateGanttColumns: vi.fn()
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: vi.fn((key) => key) }
}));

// --- Imports (after mocks) ---

import { initViewToggle } from '../../../src/features/gantt/view-toggle.js';
import { getViewMode, setViewMode } from '../../../src/core/store.js';
import { updateGanttColumns } from '../../../src/features/gantt/columns.js';
import { i18n } from '../../../src/utils/i18n.js';

// --- Helpers ---

function clickButton(dataView) {
    const segmented = document.getElementById('view-segmented');
    const btn = segmented.querySelector(`[data-view="${dataView}"]`);
    btn.click();
}

// --- Tests ---

describe('initViewToggle', () => {
    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = `
            <div id="view-segmented">
                <button class="view-seg-btn" data-view="split">Split</button>
                <button class="view-seg-btn" data-view="table">Table</button>
                <button class="view-seg-btn" data-view="gantt">Gantt</button>
            </div>
        `;

        // Reset gantt global
        global.gantt = {
            config: {
                show_grid: false,
                show_chart: false,
                columns: []
            },
            render: vi.fn()
        };

        // Clear all mock call history
        vi.clearAllMocks();

        // Restore default return value after clearAllMocks
        getViewMode.mockReturnValue('split');
    });

    // ---- Early return ----

    it('should return early if #view-segmented is not found', () => {
        document.body.innerHTML = '';

        initViewToggle();

        // getViewMode should never be called when there is no segmented element
        expect(getViewMode).not.toHaveBeenCalled();
    });

    // ---- Initialization ----

    it('should load saved mode from getViewMode on init', () => {
        getViewMode.mockReturnValue('table');

        initViewToggle();

        expect(getViewMode).toHaveBeenCalledTimes(1);
        // Verify the saved mode was applied: table mode sets show_chart=false
        expect(gantt.config.show_chart).toBe(false);
        expect(gantt.config.show_grid).toBe(true);
    });

    it('should set the active class on the matching button during init', () => {
        getViewMode.mockReturnValue('gantt');

        initViewToggle();

        const buttons = document.querySelectorAll('.view-seg-btn');
        buttons.forEach(btn => {
            if (btn.dataset.view === 'gantt') {
                expect(btn.classList.contains('active')).toBe(true);
            } else {
                expect(btn.classList.contains('active')).toBe(false);
            }
        });
    });

    // ---- Click handling ----

    it('should set up click listener that reads data-view attribute', () => {
        initViewToggle();
        vi.clearAllMocks();

        clickButton('table');

        expect(setViewMode).toHaveBeenCalledWith('table');
    });

    it('should call setViewMode, updateViewToggleUI and applyViewMode on click', () => {
        initViewToggle();
        vi.clearAllMocks();

        clickButton('gantt');

        // setViewMode called with the clicked mode
        expect(setViewMode).toHaveBeenCalledWith('gantt');

        // updateViewToggleUI was invoked: the gantt button should be active
        const ganttBtn = document.querySelector('[data-view="gantt"]');
        expect(ganttBtn.classList.contains('active')).toBe(true);

        // applyViewMode was invoked: gantt.render was called
        expect(gantt.render).toHaveBeenCalled();
    });

    it('should ignore clicks that are not on a [data-view] element', () => {
        initViewToggle();
        vi.clearAllMocks();

        // Click on the container itself (no data-view attribute)
        const segmented = document.getElementById('view-segmented');
        segmented.click();

        expect(setViewMode).not.toHaveBeenCalled();
        expect(gantt.render).not.toHaveBeenCalled();
    });
});

describe('applyViewMode (via initViewToggle)', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="view-segmented">
                <button class="view-seg-btn" data-view="split">Split</button>
                <button class="view-seg-btn" data-view="table">Table</button>
                <button class="view-seg-btn" data-view="gantt">Gantt</button>
            </div>
        `;

        global.gantt = {
            config: {
                show_grid: false,
                show_chart: false,
                columns: []
            },
            render: vi.fn()
        };

        vi.clearAllMocks();
        getViewMode.mockReturnValue('split');
    });

    // ---- Split mode ----

    it('split mode: should set show_grid=true, show_chart=true and call updateGanttColumns', () => {
        getViewMode.mockReturnValue('split');
        initViewToggle();

        expect(gantt.config.show_grid).toBe(true);
        expect(gantt.config.show_chart).toBe(true);
        expect(updateGanttColumns).toHaveBeenCalled();
    });

    // ---- Table mode ----

    it('table mode: should set show_grid=true, show_chart=false and call updateGanttColumns', () => {
        getViewMode.mockReturnValue('table');
        initViewToggle();

        expect(gantt.config.show_grid).toBe(true);
        expect(gantt.config.show_chart).toBe(false);
        expect(updateGanttColumns).toHaveBeenCalled();
    });

    // ---- Gantt mode ----

    it('gantt mode: should set show_grid=true, show_chart=true and set minimal columns', () => {
        getViewMode.mockReturnValue('gantt');
        initViewToggle();

        expect(gantt.config.show_grid).toBe(true);
        expect(gantt.config.show_chart).toBe(true);
        expect(gantt.config.columns).toEqual([
            { name: 'text', label: 'columns.text', tree: true, width: '*', min_width: 240 }
        ]);
        // updateGanttColumns should NOT be called for gantt mode
        expect(updateGanttColumns).not.toHaveBeenCalled();
    });

    // ---- All modes call gantt.render ----

    it('split mode should call gantt.render()', () => {
        getViewMode.mockReturnValue('split');
        initViewToggle();

        expect(gantt.render).toHaveBeenCalled();
    });

    it('table mode should call gantt.render()', () => {
        getViewMode.mockReturnValue('table');
        initViewToggle();

        expect(gantt.render).toHaveBeenCalled();
    });

    it('gantt mode should call gantt.render()', () => {
        getViewMode.mockReturnValue('gantt');
        initViewToggle();

        expect(gantt.render).toHaveBeenCalled();
    });

    // ---- Switching modes via click ----

    it('should apply correct config when switching from split to table via click', () => {
        initViewToggle();
        vi.clearAllMocks();

        clickButton('table');

        expect(gantt.config.show_grid).toBe(true);
        expect(gantt.config.show_chart).toBe(false);
        expect(updateGanttColumns).toHaveBeenCalled();
        expect(gantt.render).toHaveBeenCalled();
    });

    it('should apply correct config when switching from split to gantt via click', () => {
        initViewToggle();
        vi.clearAllMocks();

        clickButton('gantt');

        expect(gantt.config.show_grid).toBe(true);
        expect(gantt.config.show_chart).toBe(true);
        expect(gantt.config.columns).toEqual([
            { name: 'text', label: 'columns.text', tree: true, width: '*', min_width: 240 }
        ]);
        expect(gantt.render).toHaveBeenCalled();
    });
});

describe('updateViewToggleUI (via initViewToggle)', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="view-segmented">
                <button class="view-seg-btn" data-view="split">Split</button>
                <button class="view-seg-btn" data-view="table">Table</button>
                <button class="view-seg-btn" data-view="gantt">Gantt</button>
            </div>
        `;

        global.gantt = {
            config: {
                show_grid: false,
                show_chart: false,
                columns: []
            },
            render: vi.fn()
        };

        vi.clearAllMocks();
        getViewMode.mockReturnValue('split');
    });

    it('should add active class to the matching button', () => {
        getViewMode.mockReturnValue('table');
        initViewToggle();

        const tableBtn = document.querySelector('[data-view="table"]');
        expect(tableBtn.classList.contains('active')).toBe(true);
    });

    it('should remove active class from non-matching buttons', () => {
        getViewMode.mockReturnValue('table');
        initViewToggle();

        const splitBtn = document.querySelector('[data-view="split"]');
        const ganttBtn = document.querySelector('[data-view="gantt"]');

        expect(splitBtn.classList.contains('active')).toBe(false);
        expect(ganttBtn.classList.contains('active')).toBe(false);
    });

    it('should update active class when mode changes via click', () => {
        initViewToggle();

        // Initially split is active
        expect(document.querySelector('[data-view="split"]').classList.contains('active')).toBe(true);
        expect(document.querySelector('[data-view="gantt"]').classList.contains('active')).toBe(false);

        // Click gantt
        clickButton('gantt');

        expect(document.querySelector('[data-view="gantt"]').classList.contains('active')).toBe(true);
        expect(document.querySelector('[data-view="split"]').classList.contains('active')).toBe(false);
        expect(document.querySelector('[data-view="table"]').classList.contains('active')).toBe(false);
    });

    it('should correctly toggle active across all three modes', () => {
        initViewToggle();

        // Switch through all modes and verify only the correct button is active each time
        const modes = ['split', 'table', 'gantt'];

        for (const mode of modes) {
            clickButton(mode);

            document.querySelectorAll('.view-seg-btn').forEach(btn => {
                if (btn.dataset.view === mode) {
                    expect(btn.classList.contains('active')).toBe(true);
                } else {
                    expect(btn.classList.contains('active')).toBe(false);
                }
            });
        }
    });
});
