import { expect, test } from '@playwright/test';
import { clearAllTasks, runBatch, waitForAgentBootstrap } from './helpers.js';

// 已拍板需求的守望测试（2026-07-15 用户决策，见 tests/scenarios/agent-cli.md 例外队列）。
// 每个用例编码正确的业务期望。BUG-AGT-03/04/05 已于 2026-07-15 修复，
// 守望标记已摘除，本文件此后作为拍板语义的回归保护。

test.describe('requirement watch: 已拍板语义', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);
        await clearAllTasks(page);
    });

    test('[SCN-AGT-023] 孤立创建按日历天：duration 4 跨周末 end = start + 3 天', async ({
        page,
    }) => {
        // 无依赖的 task.create 当前已符合日历天语义——本用例是回归保护，
        // 防止修复 BUG-AGT-03（重排路径）时破坏这条正确行为。
        const created = await page.evaluate(() =>
            window.app.task.create({
                values: {
                    text: '跨周末任务',
                    assignee: '阿珍',
                    start_date: '2026-03-05',
                    duration: 4,
                },
            })
        );
        expect(created.ok, JSON.stringify(created.error ?? {})).toBe(true);
        expect(created.data.task.end_date).toBe('2026-03-08');
        expect(created.data.task.duration).toBe(4);
    });

    test('[SCN-AGT-023] 带依赖重排后日历工期保持不变', async ({ page }) => {
        // BUG-AGT-03 已修复（2026-07-15）：重排只平移，日历工期守恒。
        const seeded = await runBatch(page, [
            {
                op: 'task.create',
                as: 'up',
                args: {
                    values: {
                        text: '上游任务',
                        assignee: '阿珍',
                        start_date: '2026-03-02',
                        duration: 3,
                    },
                },
            },
            {
                op: 'task.create',
                as: 'down',
                args: {
                    values: {
                        text: '下游任务',
                        assignee: '阿强',
                        start_date: '2026-03-05',
                        duration: 4,
                    },
                },
            },
            { op: 'link.add', args: { source: '$up', target: '$down', type: 'fs' } },
        ]);
        expect(seeded.ok, JSON.stringify(seeded.error ?? {})).toBe(true);

        const downDuration = await page.evaluate(async () => {
            const list = await window.app.task.list({ fields: ['id', 'text', 'duration'] });
            return list.data.find((task) => task.text === '下游任务')?.duration;
        });
        expect(downDuration).toBe(4);
    });

    test('[SCN-AGT-022] 受 FS 约束任务 move 显式报错且数据不变', async ({ page }) => {
        // BUG-AGT-04 已修复（2026-07-15）：受约束任务 move 返回 CONSTRAINT + nextAction。
        const seeded = await runBatch(page, [
            {
                op: 'task.create',
                as: 'up',
                args: {
                    values: {
                        text: '上游',
                        assignee: '阿珍',
                        start_date: '2026-03-02',
                        duration: 3,
                    },
                },
            },
            {
                op: 'task.create',
                as: 'down',
                args: {
                    values: {
                        text: '下游',
                        assignee: '阿强',
                        start_date: '2026-03-05',
                        duration: 2,
                    },
                },
            },
            { op: 'link.add', args: { source: '$up', target: '$down', type: 'fs' } },
        ]);
        expect(seeded.ok, JSON.stringify(seeded.error ?? {})).toBe(true);

        const outcome = await page.evaluate(async () => {
            const list = await window.app.task.list({ fields: ['id', 'text', 'start_date'] });
            const down = list.data.find((task) => task.text === '下游');
            const moved = await window.app.schedule.move({ id: down.id, days: 2 });
            const after = await window.app.task.get({ id: down.id });
            return { moved, before: down.start_date, after: after.data.start_date };
        });

        expect(outcome.moved.ok).toBe(false);
        expect(outcome.moved.error?.message).toBeTruthy();
        expect(outcome.after).toBe(outcome.before);
    });

    test('[SCN-AGT-024] 子任务负责人不同时，父任务 assignee 聚合全部负责人', async ({ page }) => {
        // BUG-AGT-05 已修复（2026-07-15）：rollupAssignee 去重聚合全部子任务负责人。
        const seeded = await runBatch(page, [
            {
                op: 'task.create',
                as: 'phase',
                args: { values: { text: '阶段', assignee: '项目组' } },
            },
            {
                op: 'task.create',
                args: {
                    parent: '$phase',
                    values: {
                        text: '子甲',
                        assignee: '阿珍',
                        start_date: '2026-03-02',
                        duration: 2,
                    },
                },
            },
            {
                op: 'task.create',
                args: {
                    parent: '$phase',
                    values: {
                        text: '子乙',
                        assignee: '阿强',
                        start_date: '2026-03-04',
                        duration: 2,
                    },
                },
            },
        ]);
        expect(seeded.ok, JSON.stringify(seeded.error ?? {})).toBe(true);

        const parentAssignee = await page.evaluate(async () => {
            const list = await window.app.task.list({ fields: ['id', 'text', 'assignee'] });
            return list.data.find((task) => task.text === '阶段')?.assignee ?? '';
        });

        expect(parentAssignee).toContain('阿珍');
        expect(parentAssignee).toContain('阿强');
    });

    test('[SCN-AGT-027] 父子任务间依赖被拒绝且排期保持稳定', async ({ page }) => {
        const seeded = await runBatch(page, [
            {
                op: 'task.create',
                as: 'parent',
                args: {
                    values: {
                        text: '汇总阶段',
                        assignee: '项目组',
                        start_date: '2026-03-02',
                        duration: 5,
                    },
                },
            },
            {
                op: 'task.create',
                as: 'child',
                args: {
                    parent: '$parent',
                    values: {
                        text: '阶段子任务',
                        assignee: '阿珍',
                        start_date: '2026-03-02',
                        duration: 5,
                    },
                },
            },
        ]);
        expect(seeded.ok, JSON.stringify(seeded.error ?? {})).toBe(true);

        const outcome = await page.evaluate(async () => {
            const before = await window.app.task.list({
                fields: ['id', 'text', 'start_date', 'end_date'],
            });
            const parent = before.data.find((task) => task.text === '汇总阶段');
            const child = before.data.find((task) => task.text === '阶段子任务');
            const linked = await window.app.link.add({
                source: parent.id,
                target: child.id,
                type: 'fs',
            });
            const after = await window.app.task.list({
                fields: ['id', 'text', 'start_date', 'end_date'],
            });
            const links = await window.app.link.list();
            return { before: before.data, linked, after: after.data, links: links.data };
        });

        expect(outcome.linked.ok).toBe(false);
        expect(outcome.linked.error?.code).toBe('CYCLE');
        expect(outcome.links).toEqual([]);
        expect(outcome.after).toEqual(outcome.before);
    });
});
