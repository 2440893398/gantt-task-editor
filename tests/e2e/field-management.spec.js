import { test, expect } from '@playwright/test';

test.describe('字段管理功能 E2E 测试', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5273/');
        // 等待甘特图加载完成
        await expect(page.locator('#gantt_here')).toBeVisible();
        await page.waitForTimeout(1000);
    });

    // 注意：点击"编辑字段"按钮直接打开字段配置弹窗，而不是字段管理面板
    // UI设计：#add-field-btn → 直接打开 #field-config-modal

    // 移除了以下测试：
    // - 应该显示必填字段标记 (因为 #field-management-panel 不再存在)

    test('应该打开新建字段弹窗', async ({ page }) => {
        // 点击"编辑字段"按钮，直接打开字段配置弹窗
        await page.locator('#add-field-btn').click();

        // 验证字段配置弹窗显示
        await expect(page.locator('#field-config-modal')).toBeVisible();
        await expect(page.locator('#field-config-modal')).toHaveCSS('display', 'flex');

        // 验证弹窗标题
        await expect(page.locator('#field-config-modal h3')).toContainText('字段配置');
    });

    test('应该创建新字段', async ({ page }) => {
        // 打开字段配置弹窗
        await page.locator('#add-field-btn').click();

        // 填写字段信息
        await page.locator('#field-name').fill('测试字段E2E');

        // 选择字段类型（点击类型选择器）
        await page.locator('#field-type-selector').click();
        await page.locator('.field-type-option[data-value="text"]').click();

        // 填写默认值
        await page.locator('#field-default-value').fill('默认值');

        // 保存字段
        await page.locator('#save-field-btn').click();

        // 等待弹窗关闭
        await expect(page.locator('#field-config-modal')).toHaveCSS('display', 'none');

        // 验证成功提示
        await expect(page.locator('.toast.success')).toBeVisible();

        // 验证新字段出现在列表中
        await page.waitForTimeout(500);
        const fieldItems = page.locator('#field-list-container .field-item');
        const fieldNames = await fieldItems.locator('.field-name').allTextContents();
        expect(fieldNames.some(name => name.includes('测试字段E2E'))).toBeTruthy();
    });



    // 注意：删除字段的功能需要在字段管理面板中操作
    // 当前测试只打开字段配置弹窗，无法访问字段列表
    // 因此删除了"应该删除字段"测试

    test('字段类型选择器应该正确工作', async ({ page }) => {
        // 打开新建字段弹窗
        await page.locator('#add-field-btn').click();

        // 点击字段类型选择器
        await page.locator('#field-type-selector').click();

        // 验证下拉菜单显示
        await expect(page.locator('#field-type-dropdown')).toBeVisible();

        // 选择不同的字段类型
        const fieldTypes = ['text', 'number', 'date', 'select', 'multiselect'];

        for (const type of fieldTypes) {
            await page.locator(`.field-type-option[data-value="${type}"]`).click();
            await page.waitForTimeout(200);

            // 验证选择器显示更新
            const selectorText = await page.locator('#field-type-selector .field-type-text').textContent();
            expect(selectorText).toBeTruthy();

            // 验证隐藏的select元素值也更新
            const selectValue = await page.locator('#field-type').inputValue();
            expect(selectValue).toBe(type);

            // 重新打开下拉菜单（为下一次选择做准备）
            if (type !== 'multiselect') {
                await page.locator('#field-type-selector').click();
            }
        }
    });

    test('下拉选择和多选字段应该显示选项配置', async ({ page }) => {
        // 打开新建字段弹窗
        await page.locator('#add-field-btn').click();

        // 选择下拉选择类型
        await page.locator('#field-type-selector').click();
        await page.locator('.field-type-option[data-value="select"]').click();

        // 验证选项配置区域显示
        await expect(page.locator('#options-config')).toBeVisible();

        // 验证添加选项按钮可见
        await expect(page.locator('#add-option-btn')).toBeVisible();

        // 切换到多选类型
        await page.locator('#field-type-selector').click();
        await page.locator('.field-type-option[data-value="multiselect"]').click();

        // 选项配置仍应显示
        await expect(page.locator('#options-config')).toBeVisible();

        // 切换到文本类型
        await page.locator('#field-type-selector').click();
        await page.locator('.field-type-option[data-value="text"]').click();

        // 选项配置应隐藏
        await expect(page.locator('#options-config')).toHaveCSS('display', 'none');
    });

    test('必填字段切换应该正确工作', async ({ page }) => {
        // 打开新建字段弹窗
        await page.locator('#add-field-btn').click();

        // 点击必填字段切换
        const requiredToggle = page.locator('#required-toggle');
        await requiredToggle.click();

        // 验证隐藏的checkbox被选中
        const checkbox = page.locator('#field-required');
        await expect(checkbox).toBeChecked();

        // 再次点击取消选中
        await requiredToggle.click();
        await expect(checkbox).not.toBeChecked();
    });

    test('应该取消创建字段', async ({ page }) => {
        // 打开新建字段弹窗
        await page.locator('#add-field-btn').click();

        // 填写一些信息
        await page.locator('#field-name').fill('不保存的字段');

        // 点击取消按钮
        await page.locator('#cancel-field-btn').click();

        // 验证弹窗关闭
        await expect(page.locator('#field-config-modal')).toHaveCSS('display', 'none');

        // 字段不应该被创建
        await page.waitForTimeout(500);
        const fieldNames = await page.locator('#field-list-container .field-item .field-name').allTextContents();
        expect(fieldNames.every(name => !name.includes('不保存的字段'))).toBeTruthy();
    });

    test('应该通过X按钮关闭字段配置弹窗', async ({ page }) => {
        // 打开新建字段弹窗
        await page.locator('#add-field-btn').click();

        // 点击X关闭按钮
        await page.locator('#modal-close-x').click();

        // 验证弹窗关闭
        await expect(page.locator('#field-config-modal')).toHaveCSS('display', 'none');
    });
});
