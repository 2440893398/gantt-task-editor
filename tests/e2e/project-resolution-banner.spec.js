import { expect, test } from '@playwright/test';

/**
 * SCN-AGT-034 —— 直达链接失效必须有声。
 *
 * 这条测试在什么坏行为下会失败：回到"`?project=` 找不到就静默回退到首个项目，并用
 * replaceState 把地址栏改写成回退后的 id"。那种行为下，用户和 Agent 看到的都是一个
 * "空项目"，与"数据在另一台机器/另一个浏览器 profile/另一个 preview origin"完全无法
 * 区分——这正是外部 Agent 排查约一小时的直接原因。
 *
 * 横幅的可见性按 tests/scenarios/README.md 规则 7 只认浏览器级验证：jsdom 里
 * 可见性要么恒为 0，要么来自 mock，断言的是 mock 值本身。
 *
 * 就绪判定用 window.app + dataset.agentApi，不是 `#gantt_here` 可见，也不是
 * networkidle（GA/Clarity/节假日 CDN 会让网络永不空闲）。
 */
async function waitForAgentBootstrap(page) {
    await page.waitForFunction(
        () =>
            Boolean(window.app?.help) && document.documentElement.dataset.agentApi === 'window.app',
        undefined,
        { timeout: 15000 }
    );
}

const ABSENT_PROJECT_ID = 'prj_from_another_machine';

test.describe('project deep link resolution', () => {
    test('[SCN-AGT-034] shows a persistent banner and keeps the requested id in the URL', async ({
        page,
    }) => {
        await page.goto(`/?project=${ABSENT_PROJECT_ID}`);
        await waitForAgentBootstrap(page);

        const banner = page.locator('#project-resolution-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText(ABSENT_PROJECT_ID);

        // 地址栏必须保留用户输入的 id：被改写成回退后的项目，事故现场就没了。
        expect(new URL(page.url()).searchParams.get('project')).toBe(ABSENT_PROJECT_ID);

        // 横幅要一直在（toast 会被后续任何一条 toast 顶掉，所以刻意没用 toast）。
        await page.waitForTimeout(3000);
        await expect(banner).toBeVisible();
    });

    test('[SCN-AGT-034] blocks writes while unresolved and names the local projects', async ({
        page,
    }) => {
        await page.goto(`/?project=${ABSENT_PROJECT_ID}`);
        await waitForAgentBootstrap(page);

        const result = await page.evaluate(() =>
            window.app.task.create({ values: { text: '不该被写进来的任务' } })
        );

        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('PROJECT_NOT_FOUND');
        expect(Array.isArray(result.error.localProjects)).toBe(true);
        expect(result.error.nextAction.command).toBe('project.list');
    });

    test('[SCN-AGT-034] stays silent when the deep link is valid', async ({ page }) => {
        await page.goto('/');
        await waitForAgentBootstrap(page);

        const active = await page.evaluate(async () => {
            const list = await window.app.project.list();
            return list.data.find((project) => project.active)?.id;
        });

        await page.goto(`/?project=${active}`);
        await waitForAgentBootstrap(page);

        await expect(page.locator('#project-resolution-banner')).toHaveCount(0);
        expect(new URL(page.url()).searchParams.get('project')).toBe(active);
    });
});
