import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/features/gantt/scheduler.js', () => ({
    addWorkDays: vi.fn(async (date, days) => {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }),
    recalculateProjectSchedule: vi.fn(),
}));

const scheduler = await import('../../../../src/features/gantt/scheduler.js');
const { scheduleOps } = await import('../../../../src/features/gantt/domain/schedule-ops.js');

function createGantt(tasks = []) {
    const taskMap = new Map(tasks.map((task) => [task.id, { ...task }]));

    return {
        getTask: vi.fn((id) => {
            const task = taskMap.get(id);
            if (!task) {
                throw new Error('Task not found');
            }
            return task;
        }),
        updateTask: vi.fn(),
    };
}

describe('schedule ops', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects setDates without start, end, or duration', () => {
        const gantt = createGantt([{ id: 1, text: 'Task' }]);

        expect(scheduleOps.setDates.plan({ id: 1 }, { gantt })).toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'At least one of start, end, or duration is required.',
                hint: 'Provide start, end, duration, or use schedule.move.',
            },
        });
    });

    it('sets start, end, and duration with a diff', () => {
        const gantt = createGantt([
            {
                id: 1,
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);

        const plan = scheduleOps.setDates.plan(
            { id: 1, start: '2026-07-02', end: '2026-07-06', duration: 3 },
            { gantt }
        );

        expect(plan.diff.updated).toEqual([
            {
                id: 1,
                fields: {
                    start_date: {
                        old: new Date(2026, 6, 1).toISOString(),
                        new: '2026-07-02',
                    },
                    end_date: {
                        old: new Date(2026, 6, 3).toISOString(),
                        new: '2026-07-06',
                    },
                    duration: { old: 2, new: 3 },
                },
            },
        ]);

        scheduleOps.setDates.commit(plan, { gantt });

        expect(gantt.updateTask).toHaveBeenCalledWith(1);
        expect(gantt.getTask(1).start_date).toBeInstanceOf(Date);
    });

    it('moves start and end by working days through scheduler utilities', async () => {
        const gantt = createGantt([
            {
                id: 1,
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);

        const plan = await scheduleOps.move.plan({ id: 1, days: 2 }, { gantt });

        expect(scheduler.addWorkDays).toHaveBeenCalledWith(new Date(2026, 6, 1), 2, undefined);
        expect(scheduler.addWorkDays).toHaveBeenCalledWith(new Date(2026, 6, 3), 2, undefined);
        expect(plan.diff.updated[0].fields.start_date.new).toEqual(new Date(2026, 6, 3));
        expect(plan.diff.updated[0].fields.end_date.new).toEqual(new Date(2026, 6, 5));

        scheduleOps.move.commit(plan, { gantt });

        expect(gantt.updateTask).toHaveBeenCalledWith(1);
    });

    it('rejects move planning for tasks without start or end dates', async () => {
        const gantt = createGantt([{ id: 1, text: 'Undated task' }]);

        await expect(scheduleOps.move.plan({ id: 1, days: 2 }, { gantt })).resolves.toEqual({
            ok: false,
            error: {
                code: 'BAD_ARGS',
                message: 'Task has no schedule dates to move.',
                hint: 'Set start_date or end_date before using schedule.move.',
            },
        });
        expect(scheduler.addWorkDays).not.toHaveBeenCalled();
    });

    it('recalculates through the awaitable scheduler path', async () => {
        const plan = scheduleOps.recalc.plan({ fromTaskId: 12 }, {});

        await scheduleOps.recalc.commit(plan, {});

        expect(scheduler.recalculateProjectSchedule).toHaveBeenCalledWith(12);
    });
});
