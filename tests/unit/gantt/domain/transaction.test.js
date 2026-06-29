import { describe, expect, it, vi } from 'vitest';
import { runGanttTransaction } from '../../../../src/features/gantt/domain/transaction.js';

describe('gantt transaction', () => {
    it('returns successful work data without restoring the snapshot', async () => {
        const serialized = { data: [{ id: 1, text: 'Before' }], links: [] };
        const data = { taskId: 1 };
        const gantt = {
            serialize: vi.fn(() => serialized),
            clearAll: vi.fn(),
            parse: vi.fn(),
            render: vi.fn(),
        };

        const result = await runGanttTransaction({
            gantt,
            work: async () => data,
        });

        expect(result).toEqual({ ok: true, data });
        expect(gantt.clearAll).not.toHaveBeenCalled();
        expect(gantt.parse).not.toHaveBeenCalled();
        expect(gantt.render).not.toHaveBeenCalled();
    });

    it('restores serialized data when commit throws', async () => {
        const serialized = { data: [{ id: 1, text: 'Before' }], links: [] };
        const gantt = {
            serialize: vi.fn(() => serialized),
            clearAll: vi.fn(),
            parse: vi.fn(),
            render: vi.fn(),
        };

        const result = await runGanttTransaction({
            gantt,
            work: async () => {
                throw new Error('boom');
            },
        });

        expect(result.ok).toBe(false);
        expect(gantt.clearAll).toHaveBeenCalledTimes(1);
        expect(gantt.parse).toHaveBeenCalledWith(serialized);
        expect(gantt.render).toHaveBeenCalledTimes(1);
    });

    it('restores injected history snapshot when work throws after history side effects', async () => {
        const serialized = { data: [{ id: 1, text: 'Before' }], links: [] };
        const historySnapshot = {
            undoStack: [{ op: 'update', taskId: 1 }],
            redoStack: [],
            applyingHistoryOperation: false,
        };
        const history = {
            snapshot: vi.fn(() => historySnapshot),
            restore: vi.fn(),
        };
        const gantt = {
            serialize: vi.fn(() => serialized),
            clearAll: vi.fn(),
            parse: vi.fn(),
            render: vi.fn(),
        };

        const result = await runGanttTransaction({
            gantt,
            history,
            work: async () => {
                throw new Error('persist failed');
            },
        });

        expect(result.ok).toBe(false);
        expect(history.snapshot).toHaveBeenCalledTimes(1);
        expect(history.restore).toHaveBeenCalledWith(historySnapshot);
        expect(gantt.parse).toHaveBeenCalledWith(serialized);
    });
});
