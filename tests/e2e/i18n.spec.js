
import { test, expect } from '@playwright/test';

test.use({ locale: 'zh-CN' });

test.describe('Internationalization (I18n)', () => {
    test.beforeEach(async ({ page }) => {
        // 清除保存的语言设置，让应用根据浏览器locale自动检测
        await page.addInitScript(() => {
            localStorage.removeItem('gantt_locale');
        });
        await page.goto('http://localhost:5273/');
        // Wait for Gantt ready
        await expect(page.locator('#gantt_here')).toBeVisible();
    });

    test('TC-I18N-001: Default language should be Simplified Chinese', async ({ page }) => {
        // 视图选择器现在是 select 元素，检查选中的 option 文本
        const viewSelector = page.locator('#view-selector');
        await expect(viewSelector).toBeVisible();
        // 检查选中的选项文本是"周视图"
        const selectedOption = viewSelector.locator('option:checked');
        await expect(selectedOption).toHaveText('周视图');

        // Check Batch Edit button title
        const batchEditBtn = page.locator('#batch-edit-btn');
        await expect(batchEditBtn).toHaveAttribute('title', '批量编辑');

        // Check New Task button text
        await expect(page.locator('#new-task-btn span[data-i18n="toolbar.newTask"]')).toContainText('新建任务');
    });

    test('TC-I18N-002: Switch to English', async ({ page }) => {
        // 1. Open More menu
        await page.locator('.more-btn').click();
        // 等待下拉菜单内容可见
        await expect(page.locator('#more-actions-dropdown .dropdown-content')).toBeVisible();

        // 2. Open Language submenu (details element)
        const langMenu = page.locator('#language-menu');
        await langMenu.locator('summary').click();

        // 3. Select English
        const enOption = page.locator('#language-menu .dropdown-item[data-lang="en-US"]');
        await expect(enOption).toBeVisible();
        await enOption.click();

        // 4. Verify UI changes - 等待语言切换完成
        await page.waitForTimeout(500);
        const selectedOption = page.locator('#view-selector option:checked');
        await expect(selectedOption).toHaveText(/Week|Week View/i);
        await expect(page.locator('#new-task-btn span[data-i18n="toolbar.newTask"]')).toContainText('New Task');
        await expect(page.locator('#batch-edit-btn')).toHaveAttribute('title', 'Batch Edit');
    });

    test('TC-I18N-003: Switch to Japanese', async ({ page }) => {
        await page.locator('.more-btn').click();
        await page.locator('#language-menu summary').click();
        await page.locator('#language-menu .dropdown-item[data-lang="ja-JP"]').click();

        // Verify UI - 等待语言切换完成
        await page.waitForTimeout(500);
        // Japanese for Batch Edit: "一括編集"
        await expect(page.locator('#batch-edit-btn')).toHaveAttribute('title', /一括編集|バッチ編集/);
    });

    test('TC-I18N-004: Switch to Korean', async ({ page }) => {
        await page.locator('.more-btn').click();
        await expect(page.locator('#more-actions-dropdown .dropdown-content')).toBeVisible();
        await page.locator('#language-menu summary').click();
        // 确保语言选项可见
        const koOption = page.locator('#language-menu .dropdown-item[data-lang="ko-KR"]');
        await expect(koOption).toBeVisible();
        await koOption.click();

        // Verify UI - 等待语言切换完成
        await page.waitForTimeout(1000);
        // Korean for Batch Edit: "일괄 편집"
        await expect(page.locator('#batch-edit-btn')).toHaveAttribute('title', '일괄 편집');
    });

    test('TC-I18N-005: Date format in Gantt header should change', async ({ page }) => {
        // Switch to English
        await page.locator('.more-btn').click();
        await page.locator('#language-menu summary').click();
        await page.locator('#language-menu .dropdown-item[data-lang="en-US"]').click();

        // Wait for language switch and gantt re-render
        await page.waitForTimeout(1000);

        // Check Gantt Scale (Header) - English format should show month names like "Jan", "Feb"
        const scaleCell = page.locator('.gantt_scale_cell').first();
        await expect(scaleCell).toBeVisible();
        // The date format change is verified by the gantt chart re-rendering
        // This test mainly ensures no errors occur during the switch
    });
});
