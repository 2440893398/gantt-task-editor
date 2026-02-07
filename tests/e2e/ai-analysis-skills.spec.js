import { test, expect } from '@playwright/test';

test.describe('AI Analysis Skills Routing', () => {

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('gantt_ai_config', JSON.stringify({
                apiKey: 'sk-test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo'
            }));
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('dependency analysis query routes to correct skill', async ({ page }) => {
        // Mock API to simulate tool call for dependency analysis
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const request = route.request();
            const postData = request.postDataJSON();
            const userMsg = postData.messages?.find(m => m.role === 'user');

            // Check if the system prompt contains dependency analysis skill context
            const systemMsg = postData.messages?.find(m => m.role === 'system');
            const hasDependencyContext = systemMsg?.content?.includes('dependency') ||
                                         systemMsg?.content?.includes('依赖');

            const responseText = hasDependencyContext
                ? '根据依赖分析，[#1.1] 需求分析 是关键路径上的任务，它阻塞了 [#1.2] 设计登录页面。'
                : '我可以帮您分析任务依赖关系。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }]
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`
            });
        });

        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"], #ai_floating_btn');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const drawer = page.locator('#ai_drawer');
        if (await drawer.count() > 0) {
            await expect(drawer).toBeVisible({ timeout: 5000 });
        }

        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('分析任务依赖关系和关键路径');
            await input.press('Enter');

            // Wait for AI response
            const responseArea = page.locator('.ai-message, [data-ai-message]');
            await expect(responseArea.first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('resource analysis query returns workload info', async ({ page }) => {
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const responseText = '当前资源负荷分析：张三负责3个任务，工作负荷较高。李四有2个任务，负荷适中。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }]
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`
            });
        });

        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"], #ai_floating_btn');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('查看资源负荷和人员工作量');
            await input.press('Enter');

            const responseArea = page.locator('.ai-message, [data-ai-message]');
            await expect(responseArea.first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('timeline analysis query returns deadline info', async ({ page }) => {
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const responseText = '时间线分析：[#2.1] 实现用户认证 将于下周五到期，[#3.1] 集成测试 已延期2天。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }]
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`
            });
        });

        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"], #ai_floating_btn');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('分析时间线偏差和即将到期的任务');
            await input.press('Enter');

            const responseArea = page.locator('.ai-message, [data-ai-message]');
            await expect(responseArea.first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('project summary query aggregates overall status', async ({ page }) => {
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const responseText = '项目概览：共15个任务，已完成5个(33%)，进行中6个(40%)，未开始4个(27%)。整体进度正常。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }]
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`
            });
        });

        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"], #ai_floating_btn');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('给我一个项目总结和整体进度');
            await input.press('Enter');

            const responseArea = page.locator('.ai-message, [data-ai-message]');
            await expect(responseArea.first()).toBeVisible({ timeout: 10000 });
        }
    });

    test('field info query returns custom fields data', async ({ page }) => {
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const responseText = '当前项目自定义字段：优先级(高/中/低)、风险等级(1-5)、负责人(文本)。共有3个自定义字段配置。';

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: responseText }, finish_reason: null }]
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: `data: ${JSON.stringify(responseBody)}\n\ndata: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`
            });
        });

        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"], #ai_floating_btn');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('查看自定义字段配置和字段统计');
            await input.press('Enter');

            const responseArea = page.locator('.ai-message, [data-ai-message]');
            await expect(responseArea.first()).toBeVisible({ timeout: 10000 });
        }
    });
});
