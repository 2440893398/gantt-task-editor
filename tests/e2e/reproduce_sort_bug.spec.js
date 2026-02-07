import { test, expect } from '@playwright/test';

test('should reorder fields in field management panel', async ({ page }) => {
    // 1. Visit page
    await page.goto('http://localhost:5273/');
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await expect(page.locator('#gantt_here')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // 2. Open Field Management Panel
    const isSortableDefined = await page.evaluate(() => typeof window.Sortable !== 'undefined');
    console.log('Is Sortable defined in window?', isSortableDefined);
    expect(isSortableDefined, 'SortableJS should be defined in window').toBe(true);

    await page.evaluate(() => {
        if (window.openFieldManagementPanel) {
            window.openFieldManagementPanel();
        } else {
            throw new Error('openFieldManagementPanel not found on window');
        }
    });

    const panel = page.locator('#field-management-panel');
    await expect(panel).toHaveClass(/open/);

    // 3. Get Items
    const container = page.locator('#field-list-container');
    const items = container.locator('.field-item');
    await expect(items.first()).toBeVisible();

    // Ensure we have enough items
    const count = await items.count();
    expect(count).toBeGreaterThan(1);

    // Get initial order
    const initialOrder = await items.evaluateAll(list => list.map(el => el.dataset.fieldName));
    console.log('Initial Order:', initialOrder);

    // 4. Drag first item to be after second item
    const firstItem = items.nth(0);
    const secondItem = items.nth(1);
    const dragHandle = firstItem.locator('.field-drag-handle');

    // Calculate positions
    const secondBox = await secondItem.boundingBox();
    if (!secondBox) throw new Error('Second item bounding box not found');

    // Perform drag
    await dragHandle.hover();
    await page.mouse.down();
    // Move to the bottom of the second item
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height);
    await page.waitForTimeout(100); // Wait for sortable to detect
    await page.mouse.up();

    await page.waitForTimeout(500); // Wait for animation

    // 5. Get final order
    const finalOrder = await items.evaluateAll(list => list.map(el => el.dataset.fieldName));
    console.log('Final Order:', finalOrder);

    // 6. Assert order changed
    // Print captured logs
    const logs = await page.evaluate(() => window.__debugLogs);
    console.log('CAPTURED LOGS:', logs);

    expect(finalOrder).not.toEqual(initialOrder);
    expect(finalOrder[0]).not.toBe(initialOrder[0]);
});
