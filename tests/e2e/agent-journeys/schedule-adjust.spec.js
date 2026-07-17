import { expect, test } from '@playwright/test';
import {
    captureBusinessState,
    clearAllTasks,
    expectGolden,
    runBatch,
    waitForAgentBootstrap,
} from './helpers.js';

// 业务轨迹：Agent 调整既有计划的排期（改工期、平移、撤销）。
// SCN-AGT-006 固化历史坑：task.update 改 end/duration 曾在 settle 后静默回退。

async function seedPlan(page) {
    const seeded = await runBatch(page, [
        {
            op: 'task.create',
            as: 'design',
            args: {
                values: { text: '设计', assignee: '阿珍', start_date: '2026-03-02', duration: 3 },
            },
        },
        {
            op: 'task.create',
            as: 'build',
            args: {
                values: { text: '施工', assignee: '阿强', start_date: '2026-03-05', duration: 4 },
            },
        },
        { op: 'link.add', args: { source: '$design', target: '$build', type: 'fs' } },
    ]);
    expect(seeded.ok, JSON.stringify(seeded.error ?? {})).toBe(true);
}

async function findTaskId(page, text) {
    const id = await page.evaluate(async (name) => {
        const list = await window.app.task.list({ fields: ['id', 'text'] });
        return list.data.find((task) => task.text === name)?.id ?? null;
    }, text);
    expect(id).not.toBeNull();
    return id;
}

test.describe('agent journey: 排期调整', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);
        await clearAllTasks(page);
        await seedPlan(page);
    });

    test('[SCN-AGT-006] 改已有任务工期，settle 后真实生效不回退', async ({ page }) => {
        // BUG-AGT-01 已修复（2026-07-15）：commitTaskChanges 现按日历天补齐 end_date，
        // 改动在 settle 后守恒。本用例守护该行为不回归。
        const designId = await findTaskId(page, '设计');

        const outcome = await page.evaluate(async (id) => {
            const changed = await window.app.schedule.setDates({ id, duration: 5 });
            const readBack = await window.app.task.get({ id });
            return { changed, task: readBack.data };
        }, designId);

        expect(outcome.changed.ok, JSON.stringify(outcome.changed.error ?? {})).toBe(true);
        expect(outcome.task.duration).toBe(5);

        expectGolden('schedule-extend-duration', await captureBusinessState(page));
    });

    test('[SCN-AGT-007] 平移上游任务，下游沿依赖级联顺延', async ({ page }) => {
        // 只能平移无入向依赖的上游任务；受 FS 约束的下游任务 move 会返回
        // CONSTRAINT（EXC-AGT-03 已拍板，见 requirement-watch SCN-AGT-022）。
        const designId = await findTaskId(page, '设计');

        const moved = await page.evaluate(
            (id) => window.app.schedule.move({ id, days: 2 }),
            designId
        );
        expect(moved.ok, JSON.stringify(moved.error ?? {})).toBe(true);

        expectGolden('schedule-move-cascade', await captureBusinessState(page));
    });

    test('[SCN-AGT-008] session.undo 使业务状态回到操作前', async ({ page }) => {
        // BUG-AGT-02 已修复（2026-07-15）：schedule 写命令进入撤销栈，undo 精确回滚
        // 最后一次 mutation，不再波及先前 batch 产物。
        const before = await captureBusinessState(page);
        const designId = await findTaskId(page, '设计');

        const changed = await page.evaluate(
            (id) => window.app.schedule.setDates({ id, duration: 7 }),
            designId
        );
        expect(changed.ok).toBe(true);

        const undone = await page.evaluate(() => window.app.session.undo({}));
        expect(undone.ok, JSON.stringify(undone.error ?? {})).toBe(true);

        expect(await captureBusinessState(page)).toEqual(before);
    });
});
