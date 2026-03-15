import { beforeEach, describe, expect, it, vi } from 'vitest';

const setupSelectMock = vi.fn();
const openTaskDatePickerPopoverMock = vi.fn(async () => {});
const saveStateMock = vi.fn();

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        t: vi.fn(() => null)
    }
}));

vi.mock('../../../src/core/store.js', () => ({
    state: { customFields: [] },
    isFieldEnabled: vi.fn(() => true),
    getFieldType: vi.fn(() => 'text'),
    getSystemFieldOptions: vi.fn(() => [])
}));

vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        saveState: saveStateMock,
        isApplyingHistoryOperation: vi.fn(() => false)
    }
}));

vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn()
}));

vi.mock('../../../src/utils/dom.js', () => ({
    escapeAttr: vi.fn((v) => String(v ?? ''))
}));

vi.mock('../../../src/components/common/dropdown.js', () => ({
    renderSelectHTML: vi.fn(() => ''),
    setupSelect: setupSelectMock
}));

vi.mock('../../../src/features/task-details/date-picker-popover.js', () => ({
    openTaskDatePickerPopover: openTaskDatePickerPopoverMock
}));

function buildPanel() {
    const panel = document.createElement('div');
    panel.innerHTML = `
        <button type="button" id="task-start-date">-</button>
        <button type="button" id="task-end-date">-</button>
    `;
    return panel;
}

function expectLocalYmd(date, y, m, d) {
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(y);
    expect(date.getMonth()).toBe(m - 1);
    expect(date.getDate()).toBe(d);
}

describe('right-section date recalculation by schedule mode', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        document.body.innerHTML = '';

        global.gantt = {
            updateTask: vi.fn(),
            calculateEndDate: vi.fn((start, duration) => {
                const next = new Date(start);
                next.setDate(next.getDate() + duration);
                return next;
            }),
            calculateDuration: vi.fn(() => 5),
            hasChild: vi.fn(() => false)
        };
    });

    it('in start_duration mode, changing start recalculates end', async () => {
        const { bindRightSectionEvents } = await import('../../../src/features/task-details/right-section.js');
        const panel = buildPanel();
        // Use local-timezone Date objects so the panel-open correction check
        // (right-section.js ~line 208) sees end_date === calculateEndDate(start, duration)
        // and does NOT fire a spurious extra call before the user interaction.
        // The mock does: new Date(start); setDate(getDate() + duration) — which is local-time-based.
        // new Date(2026, 2, 1) local + 3 days === new Date(2026, 2, 4) local → no mismatch.
        const task = {
            id: 1,
            schedule_mode: 'start_duration',
            start_date: new Date(2026, 2, 1),   // March 1, 2026 local time
            end_date: new Date(2026, 2, 4),     // March 4, 2026 local time (start + duration)
            duration: 3
        };

        bindRightSectionEvents(panel, task);

        // Reset spy after panel initialization so we isolate the user-interaction call.
        // The panel may call calculateEndDate once on open to auto-correct end_date vs
        // start+duration inconsistencies; that initialization path is tested separately.
        global.gantt.calculateEndDate.mockClear();

        panel.querySelector('#task-start-date').click();
        const call = openTaskDatePickerPopoverMock.mock.calls[0][0];
        call.onSelect('2026-03-10');

        expect(global.gantt.calculateEndDate).toHaveBeenCalledTimes(1);
        expect(global.gantt.calculateEndDate).toHaveBeenCalledWith(expect.any(Date), 3);
        expectLocalYmd(task.end_date, 2026, 3, 13);
    });

    it('in start_end mode, changing start does not recalculate end', async () => {
        const { bindRightSectionEvents } = await import('../../../src/features/task-details/right-section.js');
        const panel = buildPanel();
        const initialEnd = new Date('2026-03-08T00:00:00.000Z');
        const task = {
            id: 2,
            schedule_mode: 'start_end',
            start_date: new Date('2026-03-01T00:00:00.000Z'),
            end_date: initialEnd,
            duration: 3
        };

        bindRightSectionEvents(panel, task);

        panel.querySelector('#task-start-date').click();
        const call = openTaskDatePickerPopoverMock.mock.calls[0][0];
        call.onSelect('2026-03-10');

        expect(global.gantt.calculateEndDate).not.toHaveBeenCalled();
        expect(task.end_date).toEqual(initialEnd);
    });

    it('in start_end mode, changing end recalculates duration', async () => {
        const { bindRightSectionEvents } = await import('../../../src/features/task-details/right-section.js');
        const panel = buildPanel();
        const task = {
            id: 3,
            schedule_mode: 'start_end',
            start_date: new Date('2026-03-01T00:00:00.000Z'),
            end_date: new Date('2026-03-08T00:00:00.000Z'),
            duration: 3
        };

        bindRightSectionEvents(panel, task);

        panel.querySelector('#task-end-date').click();
        const call = openTaskDatePickerPopoverMock.mock.calls[0][0];
        call.onSelect('2026-03-15');

        expect(global.gantt.calculateDuration).toHaveBeenCalledTimes(1);
        const durationCall = global.gantt.calculateDuration.mock.calls[0];
        expect(durationCall[0]).toBe(task.start_date);
        expectLocalYmd(durationCall[1], 2026, 3, 16);
        expect(task.duration).toBe(5);
    });

    it('in start_duration mode, changing end does not recalculate duration', async () => {
        const { bindRightSectionEvents } = await import('../../../src/features/task-details/right-section.js');
        const panel = buildPanel();
        const task = {
            id: 4,
            schedule_mode: 'start_duration',
            start_date: new Date('2026-03-01T00:00:00.000Z'),
            end_date: new Date('2026-03-08T00:00:00.000Z'),
            duration: 3
        };

        bindRightSectionEvents(panel, task);

        panel.querySelector('#task-end-date').click();
        const call = openTaskDatePickerPopoverMock.mock.calls[0][0];
        call.onSelect('2026-03-15');

        expect(global.gantt.calculateDuration).not.toHaveBeenCalled();
        expect(task.duration).toBe(3);
        expectLocalYmd(task.end_date, 2026, 3, 16);
    });
});
