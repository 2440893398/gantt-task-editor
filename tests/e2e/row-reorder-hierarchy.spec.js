import { test, expect } from '@playwright/test';

async function waitForGanttData(page) {
    await expect(page.locator('#gantt_here')).toBeVisible();
    await expect
        .poll(async () => {
            return page.evaluate(() => gantt?.serialize?.()?.data?.length ?? 0);
        })
        .toBeGreaterThan(0);
}

async function seedHierarchy(page) {
    await page.evaluate(() => {
        gantt.clearAll();
        gantt.parse({
            data: [
                {
                    id: '1',
                    text: 'Parent',
                    start_date: '2026-03-17',
                    duration: 4,
                    parent: 0,
                    open: true,
                },
                {
                    id: '2',
                    text: 'Child',
                    start_date: '2026-03-18',
                    duration: 1,
                    parent: '1',
                },
                {
                    id: '3',
                    text: 'Leaf target',
                    start_date: '2026-03-19',
                    duration: 1,
                    parent: 0,
                },
                {
                    id: '4',
                    text: 'Moved task',
                    start_date: '2026-03-20',
                    duration: 1,
                    parent: 0,
                },
            ],
            links: [],
        });
        gantt.open('1');
        gantt.render();
    });
}

async function dragRowHandleToRow(page, draggedTaskId, targetTaskId, verticalRatio = 0.5) {
    const handle = page.locator(
        `.gantt_grid_data .gantt_row[task_id="${draggedTaskId}"] .gantt-drag-handle`
    );
    const targetRow = page.locator(`.gantt_grid_data .gantt_row[task_id="${targetTaskId}"]`);

    await expect(handle).toBeVisible();
    await expect(targetRow).toBeVisible();

    const handleBox = await handle.boundingBox();
    const targetBox = await targetRow.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
        targetBox.x + Math.min(160, targetBox.width - 10),
        targetBox.y + targetBox.height * verticalRatio,
        { steps: 12 }
    );
    await page.mouse.up();
    await page.waitForTimeout(250);
}

test.describe('row reorder hierarchy', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForGanttData(page);
        await page.locator('[data-view="split"]').click();
        await seedHierarchy(page);
    });

    test('dragging onto a leaf row changes the dragged task parent', async ({ page }) => {
        await dragRowHandleToRow(page, '4', '3', 0.6);

        await expect
            .poll(async () => {
                return page.evaluate(() => String(gantt.getTask('4').parent));
            })
            .toBe('3');
    });

    test('dragging to the top edge of a root row promotes a child to root', async ({ page }) => {
        await dragRowHandleToRow(page, '2', '3', 0.08);

        await expect
            .poll(async () => {
                return page.evaluate(() => String(gantt.getTask('2').parent));
            })
            .toBe('0');
    });
});
