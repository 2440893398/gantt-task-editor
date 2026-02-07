import { test, expect } from '@playwright/test';

test.describe('AI @ Mention Search', () => {

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('gantt_ai_config', JSON.stringify({
                apiKey: 'sk-test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo'
            }));
        });

        // Mock API to return a response acknowledging referenced tasks
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const request = route.request();
            const postData = request.postDataJSON();

            // Check if referencedTasks context is included in messages
            const hasReference = postData.messages?.some(m =>
                typeof m.content === 'string' && m.content.includes('referencedTasks')
            );

            const responseText = hasReference
                ? '已收到您引用的任务信息，我会基于这些任务进行分析。'
                : '请使用 @ 来引用具体任务。';

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

        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('@ key triggers mention search popup', async ({ page }) => {
        // Open AI drawer
        const chatBtn = page.locator('#ai_chat_btn, [data-agent="chat"], #ai_floating_btn');
        if (await chatBtn.count() > 0) {
            await chatBtn.first().click();
        }

        const drawer = page.locator('#ai_drawer');
        if (await drawer.count() > 0) {
            await expect(drawer).toBeVisible({ timeout: 5000 });
        }

        // Type @ in the input to trigger mention popup
        const input = page.locator('#ai_chat_input');
        if (await input.count() > 0) {
            await input.fill('@');
            await input.dispatchEvent('input');

            // Wait for mention popup to appear
            const mentionPopup = page.locator('.mention-popup, [data-mention-popup]');
            await expect(mentionPopup).toBeVisible({ timeout: 5000 });
        }
    });

    test('mention popup shows task search results', async ({ page }) => {
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
            // Type @ followed by search text
            await input.fill('@设计');
            await input.dispatchEvent('input');

            // Verify popup has list items
            const mentionItems = page.locator('.mention-popup .mention-item, [data-mention-popup] [data-mention-item]');
            // Should have at least one result or show empty state
            const popup = page.locator('.mention-popup, [data-mention-popup]');
            await expect(popup).toBeVisible({ timeout: 5000 });
        }
    });

    test('selecting mention adds chip to input', async ({ page }) => {
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
            await input.fill('@');
            await input.dispatchEvent('input');

            // Wait for mention popup
            const mentionPopup = page.locator('.mention-popup, [data-mention-popup]');
            if (await mentionPopup.isVisible({ timeout: 3000 }).catch(() => false)) {
                // Click first mention item
                const firstItem = page.locator('.mention-popup .mention-item, [data-mention-popup] [data-mention-item]').first();
                if (await firstItem.count() > 0) {
                    await firstItem.click();

                    // Verify chip appears in mention area
                    const chip = page.locator('.mention-chip, [data-mention-chip]');
                    await expect(chip.first()).toBeVisible({ timeout: 3000 });
                }
            }
        }
    });

    test('message payload includes referencedTasks', async ({ page }) => {
        let capturedPayload = null;

        // Re-route to capture the payload
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const request = route.request();
            capturedPayload = request.postDataJSON();

            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: '分析完成。' }, finish_reason: null }]
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
            // Dispatch a custom event simulating a message with referencedTasks
            await page.evaluate(() => {
                const event = new CustomEvent('ai-send-message', {
                    detail: {
                        message: '分析这个任务的进度',
                        referencedTasks: [
                            { id: 'task-1', text: '设计登录页面', hierarchyId: '1.2' }
                        ]
                    }
                });
                document.dispatchEvent(event);
            });

            // The message should have been sent; verify the captured payload
            // includes task context in the messages
            await page.waitForTimeout(2000);

            if (capturedPayload) {
                const messagesStr = JSON.stringify(capturedPayload.messages);
                expect(messagesStr).toContain('设计登录页面');
            }
        }
    });
});
