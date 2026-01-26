import { test, expect } from '@playwright/test';

test.describe('Dependency Management Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Collect console logs
        page.on('console', msg => console.log(`BROWSER LOG: ${msg.text()}`));
        page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.toString()}`));

        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });

        // Force EN language 
        await page.evaluate(() => {
            if (window.i18n) window.i18n.setLanguage('en-US');
            gantt.clearAll();
            gantt.parse({
                data: [
                    { id: 1, text: "Task A", start_date: "2023-01-01", duration: 5 },
                    { id: 2, text: "Task B", start_date: "2023-01-06", duration: 5 }
                ],
                links: []
            });
        });
        await page.waitForTimeout(500);
    });

    test('Should display empty predecessors section initially', async ({ page }) => {
        // Open Task 2
        await page.locator('.gantt_task_row[data-task-id="2"]').dblclick();

        // Check panel visibility
        await expect(page.locator('#task-details-panel')).toBeVisible();

        // Check section header 
        await expect(page.locator('text=Predecessors')).toBeVisible({ timeout: 5000 });

        // Check "No predecessors" 
        await expect(page.locator('text=No predecessors')).toBeVisible();

        const deleteBtns = page.locator('.delete-link-btn');
        await expect(deleteBtns).toHaveCount(0);
    });

    test('Should add predecessor link', async ({ page }) => {
        await page.locator('.gantt_task_row[data-task-id="2"]').dblclick();

        // Wait for Add button
        const addBtn = page.locator('#add-predecessor-btn');
        await expect(addBtn).toBeVisible();
        await addBtn.click();

        // Dropdown
        const dropdown = page.locator('#new-predecessor-select');
        await expect(dropdown).toBeVisible();

        // Click trigger
        await dropdown.locator('#new-predecessor-select-trigger').click();

        // Select Task A (id=1)
        const itemTaskA = dropdown.locator('.dropdown-item[data-value="1"]');
        await expect(itemTaskA).toBeVisible();
        await itemTaskA.click();

        // Verify link added UI
        await expect(page.locator('.delete-link-btn')).toHaveCount(1);
        await expect(page.locator('text=Task A')).toBeVisible();

        // Verify Gantt Data
        const linkCount = await page.evaluate(() => gantt.getLinks().length);
        expect(linkCount).toBe(1);
    });

    test('Should delete predecessor link', async ({ page }) => {
        await page.evaluate(() => {
            if (window.i18n) window.i18n.setLanguage('en-US');
            gantt.addLink({ id: 100, source: 1, target: 2, type: "0" });
        });

        await page.locator('.gantt_task_row[data-task-id="2"]').dblclick();

        await expect(page.locator('.delete-link-btn')).toHaveCount(1);

        page.on('dialog', dialog => dialog.accept());

        await page.locator('.delete-link-btn').click();

        await expect(page.locator('.delete-link-btn')).toHaveCount(0);

        const linkCount = await page.evaluate(() => gantt.getLinks().length);
        expect(linkCount).toBe(0);
    });
});
