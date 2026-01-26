
import { test, expect } from '@playwright/test';

test.describe('AI V2.0 New Features', () => {

    test.beforeEach(async ({ page }) => {
        // Pre-configure AI
        await page.addInitScript(() => {
            localStorage.setItem('gantt_ai_config', JSON.stringify({
                apiKey: 'sk-test-key-v2',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo'
            }));
        });

        // Mock OpenAI API with JSON output
        await page.route('https://api.openai.com/v1/chat/completions', async route => {
            const request = route.request();
            const postData = request.postDataJSON();

            // Check if JSON format instructions are present
            const systemPrompt = postData.messages.find(m => m.role === 'system')?.content || '';
            const expectingJson = systemPrompt.includes('JSON');

            let content = '';

            if (expectingJson) {
                // Return structured JSON
                content = JSON.stringify({
                    type: "task_refine",
                    original: "Simple Task",
                    optimized: "Optimized Simple Task V2",
                    reasoning: "Enhanced for clarity"
                });
            } else {
                content = "Plain text response";
            }

            // Simulate stream
            const stream0 = `data: ${JSON.stringify({
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: content }, finish_reason: null }]
            })}\n\n`;

            const stream1 = `data: ${JSON.stringify({
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 }
            })}\n\n`;

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: stream0 + stream1 + 'data: [DONE]\n\n'
            });
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('#gantt_here', { timeout: 60000 });
        await page.waitForSelector('#app-loading', { state: 'hidden', timeout: 30000 });
    });

    test('F-107: Should render structured JSON results', async ({ page }) => {
        // 1. Open AI Menu
        await page.click('#ai_floating_btn');
        const agentMenu = page.locator('#ai_agent_menu');
        await expect(agentMenu).toBeVisible();

        // 2. Select Chat
        const chatBtn = page.locator('button[data-agent-id="chat"]');
        await expect(chatBtn).toBeVisible();
        await chatBtn.click();

        // 3. Send a message
        const input = page.locator('#ai_chat_input');
        await input.fill('Refine this task');
        const sendBtn = page.locator('#ai_send_btn');
        await sendBtn.click();

        // 4. Wait for response and verifying structured content
        // The mock returns data streaming, we need to wait for it to finish and parse
        const messages = page.locator('#ai_drawer_messages');

        // Wait for specific content that indicates successful rendering
        // Use a more relaxed timeout as streaming might take a moment
        await expect(messages).toContainText('Optimized Simple Task V2', { timeout: 10000 });

        // Check for specific UI structure of the card (e.g., "Original", "Optimized")
        // These texts are rendered by taskRefineRenderer in renderers/index.js
        // We use string matching because actual text depends on localization
        // '原始' or 'Original'
        const originalText = await messages.textContent();
        console.log('Drawer content:', originalText);

        // Verify key structural elements exist (using class names or unique text)
        await expect(messages.locator('.ai-result-card')).toBeVisible();
        await expect(messages).toContainText('原始');
        await expect(messages).toContainText('优化后');
    });

    test('F-111: Should display token usage stats', async ({ page }) => {
        // Open drawer and send message
        await page.click('#ai_floating_btn');

        const chatBtn = page.locator('button[data-agent-id="chat"]');
        await expect(chatBtn).toBeVisible();
        await chatBtn.click();

        await page.fill('#ai_chat_input', 'Test tokens');
        await page.click('#ai_send_btn');

        // Check stats footer
        // Need to wait for streaming to finish for stats to appear
        const tokenStats = page.locator('#ai_token_stats');
        await expect(tokenStats).toBeVisible({ timeout: 10000 });
        await expect(tokenStats).toContainText('80 tokens'); // 50+30 from mock
    });

    test('F-112: Should have Summary column in Gantt', async ({ page }) => {
        // Ensure Gantt is fully loaded
        await page.waitForSelector('.gantt_grid_scale', { state: 'visible', timeout: 10000 });

        // Debug: Log all headers to see what's actually there
        const headerTexts = await page.locator('.gantt_grid_head_cell').allInnerTexts();
        console.log('Gantt Headers:', headerTexts);

        // Check if summary column header exists using a looser check
        // It might be '概述', 'Summary', or 'Overview' depending on the environment/mock
        const hasSummary = headerTexts.some(text =>
            /概述|Summary|Overview/i.test(text)
        );

        expect(hasSummary, `Summary column not found. Available headers: ${headerTexts.join(', ')}`).toBeTruthy();

        // Also verify the column is actually in the DOM by its attribute if possible
        // Gantt columns often have ::before/after or specific internal structure
    });

});
