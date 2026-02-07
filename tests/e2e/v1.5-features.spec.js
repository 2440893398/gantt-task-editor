// tests/e2e/v1.5-features.spec.js
import { test, expect } from '@playwright/test';

test.describe('Gantt v1.5 Features', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#gantt_here');
    });

    test('Baseline and export controls exist', async ({ page }) => {
        await expect(page.locator('#save-baseline-btn')).toBeVisible();
        await expect(page.locator('#show-baseline-toggle')).toBeVisible();
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

    test('Resource conflict detection marks tasks', async ({ page }) => {
        await page.evaluate(() => {
            const today = new Date();
            gantt.addTask({ id: 8101, text: 'Task A', start_date: today, duration: 8, assignee: 'Alice' });
            gantt.addTask({ id: 8102, text: 'Task B', start_date: today, duration: 8, assignee: 'Alice' });
            gantt.callEvent('onAfterTaskAdd', []);
        });

        await page.waitForTimeout(1000);
        const taskA = page.locator('.gantt_task_line[data-task-id="8101"]');
        await expect(taskA).toHaveClass(/resource-conflict/);
    });

    test('Snapping config is enabled', async ({ page }) => {
        const config = await page.evaluate(() => ({
            round: gantt.config.round_dnd_dates,
            step: gantt.config.duration_step
        }));

        expect(config.round).toBe(true);
        expect(config.step).toBe(1);
    });
});
