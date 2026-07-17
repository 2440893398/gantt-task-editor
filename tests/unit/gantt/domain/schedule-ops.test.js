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
const { reconcileScheduleFields, scheduleOps } =
    await import('../../../../src/features/gantt/domain/schedule-ops.js');

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

    // 工期语义 = 日历天（2026-07-15 拍板，EXC-AGT-01）：07-02..07-06 含端点 = 5 天。
    it('sets start, end, and duration with a diff', () => {
        const gantt = createGantt([
            {
                id: 1,
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);
        const history = { saveState: vi.fn() };

        const plan = scheduleOps.setDates.plan(
            { id: 1, start: '2026-07-02', end: '2026-07-06', duration: 5 },
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
                    duration: { old: 2, new: 5 },
                },
            },
        ]);

        scheduleOps.setDates.commit(plan, { gantt, undoManager: history });

        expect(history.saveState).toHaveBeenCalledWith(1);
        expect(gantt.updateTask).toHaveBeenCalledWith(1);
        expect(gantt.getTask(1).start_date).toBeInstanceOf(Date);
        expect(gantt.getTask(1).end_date).toEqual(new Date(2026, 6, 7));
        expect(gantt.getTask(1).duration).toBe(5);
    });

    it('rejects inconsistent start, end, and duration (calendar days)', () => {
        const gantt = createGantt([
            {
                id: 1,
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);

        const result = scheduleOps.setDates.plan(
            { id: 1, start: '2026-07-02', end: '2026-07-06', duration: 3 },
            { gantt }
        );

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('BAD_ARGS');
    });

    it('[SCN-AGT-025] includes the derived end_date in the duration-only plan diff', () => {
        // BUG-AGT-01 回归保护：仅传 duration 时 end_date 必须同步重算，
        // 否则 settle 以旧起止日期反推工期、改动被静默覆盖。
        const gantt = createGantt([
            {
                id: 1,
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);
        const history = { saveState: vi.fn() };

        const plan = scheduleOps.setDates.plan({ id: 1, duration: 5 }, { gantt });
        expect(plan.diff.updated[0].fields.end_date.new).toEqual(new Date(2026, 6, 6));
        scheduleOps.setDates.commit(plan, { gantt, undoManager: history });

        expect(gantt.getTask(1).duration).toBe(5);
        expect(gantt.getTask(1).end_date).toEqual(new Date(2026, 6, 6));
    });

    it('[SCN-AGT-025] derives start_date when an undated task receives end and duration', () => {
        const gantt = createGantt([{ id: 1, text: 'Undated task' }]);
        const history = { saveState: vi.fn() };

        const plan = scheduleOps.setDates.plan(
            { id: 1, end: '2026-07-06', duration: 5 },
            { gantt }
        );

        expect(plan.diff.updated[0].fields.start_date.new).toEqual(new Date(2026, 6, 2));
        scheduleOps.setDates.commit(plan, { gantt, undoManager: history });
        expect(gantt.getTask(1).start_date).toEqual(new Date(2026, 6, 2));
        expect(gantt.getTask(1).end_date).toEqual(new Date(2026, 6, 7));
        expect(gantt.getTask(1).duration).toBe(5);
    });

    it('[SCN-AGT-025] preserves an ISO datetime boundary when deriving start_date', () => {
        const gantt = createGantt([{ id: 1, text: 'Undated task' }]);

        const plan = scheduleOps.setDates.plan(
            { id: 1, end: '2026-07-06T00:00:00.000Z', duration: 5 },
            { gantt }
        );

        expect(plan.changes.end_date).toEqual(new Date('2026-07-06T00:00:00.000Z'));
        expect(plan.changes.start_date).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    });

    it('[SCN-GUI-008] keeps end fixed when start changes in start_end mode', () => {
        const task = {
            start_date: new Date(2026, 6, 2),
            end_date: new Date(2026, 6, 6),
            duration: 5,
            schedule_mode: 'start_end',
        };

        reconcileScheduleFields(
            task,
            { start_date: task.start_date },
            { respectScheduleMode: true }
        );

        expect(task.end_date).toEqual(new Date(2026, 6, 6));
        expect(task.duration).toBe(4);
    });

    it('[SCN-GUI-008] keeps duration fixed when end changes in start_duration mode', () => {
        const task = {
            start_date: new Date(2026, 6, 1),
            end_date: new Date(2026, 6, 6),
            duration: 2,
            schedule_mode: 'start_duration',
        };

        reconcileScheduleFields(task, { end_date: task.end_date }, { respectScheduleMode: true });

        expect(task.start_date).toEqual(new Date(2026, 6, 4));
        expect(task.duration).toBe(2);
    });

    it('[SCN-GUI-008] does not rewrite duration when end_date is cleared', () => {
        const task = {
            start_date: new Date(2026, 6, 1),
            end_date: null,
            duration: 5,
            schedule_mode: 'start_duration',
        };

        reconcileScheduleFields(task, { end_date: null }, { respectScheduleMode: true });

        expect(task.start_date).toEqual(new Date(2026, 6, 1));
        expect(task.end_date).toBeNull();
        expect(task.duration).toBe(5);
    });

    it('moves start by working days and preserves calendar duration', async () => {
        // 工期守恒（EXC-AGT-01）：end 由新 start + 日历工期推导，不独立位移。
        const gantt = createGantt([
            {
                id: 1,
                start_date: new Date(2026, 6, 1),
                end_date: new Date(2026, 6, 3),
                duration: 2,
            },
        ]);

        const plan = await scheduleOps.move.plan({ id: 1, days: 2 }, { gantt });

        expect(scheduler.addWorkDays).toHaveBeenCalledTimes(1);
        expect(scheduler.addWorkDays).toHaveBeenCalledWith(new Date(2026, 6, 1), 2, undefined);
        expect(plan.diff.updated[0].fields.start_date.new).toEqual(new Date(2026, 6, 3));
        expect(plan.diff.updated[0].fields.end_date.new).toEqual(new Date(2026, 6, 5));

        scheduleOps.move.commit(plan, { gantt, undoManager: { saveState: vi.fn() } });

        expect(gantt.updateTask).toHaveBeenCalledWith(1);
        expect(gantt.getTask(1).duration).toBe(2);
    });

    it('rejects move for tasks pinned by incoming FS links', async () => {
        // BUG-AGT-04 回归保护（EXC-AGT-03 拍板）：受约束任务显式报错而非静默拉回。
        const gantt = createGantt([
            {
                id: 2,
                start_date: new Date(2026, 6, 6),
                end_date: new Date(2026, 6, 8),
                duration: 2,
            },
        ]);
        gantt.getLinks = vi.fn(() => [{ id: 9, source: 1, target: 2, type: '0' }]);

        const result = await scheduleOps.move.plan({ id: 2, days: 2 }, { gantt });

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('CONSTRAINT');
        expect(result.error.nextAction).toEqual({
            command: 'link.list',
            args: { taskId: 2 },
            reason: 'Inspect the incoming dependency links that pin this task.',
        });
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
