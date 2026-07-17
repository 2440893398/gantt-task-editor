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
});
