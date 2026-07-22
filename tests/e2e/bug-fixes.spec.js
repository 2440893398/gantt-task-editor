import { test, expect } from '@playwright/test';

test.use({ locale: 'zh-CN' });

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
});
