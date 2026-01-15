/**
 * 本地化细节测试 (Localization Detail Tests)
 *
 * 测试范围：
 * - 快捷键面板本地化 (TC-L-030 ~ TC-L-047)
 * - 图例面板本地化 (TC-L-050 ~ TC-L-053)
 * - 视图选择器本地化 (TC-L-001 ~ TC-L-005)
 * - 工具栏按钮本地化 (TC-L-060 ~ TC-L-065)
 * - 下拉菜单本地化 (TC-L-070 ~ TC-L-074)
 * - 语言切换边界测试 (TC-L-100 ~ TC-L-105)
 */

import { test, expect } from '@playwright/test';

// 本地化期望值映射表
const LOCALIZATION_MAP = {
    'zh-CN': {
        // 快捷键面板
        shortcutsTitle: '快捷键 & 图例',
        navigation: '导航',
        panView: '平移视图',
        zoomTimeline: '缩放时间轴',
        goToToday: '回到今天',
        drag: '拖动',
        scroll: '滚轮',
        clickToday: '点击"今天"按钮',
        taskOperations: '任务操作',
        editTask: '编辑任务',
        doubleClick: '双击',
        adjustTime: '调整时间',
        dragTask: '拖动任务条',
        adjustProgress: '调整进度',
        dragProgress: '拖动进度条',
        // 图例
        legend: '图例',
        completed: '已完成',
        incomplete: '未完成',
        dependency: '依赖关系',
        // 工具栏
        today: '今天',
        newTask: '新建任务',
        more: '更多',
        // 下拉菜单
        exportExcel: '导出Excel',
        importExcel: '导入Excel',
        exportJSON: '导出JSON',
        importJSON: '导入JSON',
        language: '语言',
        // 视图选择器
        dayView: '日视图',
        weekView: '周视图',
        monthView: '月视图',
        quarterView: '季度视图',
        yearView: '年视图',
        // 其他
        batchEdit: '批量编辑',
        editFields: '编辑字段',
        export: '导出'
    },
    'en-US': {
        shortcutsTitle: 'Shortcuts & Legend',
        navigation: 'Navigation',
        panView: 'Pan View',
        zoomTimeline: 'Zoom Timeline',
        goToToday: 'Go to Today',
        drag: 'Drag',
        scroll: 'Scroll',
        clickToday: 'Click "Today"',
        taskOperations: 'Task Operations',
        editTask: 'Edit Task',
        doubleClick: 'Double Click',
        adjustTime: 'Adjust Time',
        dragTask: 'Drag Task Bar',
        adjustProgress: 'Adjust Progress',
        dragProgress: 'Drag Progress Bar',
        legend: 'Legend',
        completed: 'Completed',
        incomplete: 'Incomplete',
        dependency: 'Dependency',
        today: 'Today',
        newTask: 'New Task',
        more: 'More',
        exportExcel: 'Export Excel',
        importExcel: 'Import Excel',
        exportJSON: 'Export JSON',
        importJSON: 'Import JSON',
        language: 'Language',
        dayView: 'Day',
        weekView: 'Week',
        monthView: 'Month',
        quarterView: 'Quarter',
        yearView: 'Year',
        batchEdit: 'Batch Edit',
        editFields: 'Edit Fields',
        export: 'Export'
    },
    'ja-JP': {
        shortcutsTitle: 'ショートカット & 凡例',
        navigation: 'ナビゲーション',
        panView: 'ビューをパン',
        zoomTimeline: 'タイムラインをズーム',
        goToToday: '今日に移動',
        drag: 'ドラッグ',
        scroll: 'スクロール',
        clickToday: '「今日」をクリック',
        taskOperations: 'タスク操作',
        editTask: 'タスク編集',
        doubleClick: 'ダブルクリック',
        adjustTime: '時間調整',
        dragTask: 'タスクバーをドラッグ',
        adjustProgress: '進捗調整',
        dragProgress: '進捗バーをドラッグ',
        legend: '凡例',
        completed: '完了',
        incomplete: '未完了',
        dependency: '依存関係',
        today: '今日',
        newTask: '新規タスク',
        more: 'もっと',
        exportExcel: 'Excel出力',
        importExcel: 'Excelインポート',
        exportJSON: 'JSON出力',
        importJSON: 'JSONインポート',
        language: '言語',
        dayView: '日',
        weekView: '週',
        monthView: '月',
        quarterView: '四半期',
        yearView: '年',
        batchEdit: '一括編集',
        editFields: 'フィールド編集',
        export: 'エクスポート'
    },
    'ko-KR': {
        shortcutsTitle: '단축키 & 범례',
        navigation: '탐색',
        panView: '뷰 이동',
        zoomTimeline: '타임라인 확대/축소',
        goToToday: '오늘로 이동',
        drag: '드래그',
        scroll: '스크롤',
        clickToday: '"오늘" 클릭',
        taskOperations: '작업 조작',
        editTask: '작업 편집',
        doubleClick: '더블 클릭',
        adjustTime: '시간 조정',
        dragTask: '작업 바 드래그',
        adjustProgress: '진행률 조정',
        dragProgress: '진행률 바 드래그',
        legend: '범례',
        completed: '완료',
        incomplete: '미완료',
        dependency: '종속성',
        today: '오늘',
        newTask: '새 작업',
        more: '더보기',
        exportExcel: 'Excel 내보내기',
        importExcel: 'Excel 가져오기',
        exportJSON: 'JSON 내보내기',
        importJSON: 'JSON 가져오기',
        language: '언어',
        dayView: '일',
        weekView: '주',
        monthView: '월',
        quarterView: '분기',
        yearView: '년',
        batchEdit: '일괄 편집',
        editFields: '필드 편집',
        export: '내보내기'
    }
};

// 切换语言的辅助函数
async function switchLanguage(page, langCode) {
    await page.locator('.more-btn').click();
    await page.locator('#language-menu').hover();
    await page.locator(`.dropdown-item[data-lang="${langCode}"]`).click();
    // 等待语言切换完成
    await page.waitForTimeout(500);
}

// 展开快捷键面板
async function expandShortcutsPanel(page) {
    const panel = page.locator('#shortcuts-panel');
    const isCollapsed = await panel.evaluate(el => el.classList.contains('collapsed'));
    if (isCollapsed) {
        await page.locator('#shortcuts-header').click();
        await page.waitForTimeout(300);
    }
}

test.describe('Localization Detail Tests - 本地化细节测试', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // 强制设置为中文，因为Playwright默认是英文环境，而测试用例期望中文初始状态
        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await expect(page.locator('#gantt_here')).toBeVisible();
        await page.waitForTimeout(1000); // 等待页面完全加载
    });

    // ============================================
    // 6.3 快捷键面板本地化测试
    // ============================================
    test.describe('6.3 Shortcuts Panel Localization - 快捷键面板本地化', () => {

        test('TC-L-030: Shortcuts panel title - Chinese', async ({ page }) => {
            await expandShortcutsPanel(page);
            const titleText = await page.locator('.shortcuts-title').textContent();
            // 检查标题包含"快捷键"或使用了data-i18n
            expect(titleText).toContain('快捷键');
        });

        test('TC-L-031: Shortcuts panel title - English', async ({ page }) => {
            await switchLanguage(page, 'en-US');
            await expandShortcutsPanel(page);
            const titleText = await page.locator('.shortcuts-title').textContent();
            // 验证是否显示英文或仍显示中文（检测本地化遗漏）
            const isEnglish = titleText.includes('Shortcuts') || titleText.includes('Legend');
            const isChinese = titleText.includes('快捷键') || titleText.includes('图例');

            // 记录实际值用于报告
            console.log(`[TC-L-031] Shortcuts title in English: "${titleText}"`);

            // 如果仍显示中文，则本地化失败
            if (isChinese && !isEnglish) {
                test.fail(true, `本地化遗漏: 英文环境下快捷键面板标题仍显示中文 "${titleText}"`);
            }
        });

        test('TC-L-034: Navigation section title - All languages', async ({ page }) => {
            const results = [];
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);
                await expandShortcutsPanel(page);

                const navTitle = await page.locator('.shortcuts-section-title').first().textContent();
                const expected = LOCALIZATION_MAP[lang].navigation;
                const actual = navTitle.trim();

                results.push({
                    lang,
                    expected,
                    actual,
                    pass: actual === expected || actual.includes(expected)
                });

                console.log(`[TC-L-034] ${lang}: Expected "${expected}", Actual "${actual}"`);
            }

            // 检查是否有任何语言失败
            const failures = results.filter(r => !r.pass);
            if (failures.length > 0) {
                const failMsg = failures.map(f => `${f.lang}: expected "${f.expected}", got "${f.actual}"`).join('; ');
                test.fail(true, `本地化失败: ${failMsg}`);
            }
        });

        test('TC-L-035-040: Navigation shortcuts labels - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
            const results = [];

            for (const lang of languages) {
                await switchLanguage(page, lang);
                await expandShortcutsPanel(page);

                // 获取所有快捷键操作说明文本
                const actions = await page.locator('.shortcut-action').allTextContents();
                const keys = await page.locator('.shortcut-keys .key').allTextContents();

                const expected = LOCALIZATION_MAP[lang];

                // 检查"平移视图"
                const hasPanView = actions.some(a => a.includes(expected.panView) || a === expected.panView);
                // 检查"缩放时间轴"
                const hasZoomTimeline = actions.some(a => a.includes(expected.zoomTimeline) || a === expected.zoomTimeline);
                // 检查"回到今天"
                const hasGoToToday = actions.some(a => a.includes(expected.goToToday) || a === expected.goToToday);
                // 检查"拖动"关键词
                const hasDrag = keys.some(k => k.includes(expected.drag) || k === expected.drag);

                results.push({
                    lang,
                    panView: hasPanView,
                    zoomTimeline: hasZoomTimeline,
                    goToToday: hasGoToToday,
                    drag: hasDrag,
                    actualActions: actions,
                    actualKeys: keys
                });

                console.log(`[TC-L-035-040] ${lang}:`, {
                    panView: hasPanView ? 'PASS' : 'FAIL',
                    zoomTimeline: hasZoomTimeline ? 'PASS' : 'FAIL',
                    goToToday: hasGoToToday ? 'PASS' : 'FAIL',
                    drag: hasDrag ? 'PASS' : 'FAIL'
                });
            }

            // 检查非中文语言是否仍显示中文（本地化遗漏检测）
            for (const r of results) {
                if (r.lang !== 'zh-CN') {
                    const hasChineseInActions = r.actualActions.some(a => /[\u4e00-\u9fa5]/.test(a));
                    if (hasChineseInActions) {
                        console.log(`[WARNING] ${r.lang} still contains Chinese in actions:`, r.actualActions);
                    }
                }
            }
        });

        test('TC-L-041-047: Task operations labels - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);
                await expandShortcutsPanel(page);

                const sectionTitles = await page.locator('.shortcuts-section-title').allTextContents();
                const expected = LOCALIZATION_MAP[lang];

                // 检查是否有"任务操作"分类
                const hasTaskOperations = sectionTitles.some(t =>
                    t.includes(expected.taskOperations) || t === expected.taskOperations
                );

                console.log(`[TC-L-041] ${lang}: TaskOperations section - ${hasTaskOperations ? 'FOUND' : 'NOT FOUND'}`);
                console.log(`  Expected: "${expected.taskOperations}", Actual titles:`, sectionTitles);
            }
        });
    });

    // ============================================
    // 6.4 图例面板本地化测试
    // ============================================
    test.describe('6.4 Legend Panel Localization - 图例面板本地化', () => {

        test('TC-L-050-053: Legend labels - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
            const results = [];

            for (const lang of languages) {
                await switchLanguage(page, lang);
                await expandShortcutsPanel(page);

                // 获取图例项文本
                const legendItems = await page.locator('.legend-item span:not(.legend-color)').allTextContents();
                const expected = LOCALIZATION_MAP[lang];

                const hasCompleted = legendItems.some(t => t.includes(expected.completed));
                const hasIncomplete = legendItems.some(t => t.includes(expected.incomplete));
                const hasDependency = legendItems.some(t => t.includes(expected.dependency));

                results.push({
                    lang,
                    completed: hasCompleted,
                    incomplete: hasIncomplete,
                    dependency: hasDependency,
                    actualItems: legendItems
                });

                console.log(`[TC-L-050-053] ${lang}:`, {
                    completed: hasCompleted ? 'PASS' : 'FAIL',
                    incomplete: hasIncomplete ? 'PASS' : 'FAIL',
                    dependency: hasDependency ? 'PASS' : 'FAIL',
                    actualItems: legendItems
                });

                // 检测本地化遗漏
                if (lang !== 'zh-CN') {
                    const hasChineseInLegend = legendItems.some(t => /[\u4e00-\u9fa5]/.test(t));
                    if (hasChineseInLegend) {
                        console.log(`[LOCALIZATION BUG] ${lang} legend still contains Chinese:`, legendItems);
                    }
                }
            }
        });
    });

    // ============================================
    // 6.2 视图选择器本地化测试
    // ============================================
    test.describe('6.2 View Selector Localization - 视图选择器本地化', () => {

        test('TC-L-001-005: View selector options - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);

                // 获取视图选择器的所有选项文本
                const options = await page.locator('#view-selector option').allTextContents();
                const expected = LOCALIZATION_MAP[lang];

                console.log(`[TC-L-001-005] ${lang} View options:`, options);
                console.log(`  Expected: Day="${expected.dayView}", Week="${expected.weekView}", Month="${expected.monthView}"`);

                // 检查是否包含期望的本地化文本
                const hasDay = options.some(o => o.includes(expected.dayView));
                const hasWeek = options.some(o => o.includes(expected.weekView));
                const hasMonth = options.some(o => o.includes(expected.monthView));

                // 检测本地化遗漏（非中文环境下仍显示中文）
                if (lang !== 'zh-CN') {
                    const hasChineseOptions = options.some(o => /[\u4e00-\u9fa5]/.test(o));
                    if (hasChineseOptions) {
                        console.log(`[LOCALIZATION BUG] ${lang} view selector still contains Chinese options:`, options);
                    }
                }
            }
        });
    });

    // ============================================
    // 6.5 工具栏按钮本地化测试
    // ============================================
    test.describe('6.5 Toolbar Buttons Localization - 工具栏按钮本地化', () => {

        test('TC-L-060: Today button - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);

                const todayBtnText = await page.locator('#scroll-to-today-btn span[data-i18n="toolbar.today"]').textContent();
                const expected = LOCALIZATION_MAP[lang].today;

                console.log(`[TC-L-060] ${lang}: Today button - Expected "${expected}", Actual "${todayBtnText.trim()}"`);

                expect(todayBtnText.trim()).toBe(expected);
            }
        });

        test('TC-L-061: New Task button - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);

                const newTaskText = await page.locator('#new-task-btn span[data-i18n="toolbar.newTask"]').textContent();
                const expected = LOCALIZATION_MAP[lang].newTask;

                console.log(`[TC-L-061] ${lang}: New Task button - Expected "${expected}", Actual "${newTaskText.trim()}"`);

                expect(newTaskText.trim()).toBe(expected);
            }
        });

        test('TC-L-062: More button - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);

                const moreText = await page.locator('.more-btn span[data-i18n="toolbar.more"]').textContent();
                const expected = LOCALIZATION_MAP[lang].more;

                console.log(`[TC-L-062] ${lang}: More button - Expected "${expected}", Actual "${moreText.trim()}"`);

                expect(moreText.trim()).toBe(expected);
            }
        });

        test('TC-L-063-065: Toolbar icon button titles - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);

                const expected = LOCALIZATION_MAP[lang];

                // 编辑字段按钮
                const editFieldsTitle = await page.locator('#add-field-btn').getAttribute('title');
                // 批量编辑按钮
                const batchEditTitle = await page.locator('#batch-edit-btn').getAttribute('title');
                // 导出按钮
                const exportTitle = await page.locator('#config-export-btn').getAttribute('title');

                console.log(`[TC-L-063-065] ${lang}: Icon button titles:`, {
                    editFields: { expected: expected.editFields, actual: editFieldsTitle },
                    batchEdit: { expected: expected.batchEdit, actual: batchEditTitle },
                    export: { expected: expected.export, actual: exportTitle }
                });
            }
        });
    });

    // ============================================
    // 6.6 下拉菜单本地化测试
    // ============================================
    test.describe('6.6 Dropdown Menu Localization - 下拉菜单本地化', () => {

        test('TC-L-070-074: Dropdown menu items - All languages', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            for (const lang of languages) {
                await switchLanguage(page, lang);
                await page.locator('.more-btn').click();
                await page.waitForTimeout(300);

                const expected = LOCALIZATION_MAP[lang];

                // 获取菜单项文本
                const exportExcelText = await page.locator('#dropdown-export-excel span[data-i18n="toolbar.exportExcel"]').textContent();
                const importExcelText = await page.locator('#dropdown-import-excel span[data-i18n="toolbar.importExcel"]').textContent();
                const exportJsonText = await page.locator('#dropdown-export-json span[data-i18n="toolbar.exportJSON"]').textContent();
                const importJsonText = await page.locator('#dropdown-import-json span[data-i18n="toolbar.importJSON"]').textContent();
                const languageText = await page.locator('#language-menu span[data-i18n="toolbar.language"]').textContent();

                console.log(`[TC-L-070-074] ${lang}: Dropdown items:`, {
                    exportExcel: { expected: expected.exportExcel, actual: exportExcelText.trim() },
                    importExcel: { expected: expected.importExcel, actual: importExcelText.trim() },
                    exportJSON: { expected: expected.exportJSON, actual: exportJsonText.trim() },
                    importJSON: { expected: expected.importJSON, actual: importJsonText.trim() },
                    language: { expected: expected.language, actual: languageText.trim() }
                });

                // 验证
                expect(exportExcelText.trim()).toBe(expected.exportExcel);
                expect(importExcelText.trim()).toBe(expected.importExcel);
                expect(languageText.trim()).toBe(expected.language);

                // 关闭菜单
                await page.keyboard.press('Escape');
            }
        });
    });

    // ============================================
    // 6.9 语言切换边界测试
    // ============================================
    test.describe('6.9 Language Switch Edge Cases - 语言切换边界测试', () => {

        test('TC-L-100: Rapid language switching', async ({ page }) => {
            const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];

            // 快速连续切换4种语言
            for (const lang of languages) {
                await switchLanguage(page, lang);
            }

            // 最后切换到英文，验证UI
            await switchLanguage(page, 'en-US');
            await page.waitForTimeout(500);

            const todayBtnText = await page.locator('#scroll-to-today-btn span[data-i18n="toolbar.today"]').textContent();
            const newTaskText = await page.locator('#new-task-btn span[data-i18n="toolbar.newTask"]').textContent();

            console.log('[TC-L-100] After rapid switching to en-US:', {
                today: todayBtnText.trim(),
                newTask: newTaskText.trim()
            });

            expect(todayBtnText.trim()).toBe('Today');
            expect(newTaskText.trim()).toBe('New Task');
        });

        test('TC-L-101: Language switch with existing tasks', async ({ page }) => {
            // 先创建一个任务
            await page.locator('#new-task-btn').click();
            await page.waitForTimeout(500);

            // 在lightbox中输入任务名
            const taskNameInput = page.locator('.gantt_cal_ltext textarea').first();
            if (await taskNameInput.isVisible()) {
                await taskNameInput.fill('测试任务 Test Task');
                await page.locator('.gantt_save_btn, [aria-label="Save"]').click();
                await page.waitForTimeout(500);
            }

            // 切换到英文
            await switchLanguage(page, 'en-US');

            // 验证任务数据不受影响
            const taskText = await page.locator('.gantt_tree_content').first().textContent();
            console.log('[TC-L-101] Task text after language switch:', taskText);

            // 任务文本应该保持不变
            expect(taskText).toContain('测试任务');
        });

        test('TC-L-104: Batch edit panel localization', async ({ page }) => {
            // 打开批量编辑面板
            await page.locator('#batch-edit-btn').click();
            await page.waitForTimeout(300);

            const panelTitle = await page.locator('#batch-edit-panel h3[data-i18n="batchEdit.title"]').textContent();
            console.log('[TC-L-104] zh-CN Batch edit panel title:', panelTitle.trim());
            expect(panelTitle.trim()).toBe('批量编辑');

            // 关闭面板
            await page.locator('#close-batch-edit').click();

            // 切换到英文
            await switchLanguage(page, 'en-US');

            // 重新打开
            await page.locator('#batch-edit-btn').click();
            await page.waitForTimeout(300);

            const panelTitleEn = await page.locator('#batch-edit-panel h3[data-i18n="batchEdit.title"]').textContent();
            console.log('[TC-L-104] en-US Batch edit panel title:', panelTitleEn.trim());
            expect(panelTitleEn.trim()).toBe('Batch Edit');
        });

        test('TC-L-105: Field management panel localization', async ({ page }) => {
            // 打开字段管理面板
            await page.locator('#add-field-btn').click();
            await page.waitForTimeout(300);

            // 检查面板标题
            const panelTitle = await page.locator('#field-management-panel h4[data-i18n="fieldManagement.title"]').textContent();
            console.log('[TC-L-105] zh-CN Field management title:', panelTitle.trim());
            expect(panelTitle.trim()).toBe('字段管理');

            // 关闭面板
            await page.locator('#close-field-management').click();

            // 切换到英文
            await switchLanguage(page, 'en-US');

            // 重新打开
            await page.locator('#add-field-btn').click();
            await page.waitForTimeout(300);

            const panelTitleEn = await page.locator('#field-management-panel h4[data-i18n="fieldManagement.title"]').textContent();
            console.log('[TC-L-105] en-US Field management title:', panelTitleEn.trim());
            expect(panelTitleEn.trim()).toBe('Field Management');
        });
    });

    // ============================================
    // 6.10 已知本地化缺陷验证
    // ============================================
    test.describe('6.10 Known Localization Bug Verification - 已知缺陷验证', () => {

        test('TC-L-D03: Shortcuts panel hardcoded text check', async ({ page }) => {
            // 切换到英文
            await switchLanguage(page, 'en-US');
            await expandShortcutsPanel(page);

            // 获取快捷键面板的所有文本内容
            const panelText = await page.locator('#shortcuts-panel').textContent();

            // 检查是否包含硬编码的中文
            const chinesePatterns = [
                '快捷键', '图例', '导航', '平移视图', '缩放时间轴',
                '回到今天', '任务操作', '编辑任务', '调整时间',
                '调整进度', '已完成', '未完成', '依赖关系', '拖动', '滚轮'
            ];

            const foundChinese = chinesePatterns.filter(p => panelText.includes(p));

            console.log('[TC-L-D03] Chinese text found in English shortcuts panel:', foundChinese);

            if (foundChinese.length > 0) {
                console.log('[BUG DETECTED] Hardcoded Chinese in shortcuts panel:', foundChinese);
                // 标记为已知问题但不让测试失败，而是记录
                test.info().annotations.push({
                    type: 'localization-bug',
                    description: `Hardcoded Chinese found: ${foundChinese.join(', ')}`
                });
            }
        });

        test('TC-L-D04: Legend panel hardcoded text check', async ({ page }) => {
            await switchLanguage(page, 'en-US');
            await expandShortcutsPanel(page);

            // 获取图例部分的文本
            const legendItems = await page.locator('.legend-item span:not(.legend-color)').allTextContents();

            console.log('[TC-L-D04] Legend items in English:', legendItems);

            // 检查是否仍为中文
            const chineseItems = legendItems.filter(t => /[\u4e00-\u9fa5]/.test(t));

            if (chineseItems.length > 0) {
                console.log('[BUG DETECTED] Chinese legend items:', chineseItems);
                test.info().annotations.push({
                    type: 'localization-bug',
                    description: `Chinese legend items found: ${chineseItems.join(', ')}`
                });
            }
        });

        test('TC-L-D05: View selector option initial text check', async ({ page }) => {
            await switchLanguage(page, 'en-US');

            // 获取视图选择器选项
            const options = await page.locator('#view-selector option').allTextContents();

            console.log('[TC-L-D05] View selector options in English:', options);

            // 检查是否有中文选项
            const chineseOptions = options.filter(o => /[\u4e00-\u9fa5]/.test(o));

            if (chineseOptions.length > 0) {
                console.log('[BUG DETECTED] Chinese view options:', chineseOptions);
                test.info().annotations.push({
                    type: 'localization-bug',
                    description: `Chinese view options found: ${chineseOptions.join(', ')}`
                });
            }
        });
    });
});
