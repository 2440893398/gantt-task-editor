import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Workbench V2 browser verification (spec §19.6).
 *
 * Runs against the local `gantt-share` Worker so layout, keyboard and
 * responsive behaviour are checked on the real page rather than on an HTML
 * string. Covers both actors (owner capability + admin session) and the three
 * required viewports.
 */

/**
 * `.dev.vars` is what `wrangler dev` loads, so it is the authority for the
 * Worker under test. A deploy-time `FEEDBACK_ADMIN_PASSWORD` in the ambient
 * shell belongs to another environment and must not be tried against a local
 * Worker.
 */
function readDevVar(name) {
    try {
        const line = readFileSync(new URL('../../../.dev.vars', import.meta.url), 'utf8')
            .split(/\r?\n/)
            .find(
                (entry) =>
                    entry.trim().startsWith(`${name} `) || entry.trim().startsWith(`${name}=`)
            );
        if (!line) return '';
        return line
            .slice(line.indexOf('=') + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
    } catch (error) {
        return '';
    }
}

const ADMIN_PASSWORD =
    readDevVar('FEEDBACK_ADMIN_PASSWORD') || process.env.FEEDBACK_ADMIN_PASSWORD || '';
const VIEWPORTS = [
    { name: '375', width: 375, height: 812 },
    { name: '768', width: 768, height: 1024 },
    { name: '1440', width: 1440, height: 900 },
];

async function createIssue(request, overrides = {}) {
    const response = await request.post('/api/feedback', {
        data: {
            title: 'Workbench 端到端验证反馈',
            description: '提交后应能通过 capability 链接查看时间线。',
            submittedType: 'bug',
            contact: 'e2e@example.com',
            context: { url: 'https://gantt-task-editor.pages.dev/board' },
            ...overrides,
        },
    });
    expect(response.status()).toBe(201);
    return response.json();
}

async function adminToken(request) {
    const response = await request.post('/api/feedback/admin/session', {
        data: { password: ADMIN_PASSWORD },
    });
    expect(response.status(), 'Admin login needs FEEDBACK_ADMIN_PASSWORD in .dev.vars').toBe(200);
    return (await response.json()).token;
}

async function signInAsAdmin(page, token) {
    await page.addInitScript((value) => {
        window.sessionStorage.setItem('feedback.workbench.adminToken', value);
    }, token);
}

function horizontalOverflow(page) {
    return page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
}

test.describe('[SCN-FWB-015] 自动化设置页', () => {
    test('[SCN-FWB-015] 首屏展示核心配置，隐藏成本与轮询对比', async ({ page, request }) => {
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');
        await page.getByRole('button', { name: '自动化', exact: true }).click();

        await expect(page.getByLabel('Hook URL')).toBeVisible();
        await expect(page.getByText('订阅事件')).toBeVisible();
        await expect(page.getByRole('switch', { name: '失败重试' })).toBeVisible();
        await expect(page.getByRole('switch', { name: '失败事件队列' })).toBeVisible();
        await expect(page.getByRole('switch', { name: '每日兜底巡检' })).toBeVisible();
        // §19.4: the daily sweep is identified so it cannot read as an Agent poll.
        await expect(page.locator('#reconcileHint')).toContainText('feedback-reconcile');
        await expect(page.locator('#reconcileStatus')).toContainText('无需处理，Run 数 0');

        // §19.4 forbids cost/polling comparison stats and the event-chain diagram.
        await expect(page.getByText('预计成本')).toHaveCount(0);
        await expect(page.getByText('空跑唤醒')).toHaveCount(0);
        await expect(page.getByText('高频定时轮询')).toHaveCount(0);
        await expect(page.getByText('事件处理链路')).toHaveCount(0);

        // §19.4: signing detail stays collapsed and never shows a plaintext key.
        await expect(page.getByText('签名与端点要求')).toBeVisible();
        await expect(page.locator('#hookSecretRef')).toBeHidden();
    });

    test('[SCN-FWB-015] 保存状态跟随字段变化', async ({ page, request }) => {
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');
        await page.getByRole('button', { name: '自动化', exact: true }).click();

        const save = page.locator('#saveAutomation');
        await expect(save).toBeDisabled();
        await expect(page.locator('#saveAutomationLabel')).toHaveText('已保存');

        await page.getByLabel('Hook URL').fill('https://agent.example.com/hooks/feedback');
        await expect(save).toBeEnabled();
        await expect(page.locator('#saveAutomationLabel')).toHaveText('保存更改');
        // §19.4: editing the endpoint invalidates the verified state immediately.
        await expect(page.locator('#hookStatusBadge')).toHaveText('待验证');

        await save.click();
        await expect(page.locator('#saveAutomationLabel')).toHaveText('已保存', {
            timeout: 10_000,
        });
        await expect(save).toBeDisabled();
    });
});

test.describe('[SCN-FWB-016] AI 执行器页', () => {
    test('[SCN-FWB-016] 首屏聚焦执行器选择、连接与路由', async ({ page, request }) => {
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');
        await page.getByRole('button', { name: 'AI 执行器', exact: true }).click();

        await expect(page.getByRole('button', { name: '当前默认' })).toBeVisible();
        await expect(page.getByRole('button', { name: '设为默认' })).toBeVisible();
        await expect(page.getByRole('button', { name: '测试连接' }).first()).toBeVisible();
        await expect(page.locator('#runnersView').getByText('@codex-agent')).toBeVisible();
        await expect(page.locator('#runnersView').getByText('@claude-agent')).toBeVisible();
        await expect(page.getByLabel('未指定执行器')).toBeVisible();

        // Connection parameters and the Callback contract stay collapsed.
        await expect(page.getByLabel('Responses API 地址')).toBeHidden();
        await expect(page.getByLabel('Callback URL')).toBeHidden();
    });

    test('[SCN-FWB-016] 拦截非 /v1/responses 端点并把焦点交回输入框', async ({ page, request }) => {
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');
        await page.getByRole('button', { name: 'AI 执行器', exact: true }).click();

        const codexCard = page.locator('[data-provider-card="codex"]');
        await codexCard.getByText('连接配置').click();
        const endpoint = page.getByLabel('Responses API 地址');
        await endpoint.fill('https://relay.example.com/v1/chat/completions');

        await codexCard.getByRole('button', { name: '测试连接' }).click();

        await expect(codexCard.locator('[data-connection-status]')).toContainText('/v1/responses');
        await expect(endpoint).toBeFocused();
        await expect(codexCard.locator('[data-connection-badge]')).toHaveText('需修正');
    });

    test('[SCN-FWB-016] 切换默认执行器后需要保存', async ({ page, request }) => {
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');
        await page.getByRole('button', { name: 'AI 执行器', exact: true }).click();

        await page
            .locator('[data-provider-card="claude"]')
            .getByRole('button', { name: '设为默认' })
            .click();
        await expect(page.locator('#runnerSaveState')).toHaveText('有未保存的更改');

        await page.locator('#saveRunnerSettings').click();
        await expect(page.locator('#runnerSaveState')).toHaveText('全部更改已保存', {
            timeout: 10_000,
        });
        await expect(
            page.locator('[data-provider-card="claude"]').getByRole('button', { name: '当前默认' })
        ).toBeVisible();

        // Restore the project default so later runs start from a known state.
        await page
            .locator('[data-provider-card="codex"]')
            .getByRole('button', { name: '设为默认' })
            .click();
        await page.locator('#saveRunnerSettings').click();
        await expect(page.locator('#runnerSaveState')).toHaveText('全部更改已保存', {
            timeout: 10_000,
        });
    });
});

test.describe('[SCN-FWB-017] actor 隔离', () => {
    test('[SCN-FWB-017] owner capability 只打开自己的 Issue，不枚举队列', async ({
        page,
        request,
    }) => {
        const created = await createIssue(request);
        const apiCalls = [];
        page.on('request', (req) => {
            if (req.url().includes('/api/feedback')) apiCalls.push(new URL(req.url()).pathname);
        });

        await page.goto(
            `/feedback#issue=${encodeURIComponent(created.issueId)}&capability=${encodeURIComponent(
                created.ownerCapability
            )}`
        );

        await expect(page.getByRole('heading', { name: /Workbench 端到端验证反馈/ })).toBeVisible();
        await expect(page.locator('#ownerNotice')).toContainText('请保存此页面链接');
        await expect(page.locator('#ownerNotice')).toContainText('不会发送邮件、短信或 IM 通知');

        // §19.1: the queue and the admin settings tabs never appear for an owner.
        await expect(page.locator('#queuePanel')).toBeHidden();
        await expect(page.locator('#topTabs [data-view="automations"]')).toBeHidden();
        await expect(page.locator('#topTabs [data-view="runners"]')).toBeHidden();
        expect(apiCalls).not.toContain('/api/feedback/issues');
        // §21.1: the capability must not stay in the URL.
        expect(page.url()).not.toContain('capability=');
    });

    test('[SCN-FWB-017] 匿名访问只看到登录入口', async ({ page }) => {
        await page.goto('/feedback');

        await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
        await expect(page.locator('#queuePanel')).toBeHidden();
        await expect(page.locator('#composer')).toBeHidden();
    });
});

test.describe('[SCN-FWB-001] 时间线与回复', () => {
    test('[SCN-FWB-001] owner 回复后立即出现在时间线上', async ({ page, request }) => {
        const created = await createIssue(request);
        await page.goto(
            `/feedback#issue=${encodeURIComponent(created.issueId)}&capability=${encodeURIComponent(
                created.ownerCapability
            )}`
        );

        await expect(page.locator('#timeline .comment-card').first()).toBeVisible();
        const before = await page.locator('#timeline .timeline-entry').count();

        await page.locator('#replyInput').fill('补充：导入 Excel 后立即撤销即可复现。');
        await page.locator('#replySubmit').click();

        await expect(page.locator('#replySuccess')).toContainText('已写入时间线');
        await expect(page.locator('#timeline .timeline-entry')).toHaveCount(before + 1, {
            timeout: 10_000,
        });
        await expect(page.locator('#timeline')).toContainText('导入 Excel 后立即撤销');
        // Reloading proves the event was persisted, not just rendered locally.
        await page.reload();
        await expect(page.locator('#timeline')).toContainText('导入 Excel 后立即撤销');
    });

    test('[SCN-FWB-001] 空回复不会提交', async ({ page, request }) => {
        const created = await createIssue(request);
        await page.goto(
            `/feedback#issue=${encodeURIComponent(created.issueId)}&capability=${encodeURIComponent(
                created.ownerCapability
            )}`
        );
        await expect(page.locator('#timeline .comment-card').first()).toBeVisible();
        const before = await page.locator('#timeline .timeline-entry').count();

        await page.locator('#replySubmit').click();

        await expect(page.locator('#toastText')).toHaveText('请先填写回复内容');
        await expect(page.locator('#timeline .timeline-entry')).toHaveCount(before);
    });
});

test.describe('[SCN-FWB-015][SCN-FWB-016] 响应式与可访问性', () => {
    for (const viewport of VIEWPORTS) {
        test(`[SCN-FWB-015] ${viewport.name} 宽度无横向溢出（admin 三个页面）`, async ({
            page,
            request,
            browser,
        }) => {
            const token = await adminToken(request);
            const context = await browser.newContext({
                viewport: { width: viewport.width, height: viewport.height },
            });
            const scoped = await context.newPage();
            await scoped.addInitScript((value) => {
                window.sessionStorage.setItem('feedback.workbench.adminToken', value);
            }, token);

            try {
                await scoped.goto('/feedback');
                await expect(scoped.locator('#issueView')).toBeVisible();
                expect(await horizontalOverflow(scoped)).toBeLessThanOrEqual(0);

                for (const view of ['自动化', 'AI 执行器']) {
                    await scoped.getByRole('button', { name: view, exact: true }).click();
                    await expect(scoped.locator('.settings-view.active')).toBeVisible();
                    expect(await horizontalOverflow(scoped)).toBeLessThanOrEqual(0);
                }
            } finally {
                await context.close();
            }
        });

        test(`[SCN-FWB-019] ${viewport.name} 宽度 owner 视图保留下一步`, async ({
            request,
            browser,
        }) => {
            const created = await createIssue(request);
            const context = await browser.newContext({
                viewport: { width: viewport.width, height: viewport.height },
            });
            const scoped = await context.newPage();

            try {
                await scoped.goto(
                    `/feedback#issue=${encodeURIComponent(
                        created.issueId
                    )}&capability=${encodeURIComponent(created.ownerCapability)}`
                );
                // §19.2/§19.6: current state and next step stay visible on every viewport.
                await expect(scoped.locator('#nextActionCard')).toBeVisible();
                await expect(scoped.locator('#propertyCard')).toBeVisible();
                expect(await horizontalOverflow(scoped)).toBeLessThanOrEqual(0);
            } finally {
                await context.close();
            }
        });
    }

    test('[SCN-FWB-015] 375 宽度下可见控件命中区不小于 44px', async ({ request, browser }) => {
        const created = await createIssue(request);
        const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const scoped = await context.newPage();

        try {
            await scoped.goto(
                `/feedback#issue=${encodeURIComponent(
                    created.issueId
                )}&capability=${encodeURIComponent(created.ownerCapability)}`
            );
            await expect(scoped.locator('#replySubmit')).toBeVisible();

            const small = await scoped.evaluate(() => {
                const selectors = ['button', 'select', '[role="switch"]', 'summary'];
                return Array.from(document.querySelectorAll(selectors.join(',')))
                    .filter((node) => node.getClientRects().length > 0)
                    .map((node) => ({
                        label:
                            node.getAttribute('aria-label') ||
                            (node.textContent || '').trim().slice(0, 24) ||
                            node.id,
                        height: Math.round(node.getBoundingClientRect().height),
                    }))
                    .filter((entry) => entry.height < 44);
            });

            expect(small).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('[SCN-FWB-015] 图标按钮和开关暴露可访问名称与状态', async ({ page, request }) => {
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');

        await expect(page.getByRole('button', { name: '刷新工作台' })).toBeVisible();
        await expect(page.getByRole('button', { name: '退出管理员登录' })).toBeVisible();

        await page.getByRole('button', { name: '自动化', exact: true }).click();
        const retry = page.getByRole('switch', { name: '失败重试' });
        const before = await retry.getAttribute('aria-checked');
        await retry.click();
        await expect(retry).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
    });

    test('[SCN-FWB-015] 键盘可以完成队列选择与筛选切换', async ({ page, request }) => {
        await createIssue(request);
        await signInAsAdmin(page, await adminToken(request));
        await page.goto('/feedback');

        const allFilter = page.getByRole('button', { name: '全部', exact: true });
        await allFilter.focus();
        await page.keyboard.press('Enter');
        await expect(allFilter).toHaveAttribute('aria-pressed', 'true');

        const firstIssue = page.locator('#issueList .issue-item').first();
        await expect(firstIssue).toBeVisible();
        await firstIssue.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#propertyCard')).toBeVisible();
    });
});
