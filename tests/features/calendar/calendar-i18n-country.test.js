import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../src/core/storage.js';

vi.mock('../../../src/features/gantt/init.js', () => ({
    refreshHolidayHighlightCache: vi.fn().mockResolvedValue(undefined),
}));

async function resetCalendarDB() {
    await db.calendar_settings.clear();
    await db.calendar_custom.clear();
    await db.person_leaves.clear();
    await db.calendar_holidays.clear();
    await db.calendar_meta.clear();
}

function createContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('calendar i18n and locale-country behavior', () => {
    beforeEach(async () => {
        await db.open();
        await resetCalendarDB();
        vi.resetModules();
    });

    afterEach(async () => {
        document.body.innerHTML = '';
        await resetCalendarDB();
        vi.clearAllMocks();
    });

    it('defaults country to US for en-US when no saved setting exists', async () => {
        vi.doMock('../../../src/utils/i18n.js', () => ({
            i18n: {
                getLanguage: () => 'en-US',
                t: (key) => ({
                    'calendar.countryOptions.CN': 'China',
                    'calendar.countryOptions.US': 'United States',
                    'calendar.countryOptions.JP': 'Japan',
                    'calendar.countryOptions.KR': 'Korea',
                    'calendar.countryOptions.GB': 'United Kingdom',
                    'calendar.countryOptions.DE': 'Germany',
                    'calendar.countryOptions.FR': 'France',
                    'calendar.countryOptions.SG': 'Singapore',
                }[key] || key),
            },
        }));

        const { renderTab1 } = await import('../../../src/features/calendar/tab1-settings.js');
        const container = createContainer();
        await renderTab1(container);

        expect(container.querySelector('#cal-country')?.value).toBe('US');
    });

    it('renders tab2 list labels from i18n instead of hardcoded Chinese', async () => {
        vi.doMock('../../../src/features/calendar/holidayFetcher.js', () => ({
            ensureHolidaysCached: vi.fn().mockResolvedValue(undefined),
        }));

        vi.doMock('../../../src/utils/i18n.js', () => ({
            i18n: {
                getLanguage: () => 'en-US',
                t: (key) => ({
                    'calendar.configuredCount': 'Configured {{count}} items',
                    'calendar.add': '+ Add',
                    'calendar.col.date': 'Date',
                    'calendar.col.type': 'Type',
                    'calendar.col.note': 'Note',
                    'calendar.col.action': 'Action',
                    'calendar.noSpecialDays': 'No special workday config',
                }[key] || key),
            },
        }));

        const { renderTab2 } = await import('../../../src/features/calendar/tab2-special-days.js');
        const container = createContainer();
        await renderTab2(container);
        container.querySelector('[data-view="list"]')?.click();

        expect(container.textContent).toContain('+ Add');
        expect(container.textContent).toContain('No special workday config');
        expect(container.textContent).not.toContain('暂无特殊工作日配置');
    });

    it('tab2 calendar only uses holidays for selected country', async () => {
        const thisYear = new Date().getFullYear();
        await db.calendar_settings.add({ countryCode: 'US', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8, locale: 'en-US' });
        await db.calendar_holidays.add({
            date: `${thisYear}-02-10`,
            name: '春节',
            isOffDay: true,
            countryCode: 'CN',
            year: thisYear,
            source: 'holiday-cn',
        });

        vi.doMock('../../../src/features/calendar/holidayFetcher.js', () => ({
            ensureHolidaysCached: vi.fn().mockResolvedValue(undefined),
        }));

        vi.doMock('../../../src/utils/i18n.js', () => ({
            i18n: {
                getLanguage: () => 'en-US',
                t: (key) => ({
                    'calendar.calendarView': 'Calendar View',
                    'calendar.listView': 'List View',
                    'calendar.publicHoliday': 'Public Holiday',
                    'calendar.makeupDay': 'Makeup Day',
                    'calendar.customOvertime': 'Custom Overtime',
                    'calendar.companyHoliday': 'Company Holiday',
                    'calendar.configuredCount': 'Configured {{count}} items',
                    'calendar.add': '+ Add',
                    'calendar.col.date': 'Date',
                    'calendar.col.type': 'Type',
                    'calendar.col.note': 'Note',
                    'calendar.col.action': 'Action',
                    'calendar.noSpecialDays': 'No special workday config',
                }[key] || key),
            },
        }));

        const { renderTab2 } = await import('../../../src/features/calendar/tab2-special-days.js');
        const container = createContainer();
        await renderTab2(container);

        expect(container.querySelectorAll('.cal-mini__day-tag').length).toBe(0);
    });

    it('mini calendar weekday header follows current locale', async () => {
        vi.doMock('../../../src/utils/i18n.js', () => ({
            i18n: {
                getLanguage: () => 'en-US',
                t: (key) => key,
            },
        }));

        const { renderMiniCalendar } = await import('../../../src/features/calendar/mini-calendar.js');
        const container = createContainer();

        renderMiniCalendar({
            container,
            year: 2026,
            month: 1,
            highlights: new Map(),
        });

        const weekText = container.querySelector('.cal-mini__weekrow')?.textContent || '';
        expect(weekText).toContain('Mon');
        expect(weekText).not.toContain('一');
    });

    it('renders tab3 empty state from i18n instead of hardcoded Chinese', async () => {
        vi.doMock('../../../src/utils/i18n.js', () => ({
            i18n: {
                getLanguage: () => 'en-US',
                t: (key) => ({
                    'calendar.noLeaves': 'Click Add Leave to record absence',
                    'calendar.addLeaveRecord': 'Add Leave Record',
                }[key] || key),
            },
        }));

        vi.doMock('../../../src/core/store.js', () => ({
            getFieldType: () => 'text',
            getSystemFieldOptions: () => null,
        }));

        const { renderTab3 } = await import('../../../src/features/calendar/tab3-leaves.js');
        const container = createContainer();
        await renderTab3(container);
        container.querySelector('[data-view="list"]')?.click();

        expect(container.textContent).toContain('Click Add Leave to record absence');
        expect(container.textContent).not.toContain('点击「添加请假」记录缺勤');
    });
});
