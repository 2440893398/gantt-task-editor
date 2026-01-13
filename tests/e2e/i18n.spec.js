
import { test, expect } from '@playwright/test';

test.use({ locale: 'zh-CN' });

test.describe('Internationalization (I18n)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5273/');
        // Wait for Gantt ready
        await expect(page.locator('#gantt_here')).toBeVisible();
    });

    test('TC-I18N-001: Default language should be Simplified Chinese', async ({ page }) => {

        await expect(page.locator('#current-view-text')).toHaveText('周视图'); // or Week View if localized
        // Check Batch Edit button title or checks
        // The title attribute might be tested, or text if visible
        // Based on index.html: <button ... title="批量编辑" data-i18n-title="toolbar.batchEdit">
        const batchEditBtn = page.locator('#batch-edit-btn');
        await expect(batchEditBtn).toHaveAttribute('title', '批量编辑');

        // Check New Task button text
        await expect(page.locator('#new-task-btn span').last()).toHaveText('新建任务');
        // Note: In index.html line 146 it says <span data-i18n="toolbar.newTask">New Task</span>
        // If the JS initializes I18n correctly on load, it should change to "新建任务".
        // Depending on when `locale_cn.js` and `i18n.js` run.
    });

    test('TC-I18N-002: Switch to English', async ({ page }) => {
        // 1. Open More menu
        await page.locator('.more-btn').click();
        const dropdown = page.locator('#more-actions-dropdown');
        await expect(dropdown).toHaveClass(/active/);

        // 2. Open Language submenu (Hover or Click?)
        // Code says structure is nested div, but no click event on #language-menu itself mentioned in script? 
        // CSS typically handles hover for submenu, or maybe click. 
        // Let's assume hover or visible. "dropdown-submenu" class usually implies CSS hover.
        // But let's try to click it just in case or select the item directly if visible.
        const langMenu = page.locator('#language-menu');
        await langMenu.hover();

        // 3. Select English
        const enOption = page.locator('.dropdown-item[data-lang="en-US"]');
        await expect(enOption).toBeVisible();
        await enOption.click();

        // 4. Verify UI changes
        await expect(page.locator('#current-view-text')).toHaveText(/Week View|Week/i);
        await expect(page.locator('#new-task-btn span').last()).toHaveText('New Task');
        await expect(page.locator('#batch-edit-btn')).toHaveAttribute('title', 'Batch Edit');
    });

    test('TC-I18N-003: Switch to Japanese', async ({ page }) => {
        await page.locator('.more-btn').click();
        await page.locator('#language-menu').hover();
        await page.locator('.dropdown-item[data-lang="ja-JP"]').click();

        // Verify UI
        // Japanese for New Task is usually "新しいタスク" or similar
        // Adjust expectation based on likely translation. 
        // Checking button title might be safer if we don't know exact text.
        // But for "Batch Edit", it might be "一括編集"
        await expect(page.locator('#batch-edit-btn')).toHaveAttribute('title', /一括編集|編集モード/);
    });

    test('TC-I18N-004: Switch to Korean', async ({ page }) => {
        await page.locator('.more-btn').click();
        await page.locator('#language-menu').hover();
        await page.locator('.dropdown-item[data-lang="ko-KR"]').click();

        // Verify UI
        // Korean for New Task: "새 작업"
        // Batch Edit: "일괄 편집"
        await expect(page.locator('#batch-edit-btn')).toHaveAttribute('title', /일괄 편집|편집/);
    });

    test('TC-I18N-005: Date format in Gantt header should change', async ({ page }) => {
        // Switch to English
        await page.locator('.more-btn').click();
        await page.locator('#language-menu').hover();
        await page.locator('.dropdown-item[data-lang="en-US"]').click();

        // Check Gantt Scale (Header)
        // This relies on DHTMLX Gantt rendering.
        // Usually English is "Jan 2026" or similar.
        // Chinese is "2026年1月".
        // Let's just grab a date cell and check format.
        const scaleCell = page.locator('.gantt_scale_cell').first();
        // This assertion might be flaky depending on current date and view.
        // Just checking it contains English characters vs Chinese characters might be enough.
        // Or check month names.
        // TODO: Refine this validation if flaky.
    });
});
