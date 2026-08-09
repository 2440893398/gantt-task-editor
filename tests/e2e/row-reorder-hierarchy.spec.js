import { test, expect } from '@playwright/test';

import { waitForAppReady } from './helpers/app-ready.js';

async function waitForGanttData(page) {
    await waitForAppReady(page);
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
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(250);
}

async function dispatchSortableDrop(page, draggedTaskId, targetTaskId, verticalRatio = 0.5) {
    await page.evaluate(
        async ({ draggedTaskId: draggedId, targetTaskId: targetId, ratio }) => {
            const grid = document.querySelector('.gantt_grid_data');
            const dragged = grid?.querySelector(`.gantt_row[task_id="${draggedId}"]`);
            const target = grid?.querySelector(`.gantt_row[task_id="${targetId}"]`);
            const { state } = await import('/src/core/store.js');
            const sortable = state.sortableInstance;
            const onMove = sortable?.options?.onMove;
            const onEnd = sortable?.options?.onEnd;
            if (!dragged || !target || !onMove || !onEnd) {
                throw new Error('Configured row Sortable callbacks not found');
            }

            const targetRect = target.getBoundingClientRect();
            onMove({
                dragged,
                item: dragged,
                related: target,
                willInsertAfter: false,
                originalEvent: { clientY: targetRect.top + targetRect.height * ratio },
            });
            onEnd({ item: dragged, oldIndex: 3, newIndex: 2 });
        },
        { draggedTaskId, targetTaskId, ratio: verticalRatio }
    );
}

test.describe('row reorder hierarchy', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await waitForGanttData(page);
        await page.locator('[data-view="split"]').click();
        await seedHierarchy(page);
        // Resource-conflict detection performs one delayed render after task changes.
        await page.waitForTimeout(750);
    });

    test('[SCN-GUI-003] dragging onto a leaf row changes the dragged task parent', async ({
        page,
    }) => {
        await dispatchSortableDrop(page, '4', '3', 0.6);

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
