import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/core/storage.js', () => ({
    db: {
        calendar_holidays: {
            orderBy: () => ({
                toArray: async () => [
                    {
                        date: '2026-07-15',
                        countryCode: 'CN',
                        isOffDay: true,
                        name: 'Holiday',
                    },
                ],
            }),
        },
    },
    getAllHolidays: async () => [
        { date: '2026-07-15', countryCode: 'CN', isOffDay: true, name: 'Holiday' },
    ],
    getCalendarSettings: async () => ({
        countryCode: 'CN',
        workdaysOfWeek: [1, 2, 3, 4, 5],
        hoursPerDay: 8,
    }),
    getAllCustomDays: async () => [
        { id: 1, date: '2026-07-16', isOffDay: false, name: 'Make-up', note: null },
    ],
    getAllLeaves: async () => [
        {
            id: 2,
            assignee: 'Ada',
            startDate: '2026-07-17',
            endDate: '2026-07-18',
            type: 'annual',
            note: null,
        },
    ],
}));

const { calendarTools } = await import('../../../../src/features/ai/tools/calendarTools.js');

describe('get_calendar_info compatibility shape', () => {
    it('keeps the legacy calendar result shape while sharing calendar queries', async () => {
        const result = await calendarTools.get_calendar_info.execute({ type: 'all' });
        const shape = {
            result: Object.keys(result).sort(),
            query: Object.keys(result.query).sort(),
            settings: Object.keys(result.settings).sort(),
            holiday: Object.keys(result.holidays[0]).sort(),
            customDay: Object.keys(result.custom_days[0]).sort(),
            leave: Object.keys(result.leaves[0]).sort(),
            totals: Object.keys(result.totals).sort(),
        };

        expect(shape).toMatchInlineSnapshot(`
          {
            "customDay": [
              "date",
              "id",
              "is_off_day",
              "name",
              "note",
            ],
            "holiday": [
              "country_code",
              "date",
              "is_off_day",
              "name",
            ],
            "leave": [
              "assignee",
              "end_date",
              "id",
              "note",
              "start_date",
              "type",
            ],
            "query": [
              "end_date",
              "start_date",
              "type",
            ],
            "result": [
              "custom_days",
              "holidays",
              "leaves",
              "query",
              "settings",
              "totals",
            ],
            "settings": [
              "country_code",
              "hours_per_day",
              "workdays_of_week",
            ],
            "totals": [
              "custom_days",
              "holidays",
              "leaves",
              "records",
            ],
          }
        `);
    });
});
