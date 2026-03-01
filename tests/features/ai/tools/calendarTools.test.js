import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calendarTools } from '../../../../src/features/ai/tools/calendarTools.js';
import { db, saveCalendarSettings, bulkSaveHolidays, saveCustomDay, saveLeave } from '../../../../src/core/storage.js';

function setupGantt(tasks = []) {
    globalThis.gantt = {
        eachTask: (fn) => tasks.forEach(fn),
        getParent: (id) => {
            const task = tasks.find(t => t.id === id);
            return task?._parent || null;
        },
        getChildren: (id) => tasks.filter(t => t._parent === id).map(t => t.id)
    };
}

async function clearCalendarTables() {
    await db.open();
    await db.calendar_settings.clear();
    await db.calendar_holidays.clear();
    await db.calendar_custom.clear();
    await db.person_leaves.clear();
}

describe('calendarTools', () => {
    beforeEach(async () => {
        await clearCalendarTables();
        delete globalThis.gantt;
    });

    afterEach(async () => {
        await clearCalendarTables();
        delete globalThis.gantt;
    });

    describe('get_calendar_info', () => {
        it('returns calendar summary with deterministic totals', async () => {
            await saveCalendarSettings({ countryCode: 'JP', workdaysOfWeek: [1, 2, 3, 4, 5, 6], hoursPerDay: 9 });
            await bulkSaveHolidays([
                { date: '2026-05-01', year: 2026, countryCode: 'JP', isOffDay: true, name: 'Constitution Memorial Day' }
            ]);
            await saveCustomDay({ id: 'c-1', date: '2026-05-10', isOffDay: false, name: 'Overtime', note: 'release' });
            await saveLeave({ id: 'l-1', assignee: 'Alice', startDate: '2026-05-11', endDate: '2026-05-12', type: 'annual', note: '' });

            const result = await calendarTools.get_calendar_info.execute();

            expect(result.settings.country_code).toBe('JP');
            expect(result.totals).toEqual({
                holidays: 1,
                custom_days: 1,
                leaves: 1,
                records: 3
            });
            expect(result.holidays[0]).toMatchObject({ date: '2026-05-01', country_code: 'JP', is_off_day: true });
            expect(result.custom_days[0]).toMatchObject({ id: 'c-1', date: '2026-05-10', is_off_day: false });
            expect(result.leaves[0]).toMatchObject({ id: 'l-1', assignee: 'Alice', start_date: '2026-05-11', end_date: '2026-05-12' });
        });

        it('filters by type and date range', async () => {
            await bulkSaveHolidays([
                { date: '2026-01-01', year: 2026, countryCode: 'CN', isOffDay: true, name: 'New Year' },
                { date: '2026-03-01', year: 2026, countryCode: 'CN', isOffDay: true, name: 'Holiday B' }
            ]);

            const result = await calendarTools.get_calendar_info.execute({
                type: 'holidays',
                start_date: '2026-02-01',
                end_date: '2026-03-31'
            });

            expect(result.settings).toBeNull();
            expect(result.custom_days).toEqual([]);
            expect(result.leaves).toEqual([]);
            expect(result.holidays).toHaveLength(1);
            expect(result.holidays[0].date).toBe('2026-03-01');
            expect(result.totals.records).toBe(1);
        });
    });

    describe('get_assignee_workload', () => {
        it('returns graceful fallback when gantt is missing', async () => {
            const result = await calendarTools.get_assignee_workload.execute();
            expect(result.error).toBeTruthy();
            expect(result.workload).toEqual([]);
            expect(result.totals.total_tasks).toBe(0);
        });

        it('aggregates workload by assignee and supports filters', async () => {
            setupGantt([
                { id: 1, text: 'Plan', assignee: 'Alice', status: 'in_progress', progress: 0.5, duration: 3, start_date: '2026-06-01', end_date: '2026-06-03' },
                { id: 2, text: 'Build', assignee: 'Alice', status: 'pending', progress: 0, duration: 5, start_date: '2026-06-04', end_date: '2026-06-09' },
                { id: 3, text: 'Review', assignee: 'Bob', status: 'completed', progress: 1, duration: 2, start_date: '2026-06-10', end_date: '2026-06-11' }
            ]);

            const allResult = await calendarTools.get_assignee_workload.execute();
            expect(allResult.totals).toEqual({ assignee_count: 2, total_tasks: 3, total_duration: 10 });
            expect(allResult.workload[0].assignee).toBe('Alice');
            expect(allResult.workload[0].task_count).toBe(2);
            expect(allResult.workload[0].status_breakdown.in_progress).toBe(1);
            expect(allResult.workload[0].status_breakdown.pending).toBe(1);
            expect(allResult.workload[1].assignee).toBe('Bob');

            const filtered = await calendarTools.get_assignee_workload.execute({ assignee: 'Alice', status: 'pending' });
            expect(filtered.totals).toEqual({ assignee_count: 1, total_tasks: 1, total_duration: 5 });
            expect(filtered.workload).toHaveLength(1);
            expect(filtered.workload[0].tasks).toHaveLength(1);
            expect(filtered.workload[0].tasks[0].text).toBe('Build');
        });
    });
});
