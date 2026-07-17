import { test, expect } from '@playwright/test';

test.describe('AI Analysis Skills Routing', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem(
                'gantt_ai_config',
                JSON.stringify({
                    apiKey: 'sk-test-key',
                    baseUrl: 'https://mock-ai.example/v1',
                    model: 'gpt-3.5-turbo',
                })
            );
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.locator('#ai_floating_btn').click();
        await expect(page.locator('#ai_drawer')).toBeVisible({ timeout: 5000 });
    });

    test('[SCN-AIC-002] dependency analysis query routes to correct skill', async ({ page }) => {
        let capturedSystem = '';
        // Mock API to simulate tool call for dependency analysis
        await page.route('https://mock-ai.example/v1/chat/completions', async (route) => {
            const request = route.request();
            const postData = request.postDataJSON();
            const _userMsg = postData.messages?.find((m) => m.role === 'user');

            // Check if the system prompt contains dependency analysis skill context
            const systemMsg = postData.messages?.find((m) => m.role === 'system');
            capturedSystem = systemMsg?.content || '';
            const hasDependencyContext =
                systemMsg?.content?.includes('dependency') || systemMsg?.content?.includes('依赖');

            const responseText = hasDependencyContext
                ? '根据依赖分析，[#1.1] 需求分析 是关键路径上的任务，它阻塞了 [#1.2] 设计登录页面。'
                : '我可以帮您分析任务依赖关系。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`,
            });
        });

        const input = page.locator('#ai_chat_input');
        await input.fill('分析任务依赖关系和关键路径');
        await input.press('Enter');

        await expect(page.locator('#ai_drawer_messages')).toContainText('阻塞了', {
            timeout: 10000,
        });
        expect(capturedSystem).toContain('dependency-analysis');
    });

    test('[SCN-AIC-002] resource analysis query returns workload info', async ({ page }) => {
        let capturedSystem = '';
        await page.route('https://mock-ai.example/v1/chat/completions', async (route) => {
            const postData = route.request().postDataJSON();
            capturedSystem = postData.messages?.find((m) => m.role === 'system')?.content || '';
            const responseText =
                '当前资源负荷分析：张三负责3个任务，工作负荷较高。李四有2个任务，负荷适中。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`,
            });
        });

        const input = page.locator('#ai_chat_input');
        await input.fill('查看资源负荷和人员工作量');
        await input.press('Enter');
        await expect(page.locator('#ai_drawer_messages')).toContainText('工作负荷较高', {
            timeout: 10000,
        });
        expect(capturedSystem).toContain('resource-analysis');
    });

    test('[SCN-AIC-002] timeline analysis query returns deadline info', async ({ page }) => {
        let capturedSystem = '';
        await page.route('https://mock-ai.example/v1/chat/completions', async (route) => {
            const postData = route.request().postDataJSON();
            capturedSystem = postData.messages?.find((m) => m.role === 'system')?.content || '';
            const responseText =
                '时间线分析：[#2.1] 实现用户认证 将于下周五到期，[#3.1] 集成测试 已延期2天。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`,
            });
        });

        const input = page.locator('#ai_chat_input');
        await input.fill('分析时间线偏差和即将到期的任务');
        await input.press('Enter');
        await expect(page.locator('#ai_drawer_messages')).toContainText('下周五到期', {
            timeout: 10000,
        });
        expect(capturedSystem).toContain('timeline-analysis');
    });

    test('[SCN-AIC-002] project summary query aggregates overall status', async ({ page }) => {
        let capturedSystem = '';
        await page.route('https://mock-ai.example/v1/chat/completions', async (route) => {
            const postData = route.request().postDataJSON();
            capturedSystem = postData.messages?.find((m) => m.role === 'system')?.content || '';
            const responseText =
                '项目概览：共15个任务，已完成5个(33%)，进行中6个(40%)，未开始4个(27%)。整体进度正常。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`,
            });
        });

        const input = page.locator('#ai_chat_input');
        await input.fill('请生成项目总结报告');
        await input.press('Enter');
        await expect(page.locator('#ai_drawer_messages')).toContainText('整体进度正常', {
            timeout: 10000,
        });
        expect(capturedSystem).toContain('project-summary');
    });

    test('[SCN-AIC-002] field info query returns custom fields data', async ({ page }) => {
        let capturedSystem = '';
        await page.route('https://mock-ai.example/v1/chat/completions', async (route) => {
            const postData = route.request().postDataJSON();
            capturedSystem = postData.messages?.find((m) => m.role === 'system')?.content || '';
            const responseText =
                '当前项目自定义字段：优先级(高/中/低)、风险等级(1-5)、负责人(文本)。共有3个自定义字段配置。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }],
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`,
            });
        });

        const input = page.locator('#ai_chat_input');
        await input.fill('查看自定义字段配置和字段统计');
        await input.press('Enter');
        await expect(page.locator('#ai_drawer_messages')).toContainText('共有3个自定义字段配置', {
            timeout: 10000,
        });
        expect(capturedSystem).toContain('field-info');
    });
});
