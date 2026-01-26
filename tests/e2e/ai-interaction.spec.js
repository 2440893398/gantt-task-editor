
import { test, expect } from '@playwright/test';

test.describe('AI Agent Interaction', () => {

    test.beforeEach(async ({ page }) => {
        // Pre-configure AI to avoid modal blocking
        await page.addInitScript(() => {
            localStorage.setItem('gantt_ai_config', JSON.stringify({
                apiKey: 'sk-test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo'
            }));
        });

        // Mock OpenAI API for streaming responses
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const request = route.request();
            const postData = request.postDataJSON();

            // Verify request structure
            if (!postData.messages || !postData.model) {
                return route.fulfill({ status: 400, body: JSON.stringify({ error: 'Invalid request' }) });
            }

            // Simulate streaming response
            const responseBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: 'AI Response Message' }, finish_reason: null }]
            };
            const finishBody = {
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
            };

            // Return stream
            const stream0 = `data: ${JSON.stringify(responseBody)}\n\n`;
            const stream1 = `data: ${JSON.stringify(finishBody)}\n\ndata: [DONE]\n\n`;

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: stream0 + stream1
            });
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('#gantt_here', { timeout: 60000 });
        await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 30000 });
    });

    // F-203: AI 菜单现在只保留 "设置" 和 "开始对话" 按钮
    test('should open chat drawer from floating button', async ({ page }) => {
        // 1. Open Agent Menu
        await page.click('#ai_floating_btn');
        await page.waitForTimeout(300);

        // 2. Verify menu is visible and has chat button
        const agentMenu = page.locator('#ai_agent_menu');
        await expect(agentMenu).toBeVisible();

        // 3. Click chat button (data-agent-id="chat")
        const chatBtn = page.locator('button[data-agent-id="chat"]');
        await expect(chatBtn).toBeVisible();
        await chatBtn.click();

        // 4. Verify Drawer Opens
        const drawer = page.locator('#ai_drawer');
        await expect(drawer).toBeVisible({ timeout: 10000 });
    });

    test('should open config modal when AI not configured', async ({ page }) => {
        // 创建新的上下文，不预设 AI 配置
        await page.addInitScript(() => {
            localStorage.removeItem('gantt_ai_config');
        });
        await page.goto('/');
        await page.waitForSelector('#gantt_here', { timeout: 60000 });
        await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 30000 });

        // Click floating button when not configured should open config modal
        await page.click('#ai_floating_btn');
        await page.waitForTimeout(500);

        // Verify config modal opens - 检查 modal 内部元素可见
        const configModalContent = page.locator('#ai_config_modal .modal-box');
        await expect(configModalContent).toBeVisible({ timeout: 10000 });
    });
});
