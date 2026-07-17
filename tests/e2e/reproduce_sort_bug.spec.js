import { test, expect } from '@playwright/test';

test('[SCN-GUI-005] should reorder fields in field management panel', async ({ page }) => {
    // 1. Visit page
    await page.goto('http://localhost:5273/');
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    await expect(page.locator('#gantt_here')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // 2. Open Field Management Panel
    const isSortableDefined = await page.evaluate(() => typeof window.Sortable !== 'undefined');
    console.log('Is Sortable defined in window?', isSortableDefined);
    expect(isSortableDefined, 'SortableJS should be defined in window').toBe(true);

    await page.locator('#task-header #add-field-btn').click();

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
    const initialOrder = await items.evaluateAll((list) => list.map((el) => el.dataset.fieldName));
    console.log('Initial Order:', initialOrder);

    // 4. Drag first item to be after second item
    // Playwright's synthetic mouse does not start Sortable's force-fallback drag in Chromium.
    // Exercise the product's native HTML5 fallback with the same browser drag event sequence.
    await page.evaluate(() => {
        const source = document.querySelector('#field-list-container .field-item');
        const handle = source?.querySelector('.field-drag-handle');
        const target = source?.nextElementSibling;
        if (!source || !handle || !target) throw new Error('Field drag elements not found');

        const dataTransfer = new DataTransfer();
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        const targetRect = target.getBoundingClientRect();
        target.dispatchEvent(
            new DragEvent('dragover', {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientY: targetRect.bottom - 1,
            })
        );
        target.dispatchEvent(
            new DragEvent('drop', {
                bubbles: true,
                cancelable: true,
                dataTransfer,
                clientY: targetRect.bottom - 1,
            })
        );
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
    });

    await page.waitForTimeout(500); // Wait for animation

    // 5. Get final order
    const finalOrder = await items.evaluateAll((list) => list.map((el) => el.dataset.fieldName));
    console.log('Final Order:', finalOrder);
    const storedOrder = await page.evaluate(async () => {
        const { state } = await import('/src/core/store.js');
        return state.fieldOrder;
    });

    // 6. Assert order changed
    // Print captured logs
    const logs = await page.evaluate(() => window.__debugLogs);
    console.log('CAPTURED LOGS:', logs);

    expect(finalOrder).not.toEqual(initialOrder);
    expect(finalOrder[0]).not.toBe(initialOrder[0]);
    expect(storedOrder.slice(0, finalOrder.length)).toEqual(finalOrder);
});
