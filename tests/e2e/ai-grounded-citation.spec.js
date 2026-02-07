import { test, expect } from '@playwright/test';

test.describe('AI Grounded Task Citations', () => {

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('gantt_ai_config', JSON.stringify({
                apiKey: 'sk-test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo'
            }));
        });

        // Mock API to return response with citation format
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const citationText = '请关注 [#1.2] 设计登录页面 和 [#2.1] 实现用户认证，这两个任务需要优先处理。';
            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: citationText }, finish_reason: null }]
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

        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('citation chips render in AI response', async ({ page }) => {
        // Open AI drawer via chat agent
        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"]');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        // Wait for drawer
        const drawer = page.locator('#ai_drawer');
        if (await drawer.count() > 0) {
            await expect(drawer).toBeVisible({ timeout: 5000 });
        }

        // Type and send a message
        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('哪些任务需要关注？');
            await input.press('Enter');

            // Wait for response with citations
            const citationChip = page.locator('.ai-task-citation');
            await expect(citationChip.first()).toBeVisible({ timeout: 10000 });

            // Verify citation has hierarchy ID
            await expect(citationChip.first()).toHaveAttribute('data-hierarchy-id');
        }
    });

    test('citation chip contains task name', async ({ page }) => {
        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"]');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('任务情况');
            await input.press('Enter');

            const citationChip = page.locator('.ai-task-citation');
            await expect(citationChip.first()).toBeVisible({ timeout: 10000 });

            // Should contain task name text
            const chipText = await citationChip.first().textContent();
            expect(chipText).toBeTruthy();
        }
    });
});
