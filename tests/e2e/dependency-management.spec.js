import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/app-ready.js';

test.describe('Dependency Management Tests', () => {
    test.beforeEach(async ({ page }) => {
        // Collect console logs
        page.on('console', (msg) => console.log(`BROWSER LOG: ${msg.text()}`));
        page.on('pageerror', (err) => console.log(`BROWSER ERROR: ${err.toString()}`));

        await gotoApp(page);
        await page.waitForSelector('.gantt_task', { timeout: 10000 });

        // Force EN language
        await page.evaluate(() => {
            if (window.i18n) window.i18n.setLanguage('en-US');
            gantt.clearAll();
            gantt.parse({
                data: [
                    { id: 1, text: 'Task A', start_date: '2023-01-01', duration: 5 },
                    { id: 2, text: 'Task B', start_date: '2023-01-06', duration: 5 },
                ],
                links: [],
            });
        });
        await page.waitForTimeout(500);
    });

    test('Should display empty predecessors section initially', async ({ page }) => {
        // Open Task 2
        await page.locator('.gantt-task-action-edit[data-task-id="2"]').click();

        // Check panel visibility
        await expect(page.locator('#task-details-panel')).toBeVisible();

        // Check section header
        await expect(page.getByRole('heading', { name: 'Predecessors', exact: true })).toBeVisible({
            timeout: 5000,
        });

        // Check "No predecessors"
        await expect(page.locator('text=No predecessors')).toBeVisible();

        const deleteBtns = page.locator('.delete-link-btn');
        await expect(deleteBtns).toHaveCount(0);
    });

    test('Should add predecessor link', async ({ page }) => {
        await page.locator('.gantt-task-action-edit[data-task-id="2"]').click();

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
        // The reusable dropdown portals its menu to document.body.
        const itemTaskA = page.locator('.dropdown-item[data-value="1"]:visible');
        await expect(itemTaskA).toBeVisible();
        await itemTaskA.click();

        // Verify link added UI
        await expect(page.locator('.delete-link-btn')).toHaveCount(1);
        await expect(
            page.locator('#predecessors-list').getByText('Task A', { exact: true })
        ).toBeVisible();

        // Verify Gantt Data
        const links = await page.evaluate(() =>
            gantt.getLinks().map((link) => ({
                source: String(link.source),
                target: String(link.target),
                type: String(link.type),
            }))
        );
        expect(links).toEqual([{ source: '1', target: '2', type: '0' }]);
    });

    test('Should delete predecessor link', async ({ page }) => {
        await page.evaluate(() => {
            if (window.i18n) window.i18n.setLanguage('en-US');
            gantt.addLink({ id: 100, source: 1, target: 2, type: '0' });
        });

        await page.locator('.gantt-task-action-edit[data-task-id="2"]').click();

        await expect(page.locator('.delete-link-btn')).toHaveCount(1);

        page.on('dialog', (dialog) => dialog.accept());

        await page.locator('.delete-link-btn').click();

        await expect(page.locator('.delete-link-btn')).toHaveCount(0);

        const linkCount = await page.evaluate(() => gantt.getLinks().length);
        expect(linkCount).toBe(0);
    });
});
