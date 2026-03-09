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

async function waitForGanttData(page) {
    await expect(page.locator('#gantt_here')).toBeVisible();
    await expect.poll(async () => {
        return page.evaluate(() => window.gantt?.serialize?.()?.data?.length ?? 0);
    }).toBeGreaterThan(0);
}

async function configureOverflowingGrid(page) {
    await page.evaluate(() => {
        localStorage.setItem('gantt_field_order', JSON.stringify([
            'text',
            'priority',
            'assignee',
            'status',
            'description',
            'start_date',
            'end_date',
            'duration',
            'progress',
            'actual_start',
            'actual_end',
            'actual_hours'
        ]));

        localStorage.setItem('gantt_system_field_settings', JSON.stringify({
            enabled: {
                status: true,
                progress: true,
                duration: true,
                actual_start: true,
                actual_end: true,
                actual_hours: true
            },
            typeOverrides: {}
        }));

        localStorage.setItem('gantt_grid_width', JSON.stringify(220));
        localStorage.setItem('gantt_view_mode', JSON.stringify('split'));
    });

    await page.reload();
    await waitForGanttData(page);
    await expect(page.locator('[data-view="split"]')).toHaveClass(/active/);
}

test.describe('table grid behavior regressions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForGanttData(page);
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

    test('gantt-only mode keeps the actions column pinned to the far right after widening the grid', async ({ page }) => {
        await page.locator('[data-view="gantt"]').click();
        await dragResizer(page, 420);

        const layout = await page.evaluate(() => {
            const grid = document.querySelector('.gantt_grid');
            const actionsHead = document.querySelector('.gantt_grid_head_cell[data-column-name="actions"]');
            const firstRow = document.querySelector('.gantt_grid_data .gantt_row');
            const actionCell = firstRow?.querySelector('.gantt_cell.gantt_last_cell') || null;

            if (!grid || !actionsHead || !actionCell) {
                return { gap: Number.POSITIVE_INFINITY, cellGap: Number.POSITIVE_INFINITY, btnCount: 0 };
            }

            const gridRect = grid.getBoundingClientRect();
            const headerRect = actionsHead.getBoundingClientRect();
            const cellRect = actionCell.getBoundingClientRect();

            return {
                gap: Math.round(gridRect.right - headerRect.right),
                cellGap: Math.round(gridRect.right - cellRect.right),
                btnCount: actionCell.querySelectorAll('.gantt-task-action-btn').length
            };
        });

        expect(layout.btnCount).toBe(3);
        expect(layout.gap).toBeLessThanOrEqual(2);
        expect(layout.cellGap).toBeLessThanOrEqual(2);
    });

    test('split mode keeps actions cells aligned after dragging the real bottom scrollbar', async ({ page }) => {
        await configureOverflowingGrid(page);

        const alignment = await page.evaluate(() => {
            const bottomScrollbar = document.querySelector('.gantt_hor_scroll');
            if (!bottomScrollbar) {
                return { maxScroll: 0, scrollLeft: 0, diffLeft: Number.POSITIVE_INFINITY, diffRight: Number.POSITIVE_INFINITY };
            }

            bottomScrollbar.scrollLeft = Math.max(0, bottomScrollbar.scrollWidth - bottomScrollbar.clientWidth);
            bottomScrollbar.dispatchEvent(new Event('scroll', { bubbles: true }));

            const grid = document.querySelector('.gantt_grid');
            const actionsHead = document.querySelector('.gantt_grid_head_cell[data-column-name="actions"]');
            const firstRow = document.querySelector('.gantt_grid_data .gantt_row');
            const actionCell = firstRow?.querySelector('.gantt_cell.gantt_last_cell') || null;

            if (!grid || !actionsHead || !actionCell) {
                return {
                    maxScroll: bottomScrollbar.scrollWidth - bottomScrollbar.clientWidth,
                    scrollLeft: bottomScrollbar.scrollLeft,
                    diffLeft: Number.POSITIVE_INFINITY,
                    diffRight: Number.POSITIVE_INFINITY
                };
            }

            const headerRect = actionsHead.getBoundingClientRect();
            const cellRect = actionCell.getBoundingClientRect();

            return {
                maxScroll: bottomScrollbar.scrollWidth - bottomScrollbar.clientWidth,
                scrollLeft: bottomScrollbar.scrollLeft,
                diffLeft: Math.round(cellRect.left - headerRect.left),
                diffRight: Math.round(cellRect.right - headerRect.right)
            };
        });

        expect(alignment.maxScroll).toBeGreaterThan(0);
        expect(alignment.scrollLeft).toBeGreaterThan(0);
        expect(alignment.diffLeft).toBe(0);
        expect(alignment.diffRight).toBe(0);

        const recover = await page.evaluate(() => {
            const bottomScrollbar = document.querySelector('.gantt_hor_scroll');
            if (!bottomScrollbar) {
                return { btnVisible: false, offset: '' };
            }

            bottomScrollbar.scrollLeft = 0;
            bottomScrollbar.dispatchEvent(new Event('scroll', { bubbles: true }));

            const grid = document.querySelector('.gantt_grid');
            const firstRow = document.querySelector('.gantt_grid_data .gantt_row');
            const actionBtn = firstRow?.querySelector('.gantt_cell.gantt_last_cell .gantt-task-action-btn') || null;
            if (!grid || !actionBtn) {
                return { btnVisible: false, offset: getComputedStyle(document.documentElement).getPropertyValue('--gantt-grid-scroll-left').trim() };
            }

            const gridRect = grid.getBoundingClientRect();
            const btnRect = actionBtn.getBoundingClientRect();
            const btnVisible = btnRect.left >= gridRect.left - 1 && btnRect.right <= gridRect.right + 1;

            return {
                btnVisible,
                offset: getComputedStyle(document.documentElement).getPropertyValue('--gantt-grid-scroll-left').trim()
            };
        });

        expect(recover.btnVisible).toBe(true);
        expect(recover.offset).toBe('0px');
    });
});
