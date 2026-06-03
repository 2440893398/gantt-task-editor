import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

import { syncGanttWorkTimeCalendar } from '../../../src/features/gantt/calendar-worktime.js';

describe('calendar work time cache', () => {
    it('syncs custom overtime days into DHTMLX work time for duration calculation', async () => {
        const ganttApi = { setWorkTime: vi.fn() };

        syncGanttWorkTimeCalendar(ganttApi, {
            settings: { workdaysOfWeek: [1, 2, 3, 4, 5] },
            customs: [{ date: '2026-06-06', isOffDay: false }],
            holidays: [],
        });

        expect(ganttApi.setWorkTime).toHaveBeenCalledWith({
            date: new Date(2026, 5, 6),
            hours: true,
        });
    });

    it('lets custom company holidays override regular weekdays', () => {
        const ganttApi = { setWorkTime: vi.fn() };

        syncGanttWorkTimeCalendar(ganttApi, {
            settings: { workdaysOfWeek: [1, 2, 3, 4, 5] },
            customs: [{ date: '2026-06-05', isOffDay: true }],
            holidays: [],
        });

        expect(ganttApi.setWorkTime).toHaveBeenCalledWith({
            date: new Date(2026, 5, 5),
            hours: false,
        });
    });
});
