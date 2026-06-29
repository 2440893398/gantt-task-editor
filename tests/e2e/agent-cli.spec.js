import { expect, test } from '@playwright/test';

test.describe('agent command layer', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('exposes read-only window.app API and discovery metadata', async ({ page }) => {
        const help = await page.evaluate(() => window.app.help());

        expect(help.commands.map((command) => command.name)).toEqual(
            expect.arrayContaining(['state.snapshot', 'task.list', 'link.list'])
        );

        const snapshot = await page.evaluate(() => window.app.state.snapshot({ level: 'summary' }));

        expect(snapshot.ok).toBe(true);
        expect(snapshot.rev).toEqual(expect.any(Number));
        expect(snapshot.data.rev).toBe(snapshot.rev);

        const discovery = await page.evaluate(() => ({
            dataset: document.documentElement.dataset.agentApi,
            meta: document.querySelector('meta[name="agent-api"]')?.content,
        }));

        expect(discovery).toEqual({
            dataset: 'window.app',
            meta: 'window.app.help()',
        });
    });
});
