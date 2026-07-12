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

    it('scopes policy revisions to the relevant assignee', async () => {
        const deps = {
            loadSettings: async () => settings,
            loadHolidays: async () => [],
            loadCustomDays: async () => [],
            loadLeaves: async () => [
                { assignee: 'Ada', startDate: '2026-07-10', endDate: '2026-07-11' },
                { assignee: 'Lin', startDate: '2026-07-12', endDate: '2026-07-13' },
            ],
        };

        const globalPolicy = await describeSchedulePolicy(deps);
        const assigneePolicy = await describeSchedulePolicy({ ...deps, assignee: 'Ada' });

        const adaWithoutLin = await describeSchedulePolicy({
            ...deps,
            assignee: 'Ada',
            loadLeaves: async () => [
                { assignee: 'Ada', startDate: '2026-07-10', endDate: '2026-07-11' },
            ],
        });
        const adaChanged = await describeSchedulePolicy({
            ...deps,
            assignee: 'Ada',
            loadLeaves: async () => [
                { assignee: 'Ada', startDate: '2026-07-10', endDate: '2026-07-12' },
                { assignee: 'Lin', startDate: '2026-07-12', endDate: '2026-07-13' },
            ],
        });

        expect(assigneePolicy.policyRev).toBe(adaWithoutLin.policyRev);
        expect(assigneePolicy.policyRev).not.toBe(globalPolicy.policyRev);
        expect(assigneePolicy.policyRev).not.toBe(adaChanged.policyRev);
    });

    it('scopes task policy revisions by assignee, country, and task years', async () => {
        const gantt = {
            getTask: () => ({
                id: 7,
                assignee: 'Ada',
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 5),
            }),
        };
        const base = {
            taskId: 7,
            gantt,
            loadSettings: async () => settings,
            loadHolidays: async () => [
                { date: '2026-07-01', year: 2026, countryCode: 'CN', name: 'Relevant' },
                { date: '2026-07-01', year: 2026, countryCode: 'US', name: 'Other country' },
                { date: '2027-07-01', year: 2027, countryCode: 'CN', name: 'Other year' },
            ],
            loadCustomDays: async () => [
                { date: '2026-07-02', isOffDay: true },
                { date: '2027-07-02', isOffDay: true },
            ],
            loadLeaves: async () => [
                { assignee: 'Ada', startDate: '2026-07-02', endDate: '2026-07-02' },
                { assignee: 'Lin', startDate: '2026-07-02', endDate: '2026-07-02' },
            ],
        };
        const scoped = await describeSchedulePolicy(base);
        const unrelatedChanged = await describeSchedulePolicy({
            ...base,
            loadHolidays: async () => [
                ...(await base.loadHolidays()).slice(0, 1),
                { date: '2026-07-03', year: 2026, countryCode: 'US', name: 'Changed' },
                { date: '2026-12-25', year: 2026, countryCode: 'CN', name: 'Outside task' },
                { date: '2028-07-01', year: 2028, countryCode: 'CN', name: 'Changed' },
            ],
            loadCustomDays: async () => [
                { date: '2026-07-02', isOffDay: true },
                { date: '2026-12-26', isOffDay: false },
                { date: '2028-07-02', isOffDay: false },
            ],
            loadLeaves: async () => [
                { assignee: 'Ada', startDate: '2026-07-02', endDate: '2026-07-02' },
                { assignee: 'Lin', startDate: '2026-07-03', endDate: '2026-07-04' },
            ],
        });
        const relevantChanged = await describeSchedulePolicy({
            ...base,
            loadHolidays: async () => [
                { date: '2026-07-03', year: 2026, countryCode: 'CN', name: 'Changed' },
            ],
        });

        expect(unrelatedChanged.policyRev).toBe(scoped.policyRev);
        expect(relevantChanged.policyRev).not.toBe(scoped.policyRev);
    });

    it.each([
        ['invalid start', '2026-02-30', '2026-03-01'],
        ['invalid end', '2026-03-01', '2026-02-30'],
        ['reversed range', '2026-03-02', '2026-03-01'],
    ])('rejects an %s calendar range', async (label, start, end) => {
        const result = await queryCalendarContext({ start, end });
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_FIELD_VALUE' } });
    });

    it('accepts an equal calendar range boundary', async () => {
        const result = await queryCalendarContext({
            start: '2026-07-01',
            end: '2026-07-01',
            include: ['exceptions'],
            loadHolidays: async () => [{ date: '2026-07-01' }],
            loadCustomDays: async () => [],
        });
        expect(result.holidays).toHaveLength(1);
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
