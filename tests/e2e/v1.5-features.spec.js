// tests/e2e/v1.5-features.spec.js
import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/app-ready.js';

test.describe('Gantt v1.5 Features', () => {
    test.beforeEach(async ({ page }) => {
        await gotoApp(page);
    });

    test('Baseline and export controls exist', async ({ page }) => {
        await expect(page.locator('#save-baseline-btn')).toBeVisible();
        await expect(page.locator('label:has(#show-baseline-toggle)')).toBeVisible();
        await expect(page.locator('#show-baseline-toggle')).toBeAttached();
        await expect(page.locator('button[data-i18n-title="export.title"]')).toBeVisible();

        await page.locator('button[data-i18n-title="export.title"]').click();
        await expect(page.locator('#export-current-view-btn')).toBeVisible();
        await expect(page.locator('#export-full-gantt-btn')).toBeVisible();
    });

    test('Duration column shows formatted content', async ({ page }) => {
        const durationCell = page.locator('.gantt_cell[data-column-name="duration"]').first();
        await expect(durationCell).toBeVisible();
        const text = (await durationCell.textContent())?.trim() || '';
        expect(text.length).toBeGreaterThan(0);
    });

    test('[SCN-GUI-006] Resource conflict detection marks tasks', async ({ page }) => {
        // #gantt_here exists before the async project data has been parsed.
        await expect(page.locator('.gantt_grid_data .gantt_row').first()).toBeVisible();

        await page.evaluate(() => {
            const visibleStart = new Date(gantt.getTaskByIndex(0).start_date);
            gantt.addTask({
                id: 8101,
                text: 'Task A',
                start_date: visibleStart,
                duration: 8,
                assignee: 'Alice',
            });
            gantt.addTask({
                id: 8102,
                text: 'Task B',
                start_date: visibleStart,
                duration: 8,
                assignee: 'Alice',
            });
            gantt.showTask(8101);
        });

        const taskA = page.locator('.gantt_task_line[task_id="8101"]');
        await expect(taskA).toHaveClass(/resource-conflict/, { timeout: 15000 });
    });

    test('Snapping config is enabled', async ({ page }) => {
        const config = await page.evaluate(() => ({
            round: gantt.config.round_dnd_dates,
            step: gantt.config.duration_step,
        }));

        expect(config.round).toBe(true);
        expect(config.step).toBe(1);
    });
});
