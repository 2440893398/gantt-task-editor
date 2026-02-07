// tests/e2e/gantt-features.spec.js
import { test, expect } from '@playwright/test';

test.describe('Gantt v1.5 Features', () => {
    test.beforeEach(async ({ page }) => {
        // Check console for errors
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.error(`Page Error: ${msg.text()}`);
            }
        });

        // Go to page
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('Page loads without syntax errors', async ({ page }) => {
        const title = await page.title();
        // Default Vite app title might be "Vite App" or similar, check something specific
        // Or just check that #gantt_here exists
        await expect(page.locator('#gantt_here')).toBeVisible();
    });

    test('Toolbar has Baseline and Export buttons', async ({ page }) => {
        // Check Baseline buttons
        await expect(page.locator('#save-baseline-btn')).toBeVisible();
        await expect(page.locator('#show-baseline-toggle')).toBeVisible();

        // Check Export dropdown trigger
        await expect(page.locator('button[data-i18n-title="export.title"]')).toBeVisible();
    });

    test('Short tasks have min-width class', async ({ page }) => {
        // Wait for gantt bars
        await page.waitForSelector('.gantt_task_line');

        // Check if any short task exists (we assume data/tasks.js has some)
        // Or we create one?
        // Let's create one via JS
        await page.evaluate(() => {
            gantt.addTask({
                id: 9999,
                text: "Short Task",
                start_date: new Date(),
                duration: 0.125, // 1 hour
                parent: 0
            });
            gantt.render();
        });

        const shortTask = page.locator('.gantt_task_line[data-task-id="9999"]');
        await expect(shortTask).toHaveClass(/short-task/);

        // Check CSS min-width (indirectly via box check)
        const box = await shortTask.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(20);
    });

    test('Resource conflict detection', async ({ page }) => {
        // Add conflicting tasks
        await page.evaluate(() => {
            const today = new Date();
            gantt.addTask({ id: 8001, text: "Task A", start_date: today, duration: 8, assignee: "Alice" });
            gantt.addTask({ id: 8002, text: "Task B", start_date: today, duration: 8, assignee: "Alice" });
            // Trigger detection
            gantt.callEvent("onAfterTaskAdd", []);
        });

        // Wait for detection debounce (500ms)
        await page.waitForTimeout(1000);

        const taskA = page.locator('.gantt_task_line[data-task-id="8001"]');
        await expect(taskA).toHaveClass(/resource-conflict/);

        // Check Tooltip
        // Hover task A
        await taskA.hover();
        await expect(page.locator('.gantt-tooltip-container')).toContainText('资源超载'); // or 'Resource Overload' depending on lang
    });

    test('Snapping config is enabled', async ({ page }) => {
        const config = await page.evaluate(() => {
            return {
                round: gantt.config.round_dnd_dates,
                step: gantt.config.duration_step
            };
        });

        expect(config.round).toBe(true);
        expect(config.step).toBe(1);
    });

});
