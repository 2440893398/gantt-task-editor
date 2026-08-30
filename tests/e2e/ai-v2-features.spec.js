import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/app-ready.js';

test.describe('AI V2.0 New Features', () => {
    test.beforeEach(async ({ page }) => {
        // Pre-configure AI
        await page.addInitScript(() => {
            localStorage.setItem(
                'gantt_ai_config',
                JSON.stringify({
                    apiKey: 'sk-test-key-v2',
                    // Use a third-party-style URL so the SDK exercises /chat/completions,
                    // whose SSE wire format this test mocks.
                    baseUrl: 'https://mock-ai.example/v1',
                    model: 'gpt-3.5-turbo',
                })
            );
        });

        // Mock OpenAI API with JSON output
        await page.route('**/chat/completions', async (route) => {
            // Return a structured result for both tests. F-107 verifies the renderer;
            // F-111 verifies the usage block on the same valid streamed response.
            const content = JSON.stringify({
                type: 'task_refine',
                original: 'Simple Task',
                optimized: 'Optimized Simple Task V2',
                reasoning: 'Enhanced for clarity',
            });

            // Simulate stream
            const stream0 = `data: ${JSON.stringify({
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: { content: content }, finish_reason: null }],
            })}\n\n`;

            const stream1 = `data: ${JSON.stringify({
                id: 'chatcmpl-mock',
                object: 'chat.completion.chunk',
                created: Date.now(),
                model: 'gpt-3.5-turbo',
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
            })}\n\n`;

            await route.fulfill({
                status: 200,
                contentType: 'text/event-stream',
                body: stream0 + stream1 + 'data: [DONE]\n\n',
            });
        });

        await gotoApp(page);
    });

    test('F-107: Should render structured JSON results', async ({ page }) => {
        // 1. Open the configured AI drawer directly (F-203 removed the intermediate menu).
        await page.click('#ai_floating_btn');
        await expect(page.locator('#ai_drawer')).toBeVisible();

        // 2. Send a message
        const input = page.locator('#ai_chat_input');
        // "field" uses the deterministic quick router and avoids spending a second mocked
        // request on the LLM intent router; the response still exercises F-107 rendering.
        await input.fill('field: refine this task');
        const sendBtn = page.locator('#ai_send_btn');
        await sendBtn.click();

        // 3. Wait for response and verify structured content
        // The mock returns data streaming, we need to wait for it to finish and parse
        const messages = page.locator('#ai_drawer_messages');

        // Wait for specific content that indicates successful rendering
        // Use a more relaxed timeout as streaming might take a moment
        await expect(messages).toContainText('Optimized Simple Task V2', { timeout: 10000 });

        // Verify renderer structure and data, independent of the active UI locale.
        const resultCard = messages.locator('.ai-result-card[data-type="task_refine"]');
        await expect(resultCard).toBeVisible();
        await expect(resultCard).toContainText('Simple Task');
        await expect(resultCard).toContainText('Optimized Simple Task V2');
        await expect(resultCard).toContainText('Enhanced for clarity');
    });

    test('F-111: Should display token usage stats', async ({ page }) => {
        // Open drawer and send message
        await page.click('#ai_floating_btn');

        await expect(page.locator('#ai_drawer')).toBeVisible();

        await page.fill('#ai_chat_input', 'field: test tokens');
        await page.click('#ai_send_btn');

        // Check stats footer
        // Need to wait for streaming to finish for stats to appear
        const tokenStats = page.locator('#ai_token_stats');
        await expect(tokenStats).toBeVisible({ timeout: 10000 });
        await expect(tokenStats).toContainText('80 tokens'); // 50+30 from mock
    });

    test('F-112: Should expose the task summary through the Description column', async ({
        page,
    }) => {
        // Ensure Gantt is fully loaded
        await page.waitForSelector('.gantt_grid_scale', { state: 'visible', timeout: 10000 });

        // Debug: Log all headers to see what's actually there
        const headerTexts = await page.locator('.gantt_grid_head_cell').allInnerTexts();
        console.log('Gantt Headers:', headerTexts);

        // The current schema stores summary and description together, while the grid exposes
        // the canonical Description label and keeps `summary` as an internal compatibility key.
        const hasSummary = headerTexts.some((text) => /描述|Description/i.test(text));

        expect(
            hasSummary,
            `Description-backed summary column not found. Available headers: ${headerTexts.join(', ')}`
        ).toBeTruthy();

        // Also verify the column is actually in the DOM by its attribute if possible
        // Gantt columns often have ::before/after or specific internal structure
    });
});
