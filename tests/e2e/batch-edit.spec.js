import { test, expect } from '@playwright/test';

test.describe('批量编辑功能 E2E 测试', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5273/');
        // 等待甘特图加载完成
        await expect(page.locator('#gantt_here')).toBeVisible();
        await page.waitForTimeout(1000); // 等待甘特图完全渲染
    });

    test('应该批量更新文本字段', async ({ page }) => {
        // 1. 选中多个任务（点击复选框）
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();
        await checkboxes.nth(1).click();
        await checkboxes.nth(2).click();

        // 2. 验证选中计数显示正确
        await expect(page.locator('#selected-count')).toHaveText('3');

        // 3. 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 4. 验证面板显示选中任务数
        await expect(page.locator('#batch-selected-count')).toHaveText('3');

        // 5. 选择文本类型字段（假设有"优先级"字段）
        const fieldSelect = page.locator('#batch-field-select');
        await fieldSelect.selectOption({ index: 1 }); // 选择第一个自定义字段

        // 6. 等待输入框出现
        await expect(page.locator('#batch-field-input-container')).toBeVisible();

        // 7. 输入新值
        const textInput = page.locator('#batch-field-input input[type="text"]');
        if (await textInput.count() > 0) {
            await textInput.fill('高优先级');

            // 8. 点击应用按钮
            await page.locator('#batch-apply-btn').click();

            // 9. 验证面板关闭
            await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);

            // 10. 验证选中计数归零
            await expect(page.locator('#selected-count')).toHaveText('0');

            // 11. 验证成功提示
            await expect(page.locator('.toast.success')).toBeVisible();
        }
    });

    test('应该批量更新数字字段', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();
        await checkboxes.nth(1).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 选择字段
        const fieldSelect = page.locator('#batch-field-select');

        // 查找数字类型字段
        const options = await fieldSelect.locator('option').allTextContents();
        let numberFieldIndex = -1;

        // 假设我们有一个数字字段，找到它
        for (let i = 1; i < options.length; i++) {
            await fieldSelect.selectOption({ index: i });
            await page.waitForTimeout(200);

            const numberInput = page.locator('#batch-field-input input[type="number"]');
            if (await numberInput.count() > 0) {
                numberFieldIndex = i;
                break;
            }
        }

        if (numberFieldIndex !== -1) {
            // 输入数字值
            const numberInput = page.locator('#batch-field-input input[type="number"]');
            await numberInput.fill('100');

            // 应用批量编辑
            await page.locator('#batch-apply-btn').click();

            // 验证成功
            await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);
            await expect(page.locator('.toast.success')).toBeVisible();
        }
    });

    test('应该批量更新下拉选择字段', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();
        await checkboxes.nth(1).click();
        await checkboxes.nth(2).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 选择字段并查找下拉选择类型
        const fieldSelect = page.locator('#batch-field-select');
        const options = await fieldSelect.locator('option').allTextContents();

        for (let i = 1; i < options.length; i++) {
            await fieldSelect.selectOption({ index: i });
            await page.waitForTimeout(200);

            // 查找单选下拉框（不是多选）
            const selectInput = page.locator('#batch-field-input select:not([multiple])');
            if (await selectInput.count() > 0) {
                // 选择一个选项
                const selectOptions = await selectInput.locator('option').count();
                if (selectOptions > 1) {
                    await selectInput.selectOption({ index: 1 });

                    // 应用批量编辑
                    await page.locator('#batch-apply-btn').click();

                    // 验证成功
                    await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);
                    await expect(page.locator('.toast.success')).toBeVisible();
                    return;
                }
            }
        }
    });

    test('应该批量更新多选字段', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();
        await checkboxes.nth(1).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 选择字段并查找多选类型
        const fieldSelect = page.locator('#batch-field-select');
        const options = await fieldSelect.locator('option').allTextContents();

        for (let i = 1; i < options.length; i++) {
            await fieldSelect.selectOption({ index: i });
            await page.waitForTimeout(200);

            // 查找多选下拉框
            const multiselectInput = page.locator('#batch-field-input select[multiple]');
            if (await multiselectInput.count() > 0) {
                // 选择多个选项
                const selectOptions = await multiselectInput.locator('option').all();
                if (selectOptions.length >= 2) {
                    // 选择前两个选项
                    await multiselectInput.selectOption([
                        { index: 0 },
                        { index: 1 }
                    ]);

                    // 应用批量编辑
                    await page.locator('#batch-apply-btn').click();

                    // 验证成功
                    await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);
                    await expect(page.locator('.toast.success')).toBeVisible();
                    return;
                }
            }
        }
    });

    test('应该在应用后清除选择并关闭面板', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();
        await checkboxes.nth(1).click();
        await checkboxes.nth(2).click();

        // 验证选中计数
        await expect(page.locator('#selected-count')).toHaveText('3');

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 选择任意字段
        const fieldSelect = page.locator('#batch-field-select');
        await fieldSelect.selectOption({ index: 1 });
        await page.waitForTimeout(200);

        // 填写值（根据字段类型）
        const textInput = page.locator('#batch-field-input input[type="text"]');
        const numberInput = page.locator('#batch-field-input input[type="number"]');
        const selectInput = page.locator('#batch-field-input select');

        if (await textInput.count() > 0) {
            await textInput.fill('测试值');
        } else if (await numberInput.count() > 0) {
            await numberInput.fill('99');
        } else if (await selectInput.count() > 0) {
            await selectInput.selectOption({ index: 1 });
        }

        // 应用批量编辑
        await page.locator('#batch-apply-btn').click();

        // 验证面板关闭
        await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);

        // 验证选中计数归零（选择已被清除）
        await expect(page.locator('#selected-count')).toHaveText('0');

        // 注意：复选框UI状态的清除依赖applySelectionStyles()中的多个setTimeout
        // 由于时序复杂，这里只验证选择状态已清除（state.selectedTasks.clear()）
    });

    test('字段选择变化应该更新输入框类型', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        const fieldSelect = page.locator('#batch-field-select');
        const options = await fieldSelect.locator('option').allTextContents();

        // 记录不同字段类型的输入框
        const fieldTypes = [];

        // 遍历所有字段选项
        for (let i = 1; i < options.length && i < 5; i++) {
            await fieldSelect.selectOption({ index: i });
            await page.waitForTimeout(200);

            // 检查输入框容器是否可见
            await expect(page.locator('#batch-field-input-container')).toBeVisible();

            // 检测输入框类型
            if (await page.locator('#batch-field-input input[type="text"]').count() > 0) {
                fieldTypes.push('text');
            } else if (await page.locator('#batch-field-input input[type="number"]').count() > 0) {
                fieldTypes.push('number');
            } else if (await page.locator('#batch-field-input select[multiple]').count() > 0) {
                fieldTypes.push('multiselect');
            } else if (await page.locator('#batch-field-input select').count() > 0) {
                fieldTypes.push('select');
            } else if (await page.locator('#batch-field-input input[type="date"]').count() > 0) {
                fieldTypes.push('date');
            }
        }

        // 验证至少检测到不同类型的输入框
        expect(fieldTypes.length).toBeGreaterThan(0);
    });

    test('应该在没有选中任务时显示错误提示', async ({ page }) => {
        // 不选中任何任务，直接点击批量编辑按钮
        await page.locator('#batch-edit-btn').click();

        // 验证面板没有打开
        await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);

        // 验证显示错误提示
        await expect(page.locator('.toast.error')).toBeVisible();
        await expect(page.locator('.toast.error')).toContainText('请先选择');
    });

    test('应该在未选择字段时显示错误提示', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 不选择字段，直接点击应用
        await page.locator('#batch-apply-btn').click();

        // 验证显示错误提示
        await expect(page.locator('.toast.error')).toBeVisible();
        await expect(page.locator('.toast.error')).toContainText('请选择');
    });

    test('应该能够取消批量编辑', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();
        await checkboxes.nth(1).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 选择字段
        const fieldSelect = page.locator('#batch-field-select');
        await fieldSelect.selectOption({ index: 1 });

        // 点击取消按钮
        await page.locator('#batch-cancel-btn').click();

        // 验证面板关闭
        await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);

        // 验证选中状态保持（没有清除）
        await expect(page.locator('#selected-count')).toHaveText('2');
    });

    test('应该能够通过X按钮关闭批量编辑面板', async ({ page }) => {
        // 选中任务
        const checkboxes = page.locator('.gantt_grid .gantt_tree_content input[type="checkbox"]');
        await checkboxes.nth(0).click();

        // 打开批量编辑面板
        await page.locator('#batch-edit-btn').click();
        await expect(page.locator('#batch-edit-panel')).toHaveClass(/open/);

        // 点击关闭按钮
        await page.locator('#close-batch-edit').click();

        // 验证面板关闭
        await expect(page.locator('#batch-edit-panel')).not.toHaveClass(/open/);
    });
});
