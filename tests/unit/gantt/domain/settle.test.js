import { describe, expect, it, vi } from 'vitest';
import { settleAndPersist } from '../../../../src/features/gantt/domain/settle.js';

describe('settleAndPersist', () => {
    it('awaits scheduler recalculation before persistence', async () => {
        const calls = [];
        const scheduler = {
            recalculateProject: vi.fn(async () => calls.push('recalc')),
        };
        const persistGanttData = vi.fn(async () => calls.push('persist'));

        await settleAndPersist({
            scheduler,
            persistGanttData,
            projectId: 'p1',
            source: 'agent',
            sync: false,
        });

        expect(calls).toEqual(['recalc', 'persist']);
        expect(persistGanttData).toHaveBeenCalledWith({
            projectId: 'p1',
            source: 'agent',
            sync: false,
        });
    });

    it('uses agent local-only persistence defaults', async () => {
        const scheduler = {
            recalculateProject: vi.fn(),
        };
        const persistGanttData = vi.fn();

        await settleAndPersist({
            scheduler,
            persistGanttData,
            projectId: 'p1',
        });

        expect(persistGanttData).toHaveBeenCalledWith({
            projectId: 'p1',
            source: 'agent',
            sync: false,
        });
    });

    it('forwards fromTaskId to scheduler recalculation', async () => {
        const scheduler = {
            recalculateProject: vi.fn(),
        };
        const persistGanttData = vi.fn();

        await settleAndPersist({
            scheduler,
            persistGanttData,
            projectId: 'p1',
            fromTaskId: 42,
        });

        expect(scheduler.recalculateProject).toHaveBeenCalledWith(42);
    });
});
