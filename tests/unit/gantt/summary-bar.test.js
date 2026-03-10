// tests/unit/gantt/summary-bar.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('summary-bar renderSummaryBar', () => {
    beforeEach(() => {
        global.gantt = {
            addTaskLayer: vi.fn(),
            hasChild: vi.fn(() => true),
            eachTask: vi.fn((cb, parentId) => {
                // 模拟两个子任务
                cb({ id: 2, start_date: new Date('2026-03-01'), end_date: new Date('2026-03-05') });
                cb({ id: 3, start_date: new Date('2026-03-10'), end_date: new Date('2026-03-15') });
            }),
            getTaskPosition: vi.fn((task, start, end) => ({
                left: start.getDate() * 10,
                width: (end - start) / 86400000 * 10,
                top: 4,
                height: 24,
            })),
        };
    });

    it('initSummaryBar 应调用 gantt.addTaskLayer', async () => {
        const { initSummaryBar } = await import('../../../src/features/gantt/summary-bar.js');
        initSummaryBar();
        expect(global.gantt.addTaskLayer).toHaveBeenCalledOnce();
    });

    it('有子任务的父任务应渲染 summary-connector 和多个 summary-segment', async () => {
        let renderFn;
        global.gantt.addTaskLayer = vi.fn(({ renderer }) => {
            renderFn = renderer.render;
        });

        const { initSummaryBar } = await import('../../../src/features/gantt/summary-bar.js?v=test');
        initSummaryBar();

        const parentTask = {
            id: 1,
            start_date: new Date('2026-03-01'),
            end_date: new Date('2026-03-15'),
        };
        const el = renderFn(parentTask);

        expect(el).not.toBe(false);
        expect(el.querySelector('.summary-connector')).not.toBeNull();
        expect(el.querySelectorAll('.summary-segment').length).toBe(2);
    });

    it('无子任务的任务应 return false', async () => {
        global.gantt.hasChild = vi.fn(() => false);
        let renderFn;
        global.gantt.addTaskLayer = vi.fn(({ renderer }) => {
            renderFn = renderer.render;
        });

        const { initSummaryBar } = await import('../../../src/features/gantt/summary-bar.js?v=noChild');
        initSummaryBar();

        const result = renderFn({ id: 99, start_date: new Date(), end_date: new Date() });
        expect(result).toBe(false);
    });
});
