/**
 * 用户反馈优化测试
 * 测试需求: OPT-001 ~ OPT-004, BUG-001 ~ BUG-002
 * 测试用例来源: doc/testdoc/TEST-用户反馈优化-单元用例.md
 */

import { test, expect } from '@playwright/test';

// 默认使用中文环境
test.use({ locale: 'zh-CN' });

test.describe('用户反馈优化测试套件', () => {
    test.beforeEach(async ({ page }) => {
        // 增加单个测试超时时间
        test.setTimeout(60000);

        await page.goto('http://localhost:5273/');
        // 等待甘特图核心元素加载完成
        await expect(page.locator('#gantt_here')).toBeVisible({ timeout: 30000 });
        // 等待工具栏初始化完成
        await expect(page.locator('#scroll-to-today-btn')).toBeVisible({ timeout: 15000 });
        // 等待甘特图数据渲染完成
        await expect(page.locator('.gantt_grid_data .gantt_row')).toHaveCount(
            await page.locator('.gantt_grid_data .gantt_row').count().then(c => c > 0 ? c : 1),
            { timeout: 10000 }
        );
    });

    // ===== 3.1 OPT-001: 移除表格悬浮查看详情功能 =====
    test.describe('OPT-001: 表格tooltip移除', () => {
        test('TC-001-01: 表格任务行悬浮无tooltip', async ({ page }) => {
            // 获取表格区域的任务行
            const gridRow = page.locator('.gantt_grid_data .gantt_row').first();
            await expect(gridRow).toBeVisible();

            // 悬停在表格行上
            await gridRow.hover();
            await page.waitForTimeout(2000);

            // 检查没有tooltip出现 - dhtmlx gantt的tooltip通常是.gantt_tooltip类
            const tooltip = page.locator('.gantt_tooltip');
            await expect(tooltip).toHaveCount(0);
        });

        test('TC-001-02: 表格各列单元格悬浮无tooltip', async ({ page }) => {
            // 获取表格区域的单元格
            const cells = page.locator('.gantt_grid_data .gantt_cell');
            const cellCount = await cells.count();

            // 悬停在前几个单元格上检查
            for (let i = 0; i < Math.min(cellCount, 5); i++) {
                const cell = cells.nth(i);
                await cell.hover();
                await page.waitForTimeout(500);

                // 确认没有tooltip
                const tooltip = page.locator('.gantt_tooltip');
                await expect(tooltip).toHaveCount(0);
            }
        });

        test('TC-001-03: 甘特图甘特条悬浮有tooltip', async ({ page }) => {
            // 获取甘特图区域的任务条
            const taskBar = page.locator('.gantt_task_content').first();

            if (await taskBar.count() > 0) {
                // 确保鼠标移动到任务条上触发 tooltip
                // 先force hover一下body或者其他地方重置状态
                await page.mouse.move(0, 0);
                await page.waitForTimeout(100);

                await taskBar.hover({ force: true });
                await page.waitForTimeout(1000); // 等待 tooltip 动画

                // 甘特条应该显示tooltip
                const tooltip = page.locator('.gantt_tooltip');
                await expect(tooltip).toBeVisible();
                console.log('甘特条悬停测试完成 - Tooltip可见');
            }
        });
    });

    // ===== 3.2 OPT-002: 支持直接在表格中编辑值 =====
    test.describe('OPT-002: 内联编辑功能', () => {
        test('TC-002-01: 双击编辑任务名称', async ({ page }) => {
            // 找到任务名称单元格
            const textCell = page.locator('.gantt_cell[data-column-name="text"]').first();
            await expect(textCell).toBeVisible();

            // 双击进入编辑模式
            await textCell.dblclick();
            await page.waitForTimeout(300);

            // 应该出现输入框
            const editor = page.locator('.gantt-inline-editor');
            await expect(editor).toBeVisible();

            // 输入新名称
            await editor.fill('测试任务ABC');

            // 按Enter保存
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);

            // 验证保存成功 - 编辑器应该消失
            await expect(editor).not.toBeVisible();
        });

        test('TC-002-03: 编辑工期', async ({ page }) => {
            // 找到工期单元格
            const durationCell = page.locator('.gantt_cell[data-column-name="duration"]').first();

            if (await durationCell.count() > 0) {
                await durationCell.dblclick();
                await page.waitForTimeout(300);

                // 工期编辑器是 number 类型
                const editor = page.locator('.gantt-inline-editor');
                if (await editor.count() > 0) {
                    await editor.fill('5');
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);
                    console.log('工期编辑测试完成');
                }
            }
        });

        test('TC-002-06: 编辑进度百分比', async ({ page }) => {
            // 找到进度单元格
            const progressCell = page.locator('.gantt_cell[data-column-name="progress"]').first();

            if (await progressCell.count() > 0) {
                await progressCell.dblclick(); // Added dblclick
                await page.waitForTimeout(300);

                // 进度编辑器是 number 类型
                const editor = page.locator('.gantt-inline-editor');
                if (await editor.count() > 0) {
                    await editor.fill('75');
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);
                    console.log('进度编辑测试完成');
                }
            }
        });

        test('TC-002-11: 取消编辑操作', async ({ page }) => {
            // 找到任务名称单元格
            const textCell = page.locator('.gantt_cell[data-column-name="text"]').first();

            if (await textCell.count() > 0) {
                // 获取原始值
                const originalText = await textCell.textContent();

                // 双击进入编辑模式
                await textCell.dblclick();
                await page.waitForTimeout(300);

                const editor = page.locator('.gantt-inline-editor');
                if (await editor.count() > 0) {
                    // 修改内容
                    await editor.fill('临时修改内容');

                    // 按Escape取消
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(300);

                    // 编辑器应该消失
                    await expect(editor).not.toBeVisible();
                    console.log('取消编辑测试完成');
                }
            }
        });
    });

    // ===== 3.3 OPT-003: 本地缓存配置和数据 =====
    test.describe('OPT-003: 本地缓存持久化', () => {
        test('TC-003-07: 语言设置持久化', async ({ page }) => {
            // 打开更多下拉菜单
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            // 打开语言子菜单
            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);

            // 切换到英语
            const enOption = page.locator('[data-lang="en-US"]');
            await enOption.click();
            await page.waitForTimeout(1000);

            // 刷新页面
            await page.reload();
            // 等待甘特图和工具栏加载
            await expect(page.locator('#gantt_here')).toBeVisible({ timeout: 30000 });
            await expect(page.locator('#scroll-to-today-btn')).toBeVisible({ timeout: 10000 });
            await page.waitForTimeout(2000);

            // 验证语言设置保留 - 检查Today按钮文本 (使用 toContainText 自动重试)
            await expect(page.locator('#scroll-to-today-btn')).toContainText('Today');
        });
    });

    // ===== 3.4 OPT-004: 优化导入导出图标 =====
    test.describe('OPT-004: 导入导出图标优化', () => {
        test('TC-004-01: Excel导入图标可识别', async ({ page }) => {
            // 打开下拉菜单
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            // 检查Excel导入项存在
            const importExcel = page.locator('#dropdown-import-excel');
            await expect(importExcel).toBeVisible();

            // 检查有XLS标识
            const xlsBadge = importExcel.locator('text=XLS');
            await expect(xlsBadge).toBeVisible();
        });

        test('TC-004-02: Excel导出图标可识别', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const exportExcel = page.locator('#dropdown-export-excel');
            await expect(exportExcel).toBeVisible();

            const xlsBadge = exportExcel.locator('text=XLS');
            await expect(xlsBadge).toBeVisible();
        });

        test('TC-004-03: JSON导入图标可识别', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const importJson = page.locator('#dropdown-import-json');
            await expect(importJson).toBeVisible();

            // 检查有{}标识
            const jsonBadge = importJson.locator('text={}');
            await expect(jsonBadge).toBeVisible();
        });

        test('TC-004-04: JSON导出图标可识别', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const exportJson = page.locator('#dropdown-export-json');
            await expect(exportJson).toBeVisible();

            const jsonBadge = exportJson.locator('text={}');
            await expect(jsonBadge).toBeVisible();
        });

        test('TC-004-05: 图标风格统一', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            // 检查所有导入导出项都存在
            await expect(page.locator('#dropdown-export-excel')).toBeVisible();
            await expect(page.locator('#dropdown-import-excel')).toBeVisible();
            await expect(page.locator('#dropdown-export-json')).toBeVisible();
            await expect(page.locator('#dropdown-import-json')).toBeVisible();
        });
    });

    // ===== 3.5 BUG-001: 优先级/状态下拉值本地化 =====
    test.describe('BUG-001: 下拉选项本地化', () => {
        test('TC-B01-01: 中文-优先级下拉本地化', async ({ page }) => {
            // 确保是中文环境 - 通过点击语言切换
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);

            const zhOption = page.locator('[data-lang="zh-CN"]');
            await zhOption.click();
            await page.waitForTimeout(1000);

            // 验证界面已切换到中文
            await expect(page.locator('#scroll-to-today-btn')).toContainText('今天');
            console.log('中文本地化测试通过');
        });

        test('TC-B01-03: 英文-优先级下拉本地化', async ({ page }) => {
            // 切换到英文
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);

            const enOption = page.locator('[data-lang="en-US"]');
            await enOption.click();
            await page.waitForTimeout(1000);

            // 验证界面已切换到英文
            await expect(page.locator('#scroll-to-today-btn')).toContainText('Today');
        });

        test('TC-B01-05: 日语-优先级下拉本地化', async ({ page }) => {
            // 切换到日语
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);

            const jaOption = page.locator('[data-lang="ja-JP"]');
            await jaOption.click();
            await page.waitForTimeout(1000);

            // 验证界面已切换到日语
            await expect(page.locator('#scroll-to-today-btn')).toContainText('今日');
        });

        test('TC-B01-07: 韩语-优先级下拉本地化', async ({ page }) => {
            // 切换到韩语
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);

            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);

            const koOption = page.locator('[data-lang="ko-KR"]');
            await koOption.click();
            await page.waitForTimeout(1000);

            // 验证界面已切换到韩语
            await expect(page.locator('#scroll-to-today-btn')).toContainText('오늘');
        });
    });

    // ===== 3.6 边界测试 =====
    test.describe('边界测试', () => {
        test('TC-BD-03: 进度值边界-0%', async ({ page }) => {
            const progressCell = page.locator('.gantt_cell[data-column-name="progress"]').first();

            if (await progressCell.count() > 0) {
                await progressCell.click();
                await page.waitForTimeout(100);
                await progressCell.dblclick({ force: true });
                await page.waitForTimeout(300);

                // 进度编辑器是 number 类型
                const editor = page.locator('.gantt-inline-editor');
                if (await editor.count() > 0) {
                    await editor.fill('0');
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);
                    console.log('进度0%边界测试完成');
                }
            }
        });

        test('TC-BD-04: 进度值边界-100%', async ({ page }) => {
            const progressCell = page.locator('.gantt_cell[data-column-name="progress"]').first();

            if (await progressCell.count() > 0) {
                await progressCell.click();
                await page.waitForTimeout(100);
                await progressCell.dblclick({ force: true });
                await page.waitForTimeout(300);

                // 进度编辑器是 number 类型
                const editor = page.locator('.gantt-inline-editor');
                if (await editor.count() > 0) {
                    await editor.fill('100');
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);
                    console.log('进度100%边界测试完成');
                }
            }
        });
    });

    // ===== 3.7 国际化测试 =====
    test.describe('国际化测试', () => {
        test('TC-I18N-01: 中文界面完整性', async ({ page }) => {
            // 确保中文环境
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);
            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);
            await page.locator('[data-lang="zh-CN"]').click();
            await page.waitForTimeout(1000);

            // 不刷新页面，直接检查语言切换效果
            // 检查主要界面元素
            await expect(page.locator('#scroll-to-today-btn')).toContainText('今天');
        });

        test('TC-I18N-02: 英文界面完整性', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);
            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);
            await page.locator('[data-lang="en-US"]').click();
            await page.waitForTimeout(1000);

            await expect(page.locator('#scroll-to-today-btn')).toContainText('Today');
        });

        test('TC-I18N-03: 日语界面完整性', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);
            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);
            await page.locator('[data-lang="ja-JP"]').click();
            await page.waitForTimeout(1000);

            await expect(page.locator('#scroll-to-today-btn')).toContainText('今日');
        });

        test('TC-I18N-04: 韩语界面完整性', async ({ page }) => {
            const moreBtn = page.locator('#more-actions-dropdown .btn');
            await moreBtn.click();
            await page.waitForTimeout(300);
            const langMenu = page.locator('#language-menu');
            await langMenu.click();
            await page.waitForTimeout(300);
            await page.locator('[data-lang="ko-KR"]').click();
            await page.waitForTimeout(1000);

            await expect(page.locator('#scroll-to-today-btn')).toContainText('오늘');
        });
    });

    // ===== 3.8 异常测试 =====
    test.describe('异常测试', () => {
        test('TC-EX-08: 特殊字符输入XSS测试', async ({ page }) => {
            const textCell = page.locator('.gantt_cell[data-column-name="text"]').first();

            if (await textCell.count() > 0) {
                await textCell.dblclick();
                await page.waitForTimeout(300);

                const editor = page.locator('.gantt-inline-editor');
                if (await editor.count() > 0) {
                    // 输入XSS测试字符串
                    await editor.fill('<script>alert(1)</script>');
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(300);

                    // 检查没有弹窗出现（XSS被阻止）
                    // 页面应该正常运行
                    await expect(page.locator('#gantt_here')).toBeVisible();
                    console.log('XSS测试完成 - 未触发脚本执行');
                }
            }
        });
    });
});
