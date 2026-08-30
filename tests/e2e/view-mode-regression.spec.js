import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/app-ready.js';

test.describe('view mode regressions', () => {
    test.beforeEach(async ({ page }) => {
        await gotoApp(page);
        await expect(page.locator('#gantt_here')).toBeVisible();
        await expect
            .poll(async () => {
                return page.evaluate(() => window.gantt?.serialize?.()?.data?.length ?? 0);
            })
            .toBeGreaterThan(0);
    });

    test('task name column should not become too wide after table to split switch', async ({
        page,
    }) => {
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

    test('project id badge should only render on project rows', async ({ page }) => {
        const badges = page.locator('.project-id-badge-gantt');
        await expect(badges.first()).toBeVisible();

        const badgeRows = page.locator('.gantt_row:has(.project-id-badge-gantt)');
        const rowsAreProjects = await badgeRows.evaluateAll((rows) =>
            rows.every((row) => {
                const taskId = row.getAttribute('data-task-id');
                const task = gantt.getTask(taskId);
                return task.type === 'project' || gantt.hasChild(taskId);
            })
        );
        expect(rowsAreProjects).toBe(true);

        await expect(
            page.locator('.gantt_row:not(:has(.project-id-badge-gantt))').first()
        ).toBeVisible();
    });
});
