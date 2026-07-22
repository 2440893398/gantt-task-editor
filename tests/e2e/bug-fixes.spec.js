import { test, expect } from '@playwright/test';

test.use({ locale: 'zh-CN' });

async function getTaskSchedule(page, taskId) {
    return await page.evaluate((id) => {
        const task = window.gantt.getTask(id);
        return {
            start: task.start_date.getTime(),
            end: task.end_date.getTime(),
            duration: task.duration,
        };
    }, taskId);
}

async function dragTaskEdge(page, taskId, edge, deltaX) {
    const taskBar = page.locator(`.gantt_task_line[task_id="${taskId}"]`);
    await expect(taskBar).toBeVisible();
    await taskBar.hover();

    const handleClass = edge === 'left' ? 'task_start_date' : 'task_end_date';
    const resizeHandle = taskBar.locator(`.gantt_task_drag.${handleClass}`);
    await expect(resizeHandle).toBeVisible();
    const handleBox = await resizeHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    const startX = handleBox.x + handleBox.width / 2;
    const y = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, y, { steps: 8 });
    await page.mouse.up();
}

test.describe('Bug Fixes Verification', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#gantt_here')).toBeVisible();
    });

    /**
     * TC-BUG-001: closing an unsaved new task must not run required-field validation.
     */
    test('[SCN-GUI-004] TC-BUG-001: Closing new task panel via X should not trigger validation', async ({
        page,
    }) => {
        await page.locator('#new-task-btn').click();
        const panel = page.locator('#task-details-panel');
        await expect(panel).toBeVisible();

        await page.locator('#btn-close-panel').click();

        await expect(panel).toBeHidden();
        await expect(page.locator('.gantt-toast .text-error')).toHaveCount(0);
    });

    /**
     * TC-BUG-002: error toasts must not remain on screen indefinitely.
     */
    test('TC-BUG-002: Error toasts should disappear automatically', async ({ page }) => {
        await page.evaluate(async () => {
            const { showToast } = await import('/src/utils/toast.js');
            showToast('Test Auto Hide', 'error', 100);
        });

        const toast = page.locator('.gantt-toast');
        await expect(toast).toContainText('Test Auto Hide');
        await expect(toast).toBeHidden({ timeout: 1000 });
    });

    test('TC-BUG-003: 未修改直接保存应显示本地化提示', async ({ page }) => {
        const missingTranslationWarnings = [];
        page.on('console', (message) => {
            if (message.text().includes('Missing translation for key: message.noChanges')) {
                missingTranslationWarnings.push(message.text());
            }
        });

        await page.evaluate(async () => {
            await window.i18n.setLanguage('zh-CN');
            window.gantt.clearAll();
            window.gantt.parse({
                data: [
                    {
                        id: 901,
                        text: '未修改保存验证',
                        start_date: new Date(2026, 6, 22),
                        duration: 1,
                        progress: 0,
                        schedule_mode: 'start_end',
                        summary: '<p><br></p>',
                        description: '<p><br></p>',
                    },
                ],
                links: [],
            });
        });

        await page.locator('.gantt-task-action-edit[data-task-id="901"]').click();
        await expect(page.locator('#task-details-panel')).toBeVisible();
        await page.locator('#btn-confirm-save').click();

        await expect(page.locator('.gantt-toast')).toContainText('没有可保存的变更');
        expect(missingTranslationWarnings).toEqual([]);
    });

    test('[SCN-GUI-010] start/end tasks resize one boundary while fixed-duration tasks reject resize', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(() => {
            window.gantt.clearAll();
            window.gantt.parse({
                data: [
                    {
                        id: 910,
                        text: '左边缘调整',
                        start_date: new Date(2026, 6, 20),
                        end_date: new Date(2026, 6, 25),
                        duration: 5,
                        schedule_mode: 'start_end',
                    },
                    {
                        id: 911,
                        text: '右边缘调整',
                        start_date: new Date(2026, 6, 20),
                        end_date: new Date(2026, 6, 25),
                        duration: 5,
                        schedule_mode: 'start_end',
                    },
                    {
                        id: 912,
                        text: '固定工期',
                        start_date: new Date(2026, 6, 20),
                        end_date: new Date(2026, 6, 25),
                        duration: 5,
                        schedule_mode: 'start_duration',
                    },
                ],
                links: [],
            });
            window.gantt.showDate(new Date(2026, 6, 20));
        });

        const leftBefore = await getTaskSchedule(page, 910);
        const rightBefore = await getTaskSchedule(page, 911);
        const fixedBefore = await getTaskSchedule(page, 912);
        const dayWidth = await page.evaluate(() => {
            return (
                window.gantt.posFromDate(new Date(2026, 6, 21)) -
                window.gantt.posFromDate(new Date(2026, 6, 20))
            );
        });

        await dragTaskEdge(page, 910, 'left', dayWidth * 2);
        const leftAfter = await getTaskSchedule(page, 910);
        expect(leftAfter.start).toBeGreaterThan(leftBefore.start);
        expect(leftAfter.end).toBe(leftBefore.end);

        await dragTaskEdge(page, 911, 'right', dayWidth * 2);
        const rightAfter = await getTaskSchedule(page, 911);
        expect(rightAfter.start).toBe(rightBefore.start);
        expect(rightAfter.end).toBeGreaterThan(rightBefore.end);

        const fixedTaskBar = page.locator('.gantt_task_line[task_id="912"]');
        await fixedTaskBar.hover();
        await expect(fixedTaskBar.locator('.gantt_task_drag.task_start_date')).toBeHidden();
        await expect(fixedTaskBar.locator('.gantt_task_drag.task_end_date')).toBeHidden();
        expect(await getTaskSchedule(page, 912)).toEqual(fixedBefore);
    });
});
