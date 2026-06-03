import { afterEach, describe, expect, test, vi } from 'vitest';

vi.unmock('../../../src/features/gantt/scheduler.js');

vi.mock('../../../src/features/ai/services/undoManager.js', () => ({
    default: {
        saveState: vi.fn(),
    },
}));

describe('gantt task bar move scheduling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        vi.useRealTimers();
        delete global.gantt;
    });

    test('moving a task keeps original duration and recalculates end date with gantt work calendar', async () => {
        vi.useFakeTimers();

        const { initScheduler } = await import('../../../src/features/gantt/scheduler.js');
        const handlers = {};
        const task = {
            id: 1,
            parent: 0,
            start_date: new Date('2026-03-13'),
            end_date: new Date('2026-03-18'),
            duration: 3,
        };
        const calendarEnd = new Date('2026-04-08');

        global.gantt = {
            attachEvent: vi.fn((eventName, handler) => {
                handlers[eventName] = handler;
                return true;
            }),
            getTask: vi.fn(() => task),
            getChildren: vi.fn(() => []),
            getLinks: vi.fn(() => []),
            calculateEndDate: vi.fn(() => calendarEnd),
            updateTask: vi.fn(),
        };

        initScheduler();

        expect(handlers.onBeforeTaskDrag(1, 'move')).toBe(true);

        task.start_date = new Date('2026-04-03');
        task.end_date = new Date('2026-04-23');

        expect(handlers.onAfterTaskDrag(1, 'move')).toBe(true);
        await vi.runAllTimersAsync();

        expect(gantt.calculateEndDate).toHaveBeenCalledWith(task.start_date, 3);
        expect(task.duration).toBe(3);
        expect(task.end_date).toBe(calendarEnd);
        expect(gantt.updateTask).toHaveBeenCalledWith(1);
    });
});
