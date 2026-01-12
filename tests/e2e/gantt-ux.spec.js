import { test, expect } from '@playwright/test';

test.describe('Gantt Chart UX Optimization', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5273/');
        // Wait for Gantt chart to be visible
        await expect(page.locator('#gantt_here')).toBeVisible();
    });

    test('Zoom In and Zoom Out buttons should work', async ({ page }) => {
        const zoomInBtn = page.locator('#zoom-in-btn');
        const zoomOutBtn = page.locator('#zoom-out-btn');
        const levelDisplay = page.locator('#zoom-level-display');
        const viewSelector = page.locator('#view-selector');

        // Initial state should be Week
        await expect(viewSelector).toHaveValue('week');
        await expect(levelDisplay).toHaveText('周视图');

        // Test Zoom Out (should go to Month)
        await zoomOutBtn.click();
        await expect(viewSelector).toHaveValue('month');
        await expect(levelDisplay).toHaveText('月视图');

        // Test Zoom In (should go back to Week)
        await zoomInBtn.click();
        await expect(viewSelector).toHaveValue('week');
        await expect(levelDisplay).toHaveText('周视图');
    });

    test('View Selector should change zoom level', async ({ page }) => {
        const viewSelector = page.locator('#view-selector');
        const levelDisplay = page.locator('#zoom-level-display');

        // Select Day view
        await viewSelector.selectOption('day');
        await expect(levelDisplay).toHaveText('日视图');

        // Select Year view
        await viewSelector.selectOption('year');
        await expect(levelDisplay).toHaveText('年视图');
    });

    test('Back to Today button should be visible', async ({ page }) => {
        const todayBtn = page.locator('#scroll-to-today-btn');
        await expect(todayBtn).toBeVisible();
        await expect(todayBtn).toBeEnabled();
        // Functional test for scrolling might be flaky without knowing exact date position, 
        // so we just ensure it's clickable for now.
        await todayBtn.click();
    });
});
