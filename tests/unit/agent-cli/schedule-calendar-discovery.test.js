import { describe, expect, it } from 'vitest';
import { describeSchedulePolicy } from '../../../src/features/gantt/domain/schedule-policy.js';
import { queryCalendarContext } from '../../../src/features/calendar/calendar-query.js';

const settings = { countryCode: 'CN', workdaysOfWeek: [1, 2, 3, 4, 5], hoursPerDay: 8 };

describe('schedule and calendar discovery services', () => {
    it('changes policyRev when a scheduling exception changes', async () => {
        const base = {
            loadSettings: async () => settings,
            loadHolidays: async () => [],
            loadLeaves: async () => [],
        };
        const before = await describeSchedulePolicy({
            ...base,
            loadCustomDays: async () => [],
        });
        const after = await describeSchedulePolicy({
            ...base,
            loadCustomDays: async () => [{ date: '2026-07-15', isOffDay: true }],
        });

        expect(after.policyRev).not.toBe(before.policyRev);
        expect(after.endDateSemantics).toBe('inclusive');
        expect(after.durationUnit).toBe('working-day');
    });

    it('returns only range and assignee relevant calendar records', async () => {
        const result = await queryCalendarContext({
            start: '2026-07-01',
            end: '2026-07-31',
            assignee: '张三',
            include: ['settings', 'exceptions', 'leaves'],
            loadSettings: async () => settings,
            loadHolidays: async () => [
                { date: '2026-07-01', name: 'Holiday' },
                { date: '2026-08-01', name: 'Outside' },
            ],
            loadCustomDays: async () => [{ date: '2026-07-04', isOffDay: false }],
            loadLeaves: async () => [
                { assignee: '张三', startDate: '2026-07-10', endDate: '2026-07-11' },
                { assignee: '李四', startDate: '2026-07-10', endDate: '2026-07-11' },
            ],
        });

        expect(result.holidays).toHaveLength(1);
        expect(result.customDays).toHaveLength(1);
        expect(result.leaves).toHaveLength(1);
        expect(result.leaves[0].assignee).toBe('张三');
    });
});
