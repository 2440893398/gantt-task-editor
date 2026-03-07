import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCalendarSettingsMock = vi.fn();
const getAllCustomDaysMock = vi.fn();
const ensureHolidaysCachedMock = vi.fn();
const renderMiniCalendarMock = vi.fn();

const holidayRows = [];

const yearQuery = {
    equals: vi.fn(() => ({
        toArray: vi.fn(async () => holidayRows)
    }))
};

vi.mock('../../../src/core/storage.js', () => ({
    getCalendarSettings: getCalendarSettingsMock,
    getAllCustomDays: getAllCustomDaysMock,
    db: {
        calendar_holidays: {
            where: vi.fn(() => yearQuery)
        }
    }
}));

vi.mock('../../../src/features/calendar/holidayFetcher.js', () => ({
    ensureHolidaysCached: ensureHolidaysCachedMock
}));

vi.mock('../../../src/features/calendar/mini-calendar.js', () => ({
    renderMiniCalendar: renderMiniCalendarMock
}));

vi.mock('../../../src/features/calendar/locale-country.js', () => ({
    resolveCountryByLocale: vi.fn((settings) => ({ countryCode: settings.countryCode || 'CN' }))
}));

vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: {
        getLanguage: vi.fn(() => 'zh-CN'),
        t: vi.fn((key) => key)
    }
}));

describe('date picker popover', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        holidayRows.length = 0;

        getCalendarSettingsMock.mockResolvedValue({
            countryCode: 'CN',
            workdaysOfWeek: [1, 2, 3, 4, 5]
        });
        getAllCustomDaysMock.mockResolvedValue([]);
    });

    it('builds highlight map with holiday semantics and custom-day override', async () => {
        const onSelect = vi.fn();
        holidayRows.push(
            { date: '2026-02-02', year: 2026, countryCode: 'CN', isOffDay: true },
            { date: '2026-02-03', year: 2026, countryCode: 'CN', isOffDay: false },
            { date: '2026-02-04', year: 2026, countryCode: 'US', isOffDay: true }
        );
        getAllCustomDaysMock.mockResolvedValue([
            { id: 'c1', date: '2026-02-02', isOffDay: false },
            { id: 'c2', date: '2026-02-05', isOffDay: true }
        ]);

        renderMiniCalendarMock.mockImplementation(({ onDayClick }) => {
            onDayClick('2026-02-06');
        });

        const { openTaskDatePickerPopover } = await import('../../../src/features/task-details/date-picker-popover.js');

        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        await openTaskDatePickerPopover({
            anchorEl: anchor,
            selectedDate: '2026-02-01',
            onSelect
        });

        const call = renderMiniCalendarMock.mock.calls[0][0];
        expect(call.highlights.get('2026-02-02').type).toBe('overtime');
        expect(call.highlights.get('2026-02-03').type).toBe('makeupday');
        expect(call.highlights.get('2026-02-05').type).toBe('companyday');
        expect(call.highlights.has('2026-02-04')).toBe(false);

        expect(onSelect).toHaveBeenCalledWith('2026-02-06');
        expect(document.querySelector('.task-date-picker-popover')).toBeNull();
    });

    it('cleans listeners after immediate close and keeps outside-click close working on reopen', async () => {
        const originalAddEventListener = document.addEventListener.bind(document);
        const originalRemoveEventListener = document.removeEventListener.bind(document);
        const activeClickListeners = new Set();

        const addListenerSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
            if (type === 'click' && typeof listener === 'function') {
                activeClickListeners.add(listener);
            }
            return originalAddEventListener(type, listener, options);
        });
        const removeListenerSpy = vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, options) => {
            if (type === 'click' && typeof listener === 'function') {
                activeClickListeners.delete(listener);
            }
            return originalRemoveEventListener(type, listener, options);
        });

        try {
            renderMiniCalendarMock.mockImplementation(() => {});

            let resolveSettings;
            const delayedSettingsPromise = new Promise((resolve) => {
                resolveSettings = resolve;
            });
            getCalendarSettingsMock.mockReturnValueOnce(delayedSettingsPromise);

            const { openTaskDatePickerPopover, closeTaskDatePickerPopover } = await import('../../../src/features/task-details/date-picker-popover.js');

            const anchor = document.createElement('button');
            document.body.appendChild(anchor);

            const firstOpenPromise = openTaskDatePickerPopover({
                anchorEl: anchor,
                selectedDate: '2026-02-01'
            });

            closeTaskDatePickerPopover();

            resolveSettings({
                countryCode: 'CN',
                workdaysOfWeek: [1, 2, 3, 4, 5]
            });

            await firstOpenPromise;
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(activeClickListeners.size).toBe(0);

            await openTaskDatePickerPopover({
                anchorEl: anchor,
                selectedDate: '2026-02-02'
            });
            expect(activeClickListeners.size).toBe(1);
            expect(document.querySelector('.task-date-picker-popover')).not.toBeNull();

            document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(document.querySelector('.task-date-picker-popover')).toBeNull();
            expect(activeClickListeners.size).toBe(0);
        } finally {
            removeListenerSpy.mockRestore();
            addListenerSpy.mockRestore();
        }
    });
});
