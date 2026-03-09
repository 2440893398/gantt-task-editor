import { test, expect } from '@playwright/test';

test.describe('view mode regressions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#gantt_here')).toBeVisible();
        await expect.poll(async () => {
            return page.evaluate(() => window.gantt?.serialize?.()?.data?.length ?? 0);
        }).toBeGreaterThan(0);
    });

    test('task name column should not become too wide after table to split switch', async ({ page }) => {
        await page.locator('[data-view="table"]').click();
        await page.waitForTimeout(200);

        await page.locator('[data-view="split"]').click();
        await page.waitForTimeout(200);

        const textHeaderWidth = await page.evaluate(() => {
            const cell = document.querySelector('.gantt_grid_head_cell[data-column-name="text"]');
            return cell ? Math.round(cell.getBoundingClientRect().width) : 0;
        });

        expect(textHeaderWidth).toBeGreaterThan(0);
        expect(textHeaderWidth).toBeLessThanOrEqual(320);
    });

    test('task name cell should not render project id highlight badge', async ({ page }) => {
        const badgeCount = await page.locator('.project-id-badge-gantt').count();
        expect(badgeCount).toBe(0);
    });
});
