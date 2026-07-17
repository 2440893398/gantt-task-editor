import { expect, test } from '@playwright/test';
import { clearAllTasks, waitForAgentBootstrap } from './helpers.js';

// 业务轨迹：Agent 犯错后依靠结构化错误 + 只读 nextAction 自愈，以及安全边界。

test.describe('agent journey: 错误自愈与安全边界', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);
        await clearAllTasks(page);
    });

    test('[SCN-AGT-009] 非法写入 → nextAction 指引只读探索 → 修正后重试成功', async ({ page }) => {
        const journey = await page.evaluate(async () => {
            // Deliberate mistake: an agent that has not read the form schema
            // omits the required assignee field.
            const attempt = await window.app.task.create({
                values: { text: '自愈任务', start_date: '2026-03-02', end_date: '2026-03-04' },
            });
            if (attempt.ok) return { attempt };

            const nextAction = attempt.error?.nextAction;
            let guided = null;
            if (nextAction?.command) {
                // Follow the machine-readable guidance verbatim; it must be read-only.
                const [group, method] = nextAction.command.split('.');
                guided = await window.app[group][method](nextAction.args || {});
            }

            // Correct the mistake based on what the guided read taught us.
            const retry = await window.app.task.create({
                values: {
                    text: '自愈任务',
                    assignee: '阿珍',
                    start_date: '2026-03-02',
                    end_date: '2026-03-04',
                },
            });
            return { attempt, nextAction, guidedOk: guided?.ok ?? null, retry };
        });

        expect(journey.attempt.ok).toBe(false);
        expect(journey.attempt.error.code).toBe('INVALID_FIELD_VALUE');
        expect(journey.attempt.error.field).toBe('assignee');
        expect(journey.nextAction?.command).toBe('form.field');
        expect(journey.guidedOk).toBe(true);
        expect(journey.retry.ok, JSON.stringify(journey.retry.error ?? {})).toBe(true);
        expect(journey.retry.data.task.duration).toBe(3);
    });

    test('[SCN-AGT-010] 未知任务返回 NOT_FOUND，且不影响后续命令', async ({ page }) => {
        const outcome = await page.evaluate(async () => {
            const missing = await window.app.task.get({ id: 999999 });
            const stillWorks = await window.app.state.snapshot({ level: 'summary' });
            return { missing, stillWorks };
        });

        expect(outcome.missing.ok).toBe(false);
        expect(outcome.missing.error.code).toBe('NOT_FOUND');
        expect(outcome.stillWorks.ok).toBe(true);
    });
});

test.describe('agent journey: 只读模式', () => {
    test('[SCN-AGT-011] agentReadOnly=1 时读命令可用、写命令被拒且数据不变', async ({ page }) => {
        await page.goto('/?agentReadOnly=1');
        await waitForAgentBootstrap(page);

        const outcome = await page.evaluate(async () => {
            const read = await window.app.state.snapshot({ level: 'summary' });
            const write = await window.app.task.create({ values: { text: '越权任务' } });
            const after = await window.app.state.snapshot({ level: 'summary' });
            return { read, write, after };
        });

        expect(outcome.read.ok).toBe(true);
        expect(outcome.write.ok).toBe(false);
        expect(outcome.write.error.code).toBe('CONSTRAINT');
        expect(outcome.after.data.taskCount).toBe(outcome.read.data.taskCount);
    });
});
