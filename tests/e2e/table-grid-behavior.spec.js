import { test, expect } from '@playwright/test';

async function dragResizer(page, deltaX) {
    const resizer = page.locator('#custom-resizer');
    await expect(resizer).toBeVisible();
    const box = await resizer.boundingBox();
    expect(box).toBeTruthy();

    const startX = box.x + (box.width / 2);
    const startY = box.y + (box.height / 2);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(180);
}

test.describe('table grid behavior regressions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#gantt_here')).toBeVisible();
        await expect.poll(async () => {
            return page.evaluate(() => window.gantt?.serialize?.()?.data?.length ?? 0);
        }).toBeGreaterThan(0);
        await page.locator('[data-view="split"]').click();
    });

    test('after widening split grid, columns should still fill width without right blank area', async ({ page }) => {
        await dragResizer(page, 700);

        const gap = await page.evaluate(() => {
            const grid = document.querySelector('.gantt_grid');
            const actionsHead = document.querySelector('.gantt_grid_head_cell[data-column-name="actions"]');
            if (!grid || !actionsHead) return Number.POSITIVE_INFINITY;
            const gridRect = grid.getBoundingClientRect();
            const actionsRect = actionsHead.getBoundingClientRect();
            return Math.round(gridRect.right - actionsRect.right);
        });

        expect(gap).toBeLessThanOrEqual(8);
    });

    test('actions column should keep row action buttons visible on right without horizontal scroll-to-end', async ({ page }) => {
        await dragResizer(page, -700);

        const visibility = await page.evaluate(() => {
            const grid = document.querySelector('.gantt_grid');
            const gridData = document.querySelector('.gantt_grid_data');
            const actionsHead = document.querySelector('.gantt_grid_head_cell[data-column-name="actions"]');
            const firstRow = document.querySelector('.gantt_grid_data .gantt_row');
            const actionCell = firstRow?.querySelector('.gantt_cell.gantt_last_cell') || null;
            if (!grid || !gridData || !actionsHead || !actionCell) {
                return { headerVisible: false, cellVisible: false, btnCount: 0, overflow: false };
            }

            gridData.scrollLeft = 0;
            const overflow = gridData.scrollWidth > gridData.clientWidth;

            const gridRect = grid.getBoundingClientRect();
            const headerRect = actionsHead.getBoundingClientRect();
            const cellRect = actionCell.getBoundingClientRect();
            const headerVisible = headerRect.right <= gridRect.right + 1 && headerRect.left >= gridRect.left - 1;
            const cellVisible = cellRect.right <= gridRect.right + 1 && cellRect.left >= gridRect.left - 1;
            const btnCount = actionCell.querySelectorAll('.gantt-task-action-btn').length;

            return { headerVisible, cellVisible, btnCount, overflow };
        });

        expect(visibility.headerVisible).toBe(true);
        expect(visibility.btnCount).toBe(2);
        expect(visibility.cellVisible).toBe(true);
    });
});
