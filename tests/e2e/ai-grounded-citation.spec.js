import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/app-ready.js';

test.describe('AI Grounded Task Citations', () => {
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

        await page.route('**/chat/completions', async (route) => {
            const citationText =
                'Review [#1.2] Design Login and [#2.1] Implement Authentication first.';
            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: citationText }, finish_reason: null }],
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

        await gotoApp(page);
        await page.locator('#ai_floating_btn').click();
        await expect(page.locator('#ai_drawer')).toBeVisible({ timeout: 5000 });
    });

    test('[SCN-AIC-001] citation chips render in AI response', async ({ page }) => {
        const input = page.locator('#ai_chat_input');
        await input.fill('field: Which tasks need attention?');
        await input.press('Enter');

        const citationChips = page.locator('.ai-task-citation');
        await expect(citationChips).toHaveCount(2, { timeout: 10000 });
        await expect(citationChips.first()).toHaveAttribute('data-hierarchy-id', '#1.2');
    });

    test('[SCN-AIC-001] citation chip contains task name', async ({ page }) => {
        const input = page.locator('#ai_chat_input');
        await input.fill('field: Summarize task status');
        await input.press('Enter');

        const citationChip = page.locator('.ai-task-citation').first();
        await expect(citationChip).toBeVisible({ timeout: 10000 });
        await expect(citationChip).toContainText('Design Login');
    });
});
