import { test, expect } from '@playwright/test';

import { gotoApp } from './helpers/app-ready.js';

test.describe('Regression: today marker and new task entry', () => {
    test.beforeEach(async ({ page }) => {
        await gotoApp(page);
    });

    test('clicking Today keeps a visible today marker line', async ({ page }) => {
        await page.locator('#scroll-to-today-btn').click();

        const markerCount = await page
            .locator('.gantt_marker.today-marker, #custom-today-line')
            .count();
        expect(markerCount).toBeGreaterThan(0);
    });

    test('clicking New Task opens task details panel directly', async ({ page }) => {
        await page.locator('#new-task-btn').click();
        await expect(page.locator('#task-details-panel')).toBeVisible();
    });
});
