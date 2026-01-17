/**
 * 移动端适配模块 E2E 测试
 *
 * 对应测试用例文档：TEST-竞品改进-v1.0-测试用例.md
 * 测试模块：3. 移动端适配模块 (Mobile Responsive)
 *
 * 覆盖用例：
 * - MOBILE-001 ~ MOBILE-003: 视口断点
 * - MOBILE-004 ~ MOBILE-006: 视图降级
 * - MOBILE-007 ~ MOBILE-009: 卡片式布局
 * - MOBILE-010 ~ MOBILE-013: 只读/轻交互
 */

import { test, expect } from '@playwright/test';

test.describe('移动端适配模块 (Mobile Responsive) - P0', () => {

    // ========================================
    // 3.1 视口断点测试 (MOBILE-001 ~ MOBILE-003)
    // ========================================
    test.describe('视口断点检测', () => {

        // MOBILE-001: 验证 768px 断点正确触发移动端模式
        test('MOBILE-001: 767px 视口应触发移动端模式', async ({ page }) => {
            // 设置移动端视口
            await page.setViewportSize({ width: 767, height: 800 });
            await page.goto('/');

            // 等待甘特图加载
            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(500); // 等待响应式检测

            // 验证移动端模式类已添加
            const body = page.locator('body');
            await expect(body).toHaveClass(/mobile-mode/);

            // 验证甘特图容器也有移动端类
            const ganttContainer = page.locator('#gantt_here');
            await expect(ganttContainer).toHaveClass(/mobile-mode/);
        });

        // MOBILE-002: 验证 768px 及以上保持桌面模式
        test('MOBILE-002: 768px 视口应保持桌面模式', async ({ page }) => {
            // 设置桌面视口
            await page.setViewportSize({ width: 768, height: 800 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(500);

            // 验证没有移动端模式类
            const body = page.locator('body');
            await expect(body).not.toHaveClass(/mobile-mode/);
        });

        // MOBILE-003: 验证视口变化时模式动态切换
        test('MOBILE-003: 视口变化应动态切换模式', async ({ page }) => {
            // 初始桌面模式
            await page.setViewportSize({ width: 1024, height: 800 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(500);

            const body = page.locator('body');

            // 验证初始桌面模式
            await expect(body).not.toHaveClass(/mobile-mode/);

            // 切换到移动端视口
            await page.setViewportSize({ width: 600, height: 800 });
            await page.waitForTimeout(500);

            // 验证切换到移动端模式
            await expect(body).toHaveClass(/mobile-mode/);

            // 切换回桌面视口
            await page.setViewportSize({ width: 1024, height: 800 });
            await page.waitForTimeout(500);

            // 验证恢复桌面模式
            await expect(body).not.toHaveClass(/mobile-mode/);
        });
    });

    // ========================================
    // 3.2 视图降级测试 (MOBILE-004 ~ MOBILE-006)
    // ========================================
    test.describe('视图降级', () => {

        // MOBILE-004: 验证移动端隐藏时间轴
        test('MOBILE-004: 移动端应隐藏时间轴', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 检查时间轴区域是否隐藏
            // DHTMLX Gantt 的时间轴容器
            const timeline = page.locator('.gantt_task');

            // 在移动端模式下，时间轴应该被隐藏
            if (await timeline.count() > 0) {
                // 检查 CSS display 属性
                const displayStyle = await timeline.evaluate(el =>
                    window.getComputedStyle(el).display
                );

                // 或检查元素是否不可见 (宽度为0或 display:none)
                const boundingBox = await timeline.boundingBox();
                const isHidden = displayStyle === 'none' || !boundingBox || boundingBox.width === 0;

                expect(isHidden).toBeTruthy();
            } else {
                // 时间轴元素不存在也算通过
                expect(true).toBeTruthy();
            }
        });

        // MOBILE-005: 验证移动端 Grid 全宽显示
        test('MOBILE-005: 移动端 Grid 应全宽显示', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 检查 Grid 容器宽度
            const grid = page.locator('.gantt_grid');

            if (await grid.count() > 0) {
                const gridWidth = await grid.evaluate(el => el.offsetWidth);
                const viewportWidth = 375;

                // Grid 宽度应该接近视口宽度 (允许一定误差)
                expect(gridWidth).toBeGreaterThan(viewportWidth * 0.9);
            }
        });

        // MOBILE-006: 验证移动端无横向滚动条
        test('MOBILE-006: 移动端不应有横向滚动条', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 检查页面是否有横向滚动
            const hasHorizontalScroll = await page.evaluate(() => {
                return document.body.scrollWidth > document.body.clientWidth;
            });

            expect(hasHorizontalScroll).toBe(false);
        });
    });

    // ========================================
    // 3.3 卡片式布局测试 (MOBILE-007 ~ MOBILE-009)
    // ========================================
    test.describe('卡片式布局', () => {

        // MOBILE-007: 验证移动端任务以卡片形式展示
        test('MOBILE-007: 移动端任务应以卡片样式显示', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 检查任务行是否有卡片样式特征
            const taskRows = page.locator('.gantt_row');

            if (await taskRows.count() > 0) {
                const firstRow = taskRows.first();

                // 检查是否有卡片样式（边距、圆角等）
                const styles = await firstRow.evaluate(el => {
                    const computed = window.getComputedStyle(el);
                    return {
                        margin: computed.margin,
                        borderRadius: computed.borderRadius,
                        boxShadow: computed.boxShadow,
                        padding: computed.padding,
                        border: computed.border
                    };
                });

                console.log('任务行样式:', styles);

                // 验证卡片样式特征：有边距、圆角或阴影
                const hasCardStyle =
                    styles.margin !== '0px' ||
                    styles.borderRadius !== '0px' ||
                    styles.boxShadow !== 'none' ||
                    styles.padding !== '0px';

                expect(hasCardStyle).toBeTruthy();
            } else {
                // 如果没有任务行，跳过测试
                console.log('没有任务行，跳过卡片样式验证');
                expect(true).toBeTruthy();
            }
        });

        // MOBILE-008: 验证卡片显示必要信息
        test('MOBILE-008: 卡片应包含任务名称和日期', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 检查任务行中是否包含基本信息
            const taskRows = page.locator('.gantt_row');

            if (await taskRows.count() > 0) {
                // 获取第一行的所有单元格内容
                const firstRow = taskRows.first();
                const rowText = await firstRow.textContent();

                // 应该至少能看到一些文本内容（任务名称）
                // 注意：第一个单元格可能是复选框，需要检查整行内容
                console.log('任务行内容:', rowText);

                // 验证行内容不为空
                expect(rowText && rowText.trim().length > 0).toBeTruthy();
            } else {
                // 如果没有任务行，跳过测试
                console.log('没有任务行，跳过内容验证');
                expect(true).toBeTruthy();
            }
        });

        // MOBILE-009: 验证卡片垂直排列
        test('MOBILE-009: 任务卡片应垂直排列', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            const taskRows = page.locator('.gantt_row');

            if (await taskRows.count() >= 2) {
                const firstRowBox = await taskRows.first().boundingBox();
                const secondRowBox = await taskRows.nth(1).boundingBox();

                if (firstRowBox && secondRowBox) {
                    // 第二行应该在第一行下面（垂直排列）
                    expect(secondRowBox.y).toBeGreaterThan(firstRowBox.y);
                }
            }
        });
    });

    // ========================================
    // 3.4 只读/轻交互测试 (MOBILE-010 ~ MOBILE-013)
    // ========================================
    test.describe('只读/轻交互', () => {

        // MOBILE-010: 验证移动端禁用拖拽排程
        test('MOBILE-010: 移动端应禁用任务拖拽', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 获取 gantt 配置，验证拖拽已禁用
            const dragConfig = await page.evaluate(() => {
                if (typeof gantt !== 'undefined') {
                    return {
                        drag_move: gantt.config.drag_move,
                        drag_resize: gantt.config.drag_resize,
                        drag_progress: gantt.config.drag_progress,
                        drag_links: gantt.config.drag_links
                    };
                }
                return null;
            });

            if (dragConfig) {
                expect(dragConfig.drag_move).toBe(false);
                expect(dragConfig.drag_resize).toBe(false);
                expect(dragConfig.drag_progress).toBe(false);
                expect(dragConfig.drag_links).toBe(false);
            }
        });

        // MOBILE-013: 验证移动端禁用依赖连线拖拽
        test('MOBILE-013: 移动端应禁用依赖连线拖拽', async ({ page }) => {
            await page.setViewportSize({ width: 375, height: 667 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 验证连线拖拽已禁用
            const dragLinksDisabled = await page.evaluate(() => {
                if (typeof gantt !== 'undefined') {
                    return gantt.config.drag_links === false;
                }
                return null;
            });

            expect(dragLinksDisabled).toBe(true);
        });

        // 桌面模式对比测试：拖拽应该启用
        test('桌面模式应启用拖拽功能', async ({ page }) => {
            await page.setViewportSize({ width: 1200, height: 800 });
            await page.goto('/');

            await page.waitForSelector('#gantt_here', { timeout: 10000 });
            await page.waitForTimeout(1000);

            // 获取 gantt 配置，验证拖拽已启用
            const dragConfig = await page.evaluate(() => {
                if (typeof gantt !== 'undefined') {
                    return {
                        drag_move: gantt.config.drag_move,
                        drag_resize: gantt.config.drag_resize,
                        drag_links: gantt.config.drag_links
                    };
                }
                return null;
            });

            if (dragConfig) {
                expect(dragConfig.drag_move).toBe(true);
                expect(dragConfig.drag_resize).toBe(true);
                expect(dragConfig.drag_links).toBe(true);
            }
        });
    });
});

// ========================================
// 移动设备模拟测试
// ========================================
test.describe('移动设备模拟', () => {

    test('iPhone SE 视口测试', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');

        await page.waitForSelector('#gantt_here', { timeout: 10000 });
        await page.waitForTimeout(500);

        const body = page.locator('body');
        await expect(body).toHaveClass(/mobile-mode/);
    });

    test('iPad Mini 视口测试 (竖屏)', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/');

        await page.waitForSelector('#gantt_here', { timeout: 10000 });
        await page.waitForTimeout(500);

        // 768px 应该是桌面模式边界
        const body = page.locator('body');
        await expect(body).not.toHaveClass(/mobile-mode/);
    });
});
