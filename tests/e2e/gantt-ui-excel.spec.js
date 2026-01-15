import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const downloadPath = path.resolve(__dirname, 'downloads');

// 确保下载目录存在
if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true });
}

// 标准测试数据集
const standardTestData = {
    data: [
        {
            id: 1,
            text: "项目A - Project Alpha",
            start_date: "2023-06-01",
            duration: 10,
            progress: 0.3,
            priority: "high",
            status: "in_progress",
            assignee: "张三",
            open: true
        },
        {
            id: 2,
            text: "子任务1 - Subtask",
            start_date: "2023-06-01",
            duration: 5,
            progress: 0.5,
            priority: "medium",
            status: "in_progress",
            parent: 1
        },
        {
            id: 3,
            text: "孙任务α🎯",
            start_date: "2023-06-02",
            duration: 2,
            progress: 1.0,
            priority: "low",
            status: "completed",
            parent: 2
        },
        {
            id: 4,
            text: "独立任务",
            start_date: "2023-06-15",
            duration: 3,
            progress: 0,
            priority: "high",
            status: "pending"
        }
    ]
};

// 辅助函数：解析Excel文件
function parseExcelFile(filePath) {
    const data = fs.readFileSync(filePath);
    const wb = XLSX.read(data, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return {
        headers: XLSX.utils.sheet_to_json(ws, { header: 1 })[0],
        rows: XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1),
        json: XLSX.utils.sheet_to_json(ws)
    };
}

// 辅助函数：导入Excel文件
async function importExcelFile(page, filePath) {
    await page.click('#more-actions-dropdown .more-btn');
    const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.click('#dropdown-import-excel')
    ]);
    await fileChooser.setFiles(filePath);
    await page.waitForTimeout(2000);
}

// 辅助函数：导出Excel文件并返回路径
async function exportExcelFile(page, fileName) {
    const filePath = path.join(downloadPath, fileName);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#config-export-btn')
    ]);
    await download.saveAs(filePath);
    return filePath;
}

test.describe('Gantt Chart UI Tests', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-UI-001 & TC-UI-002: Zoom Controls & View Selector', async ({ page }) => {
        const zoomInBtn = page.locator('#zoom-in-btn');
        const zoomOutBtn = page.locator('#zoom-out-btn');
        const viewSelector = page.locator('#view-selector');

        await expect(zoomInBtn).toBeVisible();
        await expect(zoomOutBtn).toBeVisible();
        await expect(viewSelector).toBeVisible();
        await expect(viewSelector).toHaveValue('week');

        await zoomInBtn.click();
        await expect(viewSelector).toHaveValue('month');

        await viewSelector.selectOption('week');
        await zoomOutBtn.click();
        await expect(viewSelector).toHaveValue('day');
    });

    test('TC-UI-003: Today Button', async ({ page }) => {
        const todayBtn = page.locator('#scroll-to-today-btn');
        await expect(todayBtn).toBeVisible();
        await expect(todayBtn).toHaveClass(/today-btn-enhanced/);
    });

    test('TC-UI-004: View Selector Removed from Menu', async ({ page }) => {
        const oldSelector = page.locator('input[name="scale"]');
        await expect(oldSelector).toHaveCount(0);
    });
});

test.describe('Excel Export Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-EX-001: Export Structure Verification (English)', async ({ page }) => {
        // 设置英文环境
        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.waitForTimeout(500);

        // 准备测试数据
        await page.evaluate((testData) => {
            gantt.clearAll();
            gantt.parse(testData);
        }, standardTestData);

        // 导出
        const filePath = await exportExcelFile(page, 'export_en_structure.xlsx');

        // 验证文件结构
        const { headers } = parseExcelFile(filePath);
        console.log('English Headers:', headers);

        expect(headers[0]).toBe('Hierarchy');
        expect(headers).toContain('Task Name');
        expect(headers).toContain('Start Date');
        expect(headers).toContain('Duration (days)');
        expect(headers).toContain('Progress (%)');
        expect(headers).toContain('Priority');
        // 确认不包含内部字段
        expect(headers).not.toContain('Task ID');
        expect(headers).not.toContain('Parent ID');
    });

    test('TC-EX-002: Export Structure Verification (中文)', async ({ page }) => {
        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await page.waitForTimeout(500);

        await page.evaluate((testData) => {
            gantt.clearAll();
            gantt.parse(testData);
        }, standardTestData);

        const filePath = await exportExcelFile(page, 'export_zh_structure.xlsx');
        const { headers } = parseExcelFile(filePath);
        console.log('Chinese Headers:', headers);

        expect(headers[0]).toBe('层级');
        expect(headers).toContain('任务名称');
        expect(headers).toContain('开始时间');
        expect(headers).toContain('工期(天)');
        expect(headers).toContain('进度(%)');
        expect(headers).toContain('优先级');
    });

    test('TC-EX-003: Export Data Values Verification', async ({ page }) => {
        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await page.waitForTimeout(500);

        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [{
                    id: 1,
                    text: "测试任务",
                    start_date: "2023-05-15",
                    duration: 7,
                    progress: 0.5,
                    priority: "high",
                    status: "in_progress"
                }]
            });
        });

        const filePath = await exportExcelFile(page, 'export_values.xlsx');
        const { json } = parseExcelFile(filePath);
        console.log('Exported Data:', JSON.stringify(json, null, 2));

        const task = json[0];
        expect(task['任务名称']).toBe('测试任务');
        expect(task['进度(%)']).toBe(50); // 应该是50，不是0.5
        expect(task['优先级']).toBe('高'); // 本地化值
        expect(task['状态']).toBe('进行中'); // 本地化值
    });

    test('TC-EX-004: Export Hierarchy Verification', async ({ page }) => {
        await page.evaluate((testData) => {
            gantt.clearAll();
            gantt.parse(testData);
        }, standardTestData);

        const filePath = await exportExcelFile(page, 'export_hierarchy.xlsx');
        const { json, headers } = parseExcelFile(filePath);

        const hierarchyKey = headers[0]; // 层级列
        const hierarchies = json.map(row => row[hierarchyKey]);
        console.log('Hierarchies:', hierarchies);

        // 验证层级格式
        expect(hierarchies).toContain('1');     // 顶级任务
        expect(hierarchies).toContain('1.1');   // 二级任务
        expect(hierarchies).toContain('1.1.1'); // 三级任务
        expect(hierarchies).toContain('2');     // 另一个顶级任务
    });
});

test.describe('Excel Import Tests - Basic', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-IM-001: Same Language Round Trip Import', async ({ page }) => {
        await page.evaluate(() => window.i18n.setLanguage('en-US'));

        // 准备原始数据
        const originalData = {
            data: [
                { id: 1, text: "Parent Task", start_date: "2023-07-01", duration: 5, progress: 0.3, priority: "high", open: true },
                { id: 2, text: "Child Task", start_date: "2023-07-02", duration: 3, progress: 0.6, priority: "medium", parent: 1 }
            ]
        };

        await page.evaluate((data) => {
            gantt.clearAll();
            gantt.parse(data);
        }, originalData);

        // 导出
        const filePath = await exportExcelFile(page, 'roundtrip_en.xlsx');

        // 清空并导入
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        // 严格验证
        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Imported Tasks:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(2);

        const parent = tasks.find(t => t.text === "Parent Task");
        const child = tasks.find(t => t.text === "Child Task");

        expect(parent).toBeDefined();
        expect(child).toBeDefined();

        // 精确验证字段值
        expect(parent.duration).toBe(5);
        expect(Math.round(parent.progress * 100)).toBe(30);
        expect(parent.priority).toBe('high');

        expect(child.duration).toBe(3);
        expect(Math.round(child.progress * 100)).toBe(60);
        expect(child.priority).toBe('medium');
        expect(child.parent).toBe(parent.id);
    });

    test('TC-IM-002: Cross-Language Import (Zh -> En) Column Mapping', async ({ page }) => {
        // Step 1: 中文环境创建并导出
        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await page.waitForTimeout(500);

        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [{
                    id: 1,
                    text: "中文测试任务",
                    start_date: "2023-08-01",
                    duration: 4,
                    progress: 0.75,
                    priority: "high",
                    status: "in_progress"
                }]
            });
        });

        const zhFilePath = await exportExcelFile(page, 'export_zh_for_en.xlsx');

        // 验证导出的Excel确实是中文列名
        const { headers: zhHeaders } = parseExcelFile(zhFilePath);
        console.log('Chinese Excel Headers:', zhHeaders);
        expect(zhHeaders).toContain('任务名称');
        expect(zhHeaders).toContain('层级');
        expect(zhHeaders).toContain('优先级');

        // Step 2: 切换到英文环境并导入
        await page.evaluate(() => {
            window.i18n.setLanguage('en-US');
            gantt.clearAll();
        });
        await page.waitForTimeout(500);

        await importExcelFile(page, zhFilePath);

        // Step 3: 验证导入结果
        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Imported in English:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(1);
        const task = tasks[0];

        // **关键验证**: 列名映射是否正确工作
        expect(task.text).toBe('中文测试任务'); // 任务名称正确导入
        expect(task.duration).toBe(4);          // 工期正确导入
        expect(Math.round(task.progress * 100)).toBe(75); // 进度正确导入
        expect(task.priority).toBe('high');     // 优先级映射为内部值
        expect(task.status).toBe('in_progress'); // 状态映射为内部值
    });

    test('TC-IM-003: Cross-Language Data Integrity Verification', async ({ page }) => {
        // 中文环境创建包含特殊字符的任务
        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await page.waitForTimeout(500);

        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [{
                    id: 1,
                    text: "测试任务α🎯<>&特殊字符",
                    start_date: "2023-09-01",
                    duration: 5,
                    progress: 0.5,
                    priority: "high",
                    status: "in_progress",
                    assignee: "张三"
                }]
            });
        });

        const filePath = await exportExcelFile(page, 'zh_special_chars.xlsx');

        // 切换到英文并导入
        await page.evaluate(() => {
            window.i18n.setLanguage('en-US');
            gantt.clearAll();
        });
        await page.waitForTimeout(500);

        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Special Chars Import:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(1);
        const task = tasks[0];

        // **严格验证每个字段**
        expect(task.text).toContain('测试任务α');
        expect(task.text).toContain('🎯');
        expect(task.duration).toBe(5);
        expect(task.progress).toBeCloseTo(0.5, 2);
        expect(task.priority).toBe('high');
        expect(task.status).toBe('in_progress');
    });

    test('TC-IM-004: Cross-Language Import (En -> Zh)', async ({ page }) => {
        // 英文环境创建
        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.waitForTimeout(500);

        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [{
                    id: 1,
                    text: "English Task",
                    start_date: "2023-10-01",
                    duration: 6,
                    progress: 0.4,
                    priority: "low",
                    status: "pending"
                }]
            });
        });

        const filePath = await exportExcelFile(page, 'export_en_for_zh.xlsx');

        // 验证英文列名
        const { headers } = parseExcelFile(filePath);
        expect(headers).toContain('Task Name');

        // 切换到中文并导入
        await page.evaluate(() => {
            window.i18n.setLanguage('zh-CN');
            gantt.clearAll();
        });
        await page.waitForTimeout(500);

        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('En->Zh Import:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(1);
        expect(tasks[0].text).toBe('English Task');
        expect(tasks[0].priority).toBe('low');
        expect(tasks[0].status).toBe('pending');
    });

    test('TC-IM-005: Hierarchy Integrity Verification', async ({ page }) => {
        // 创建3层嵌套结构
        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [
                    { id: 1, text: "Level 1", start_date: "2023-11-01", duration: 10, open: true },
                    { id: 2, text: "Level 2", start_date: "2023-11-01", duration: 5, parent: 1, open: true },
                    { id: 3, text: "Level 3", start_date: "2023-11-01", duration: 2, parent: 2 }
                ]
            });
        });

        const filePath = await exportExcelFile(page, 'hierarchy_test.xlsx');

        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Hierarchy Import:', JSON.stringify(tasks, null, 2));

        const level1 = tasks.find(t => t.text === "Level 1");
        const level2 = tasks.find(t => t.text === "Level 2");
        const level3 = tasks.find(t => t.text === "Level 3");

        expect(level1).toBeDefined();
        expect(level2).toBeDefined();
        expect(level3).toBeDefined();

        // 验证父子关系
        expect(level2.parent).toBe(level1.id);
        expect(level3.parent).toBe(level2.id);
    });
});

test.describe('Excel Import Tests - Boundary', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-IM-B01: Empty Task Name Import', async ({ page }) => {
        // 创建带空名称的Excel
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Task Name', 'Start Date', 'Duration (days)'],
            ['1', '', '2023-12-01', 5]
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'empty_name.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Empty Name Result:', tasks);

        // 空名称应使用默认值
        expect(tasks.length).toBeGreaterThanOrEqual(1);
        if (tasks.length > 0) {
            expect(tasks[0].text).toBeTruthy(); // 不应为空
        }
    });

    test('TC-IM-B02: Zero Duration Import', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Task Name', 'Duration (days)'],
            ['1', 'Zero Duration Task', 0]
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'zero_duration.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Zero Duration Result:', tasks);

        // 工期为0时应使用默认值1或允许为0
        expect(tasks.length).toBe(1);
        expect(tasks[0].duration).toBeGreaterThanOrEqual(0);
    });

    test('TC-IM-B07: Special Characters Task Name', async ({ page }) => {
        const specialName = 'Test<>&"\'\n\tテスト🚀';
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Task Name', 'Duration (days)'],
            ['1', specialName, 3]
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'special_chars.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Special Chars Result:', tasks);

        expect(tasks.length).toBe(1);
        // 验证特殊字符保留
        expect(tasks[0].text).toContain('Test');
        expect(tasks[0].text).toContain('🚀');
    });

    test('TC-IM-B10: Partial Columns Import', async ({ page }) => {
        // 只包含最少必要列
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['层级', '任务名称'],
            ['1', '简单任务']
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'partial_columns.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Partial Columns Result:', tasks);

        expect(tasks.length).toBe(1);
        expect(tasks[0].text).toBe('简单任务');
        // 缺失字段应有默认值
        expect(tasks[0].duration).toBeGreaterThanOrEqual(1);
    });
});

test.describe('Excel Import Tests - Error Handling', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-IM-E01: Empty Excel File', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'empty_file.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => gantt.clearAll());

        // 监听toast消息
        const toastPromise = page.waitForSelector('.toast', { timeout: 5000 }).catch(() => null);

        await importExcelFile(page, filePath);

        const toast = await toastPromise;
        if (toast) {
            const text = await toast.textContent();
            console.log('Toast Message:', text);
            expect(text).toMatch(/错误|error|没有数据/i);
        }

        // 确认没有数据导入
        const tasks = await page.evaluate(() => gantt.serialize().data);
        expect(tasks.length).toBe(0);
    });

    test('TC-IM-E02: Headers Only - No Data Rows', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Task Name', 'Duration (days)']
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'headers_only.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.evaluate(() => gantt.clearAll());

        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Headers Only Result:', tasks);
        expect(tasks.length).toBe(0);
    });

    test('TC-IM-E03: Missing Required Column (Task Name)', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Duration', 'Progress'],
            ['1', 5, 50]
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'missing_name_column.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => gantt.clearAll());

        const toastPromise = page.waitForSelector('.toast', { timeout: 5000 }).catch(() => null);
        await importExcelFile(page, filePath);

        const toast = await toastPromise;
        if (toast) {
            const text = await toast.textContent();
            console.log('Missing Column Toast:', text);
        }
    });
});

test.describe('Excel Import Tests - Localization', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-IM-L01: Chinese Enum Values Import', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['层级', '任务名称', '优先级', '状态'],
            ['1', '高优先级任务', '高', '进行中'],
            ['2', '中优先级任务', '中', '待开始'],
            ['3', '低优先级任务', '低', '已完成']
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'zh_enum_values.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Zh Enum Import:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(3);

        const highTask = tasks.find(t => t.text === '高优先级任务');
        const medTask = tasks.find(t => t.text === '中优先级任务');
        const lowTask = tasks.find(t => t.text === '低优先级任务');

        // 验证枚举值映射为内部值
        expect(highTask.priority).toBe('high');
        expect(medTask.priority).toBe('medium');
        expect(lowTask.priority).toBe('low');

        expect(highTask.status).toBe('in_progress');
        expect(medTask.status).toBe('pending');
        expect(lowTask.status).toBe('completed');
    });

    test('TC-IM-L02: English Enum Values Import', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Task Name', 'Priority', 'Status'],
            ['1', 'High Priority', 'High', 'In Progress'],
            ['2', 'Low Priority', 'Low', 'Pending']
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'en_enum_values.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('zh-CN'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('En Enum Import:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(2);
        expect(tasks[0].priority).toBe('high');
        expect(tasks[1].priority).toBe('low');
    });

    test('TC-IM-L04: Mixed Language Enum Values', async ({ page }) => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ['Hierarchy', 'Task Name', 'Priority'],
            ['1', 'Mixed 1', '高'],
            ['2', 'Mixed 2', 'Low'],
            ['3', 'Mixed 3', 'medium']
        ]);
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const filePath = path.join(downloadPath, 'mixed_enum.xlsx');
        XLSX.writeFile(wb, filePath);

        await page.evaluate(() => window.i18n.setLanguage('en-US'));
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);

        const tasks = await page.evaluate(() => gantt.serialize().data);
        console.log('Mixed Enum Import:', JSON.stringify(tasks, null, 2));

        expect(tasks.length).toBe(3);
        // 所有不同格式的枚举值都应正确映射
        expect(tasks.find(t => t.text === 'Mixed 1').priority).toBe('high');
        expect(tasks.find(t => t.text === 'Mixed 2').priority).toBe('low');
        expect(tasks.find(t => t.text === 'Mixed 3').priority).toBe('medium');
    });
});

// ===============================================================
// 多语言视觉一致性测试 (Multi-Language Visual Consistency Tests)
// ===============================================================

// 多语言测试数据集
const multiLangTestData = {
    data: [
        {
            id: 1,
            text: "多语言项目 - Multilingual - 多言語 - 다국어",
            start_date: "2023-06-01",
            duration: 10,
            progress: 0.3,
            priority: "high",
            status: "in_progress",
            assignee: "张三/John/田中/김철수",
            open: true
        },
        {
            id: 2,
            text: "子任务🎯Subtask",
            start_date: "2023-06-03",
            duration: 5,
            progress: 0.5,
            priority: "medium",
            status: "in_progress",
            parent: 1
        },
        {
            id: 3,
            text: "已完成タスク완료",
            start_date: "2023-06-05",
            duration: 2,
            progress: 1.0,
            priority: "low",
            status: "completed",
            parent: 2
        },
        {
            id: 4,
            text: "待开始任务",
            start_date: "2023-06-20",
            duration: 7,
            progress: 0,
            priority: "high",
            status: "pending"
        }
    ]
};

// 语言配置
const LANGUAGES = [
    { code: 'zh-CN', name: '中文', hierarchyHeader: '层级', taskHeader: '任务名称', priorityHigh: '高', statusPending: '待开始' },
    { code: 'en-US', name: 'English', hierarchyHeader: 'Hierarchy', taskHeader: 'Task Name', priorityHigh: 'High', statusPending: 'Pending' },
    { code: 'ja-JP', name: '日本語', hierarchyHeader: '階層', taskHeader: 'タスク名', priorityHigh: '高', statusPending: '未着手' },
    { code: 'ko-KR', name: '한국어', hierarchyHeader: '계층', taskHeader: '작업 이름', priorityHigh: '높음', statusPending: '대기중' }
];

// 截图目录
const screenshotPath = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(screenshotPath)) {
    fs.mkdirSync(screenshotPath, { recursive: true });
}

// 辅助函数：获取甘特图渲染数据
async function getGanttRenderData(page) {
    return await page.evaluate(() => {
        const tasks = gantt.serialize().data;
        const taskBars = Array.from(document.querySelectorAll('.gantt_task_line')).map(bar => ({
            left: bar.offsetLeft,
            width: bar.offsetWidth,
            top: bar.offsetTop
        }));
        return { tasks, taskBars };
    });
}


test.describe('Multi-Language Visual Consistency Tests - Same Language Round Trip', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    for (const lang of LANGUAGES) {
        test(`TC-ML-00${LANGUAGES.indexOf(lang) + 1}: ${lang.name} Environment Round Trip`, async ({ page }) => {
            // Step 1: 设置语言环境
            await page.evaluate((langCode) => window.i18n.setLanguage(langCode), lang.code);
            await page.waitForTimeout(500);

            // Step 2: 加载测试数据
            await page.evaluate((testData) => {
                gantt.clearAll();
                gantt.parse(testData);
            }, multiLangTestData);
            await page.waitForTimeout(500);

            // Step 3: 截图 - 导出前
            await page.screenshot({
                path: path.join(screenshotPath, `${lang.code}_before_export.png`),
                fullPage: true
            });

            // Step 4: 获取导出前数据
            const beforeData = await getGanttRenderData(page);
            console.log(`${lang.name} - Before Export:`, JSON.stringify(beforeData.tasks.map(t => ({
                text: t.text, priority: t.priority, status: t.status
            })), null, 2));

            // Step 5: 导出Excel
            const filePath = await exportExcelFile(page, `ml_${lang.code}_roundtrip.xlsx`);

            // Step 6: 验证导出的Excel列名
            const { headers, json } = parseExcelFile(filePath);
            console.log(`${lang.name} Excel Headers:`, headers);

            expect(headers[0]).toBe(lang.hierarchyHeader);
            expect(headers).toContain(lang.taskHeader);

            // Step 7: 验证导出的枚举值本地化
            const highPriorityTask = json.find(row => row[lang.taskHeader]?.includes('待开始') || row[lang.taskHeader]?.includes('pending'));
            if (highPriorityTask) {
                console.log(`${lang.name} - High Priority Display:`, highPriorityTask);
            }

            // Step 8: 清空并导入
            await page.evaluate(() => gantt.clearAll());
            await importExcelFile(page, filePath);
            await page.waitForTimeout(500);

            // Step 9: 截图 - 导入后
            await page.screenshot({
                path: path.join(screenshotPath, `${lang.code}_after_import.png`),
                fullPage: true
            });

            // Step 10: 获取导入后数据
            const afterData = await getGanttRenderData(page);
            console.log(`${lang.name} - After Import:`, JSON.stringify(afterData.tasks.map(t => ({
                text: t.text, priority: t.priority, status: t.status
            })), null, 2));

            // Step 11: 验证数据完整性
            expect(afterData.tasks.length).toBe(beforeData.tasks.length);

            // 逐任务验证
            for (const origTask of beforeData.tasks) {
                const importedTask = afterData.tasks.find(t => t.text === origTask.text);
                expect(importedTask).toBeDefined();
                expect(importedTask.duration).toBe(origTask.duration);
                expect(importedTask.progress).toBeCloseTo(origTask.progress, 2);
                // 优先级和状态应该是内部值
                expect(['high', 'medium', 'low']).toContain(importedTask.priority);
                expect(['pending', 'in_progress', 'completed', 'suspended']).toContain(importedTask.status);
            }
        });
    }
});

test.describe('Multi-Language Visual Consistency Tests - Cross Language Import', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    // 生成跨语言测试组合
    const crossLangTests = [];
    for (const sourceLang of LANGUAGES) {
        for (const targetLang of LANGUAGES) {
            if (sourceLang.code !== targetLang.code) {
                crossLangTests.push({ source: sourceLang, target: targetLang });
            }
        }
    }

    // 选择关键的跨语言测试组合
    const keyTests = [
        { source: LANGUAGES[0], target: LANGUAGES[1] }, // zh-CN -> en-US
        { source: LANGUAGES[0], target: LANGUAGES[2] }, // zh-CN -> ja-JP
        { source: LANGUAGES[0], target: LANGUAGES[3] }, // zh-CN -> ko-KR
        { source: LANGUAGES[1], target: LANGUAGES[0] }, // en-US -> zh-CN
        { source: LANGUAGES[2], target: LANGUAGES[1] }, // ja-JP -> en-US
        { source: LANGUAGES[3], target: LANGUAGES[0] }, // ko-KR -> zh-CN
    ];

    for (const testCase of keyTests) {
        const testNum = keyTests.indexOf(testCase) + 5;
        test(`TC-ML-00${testNum}: Cross-Language ${testCase.source.name} -> ${testCase.target.name}`, async ({ page }) => {
            // Step 1: 源语言环境创建数据
            await page.evaluate((langCode) => window.i18n.setLanguage(langCode), testCase.source.code);
            await page.waitForTimeout(500);

            await page.evaluate((testData) => {
                gantt.clearAll();
                gantt.parse(testData);
            }, multiLangTestData);
            await page.waitForTimeout(500);

            // Step 2: 截图 - 源语言
            await page.screenshot({
                path: path.join(screenshotPath, `cross_${testCase.source.code}_to_${testCase.target.code}_source.png`),
                fullPage: true
            });

            // Step 3: 导出Excel
            const filePath = await exportExcelFile(page, `cross_${testCase.source.code}_to_${testCase.target.code}.xlsx`);

            // Step 4: 验证源语言Excel列名
            const { headers: sourceHeaders } = parseExcelFile(filePath);
            console.log(`${testCase.source.name} -> ${testCase.target.name} | Source Headers:`, sourceHeaders);
            expect(sourceHeaders[0]).toBe(testCase.source.hierarchyHeader);

            // Step 5: 切换到目标语言并导入
            await page.evaluate((langCode) => {
                window.i18n.setLanguage(langCode);
                gantt.clearAll();
            }, testCase.target.code);
            await page.waitForTimeout(500);

            await importExcelFile(page, filePath);
            await page.waitForTimeout(500);

            // Step 6: 截图 - 目标语言
            await page.screenshot({
                path: path.join(screenshotPath, `cross_${testCase.source.code}_to_${testCase.target.code}_target.png`),
                fullPage: true
            });

            // Step 7: 验证导入数据
            const tasks = await page.evaluate(() => gantt.serialize().data);
            console.log(`${testCase.source.name} -> ${testCase.target.name} | Imported Tasks:`,
                JSON.stringify(tasks.map(t => ({ text: t.text, priority: t.priority, status: t.status })), null, 2));

            expect(tasks.length).toBe(multiLangTestData.data.length);

            // 验证任务数据完整性
            for (const origTask of multiLangTestData.data) {
                const importedTask = tasks.find(t => t.text === origTask.text);
                expect(importedTask).toBeDefined();
                expect(importedTask.duration).toBe(origTask.duration);
                expect(importedTask.progress).toBeCloseTo(origTask.progress, 2);

                // 验证优先级和状态映射为内部值
                expect(importedTask.priority).toBe(origTask.priority);
                expect(importedTask.status).toBe(origTask.status);
            }
        });
    }
});

test.describe('Multi-Language Visual Rendering Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-ML-V01: Task Bar Color Consistency Across Languages', async ({ page }) => {
        const colors = {};

        for (const lang of LANGUAGES) {
            await page.evaluate((langCode) => window.i18n.setLanguage(langCode), lang.code);
            await page.waitForTimeout(500);

            await page.evaluate(() => {
                gantt.clearAll();
                gantt.parse({
                    data: [
                        { id: 1, text: "High Priority", start_date: "2023-06-01", duration: 5, priority: "high" },
                        { id: 2, text: "Medium Priority", start_date: "2023-06-01", duration: 5, priority: "medium" },
                        { id: 3, text: "Low Priority", start_date: "2023-06-01", duration: 5, priority: "low" }
                    ]
                });
            });
            await page.waitForTimeout(500);

            // 获取任务条颜色
            const taskColors = await page.evaluate(() => {
                const bars = document.querySelectorAll('.gantt_task_line');
                return Array.from(bars).map(bar => {
                    const style = window.getComputedStyle(bar);
                    return style.backgroundColor;
                });
            });

            colors[lang.code] = taskColors;
            console.log(`${lang.name} Task Colors:`, taskColors);
        }

        // 验证各语言下相同优先级颜色一致
        const langCodes = Object.keys(colors);
        for (let i = 1; i < langCodes.length; i++) {
            expect(colors[langCodes[i]]).toEqual(colors[langCodes[0]]);
        }
    });

    test('TC-ML-V02: Progress Bar Rendering Consistency', async ({ page }) => {
        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [
                    { id: 1, text: "50% Progress", start_date: "2023-06-01", duration: 10, progress: 0.5 }
                ]
            });
        });
        await page.waitForTimeout(500);

        // 导出
        const filePath = await exportExcelFile(page, 'progress_test.xlsx');

        // 获取导出前进度条宽度
        const beforeWidth = await page.evaluate(() => {
            const progressBar = document.querySelector('.gantt_task_progress');
            return progressBar ? progressBar.offsetWidth : 0;
        });

        // 导入
        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);
        await page.waitForTimeout(500);

        // 获取导入后进度条宽度
        const afterWidth = await page.evaluate(() => {
            const progressBar = document.querySelector('.gantt_task_progress');
            return progressBar ? progressBar.offsetWidth : 0;
        });

        console.log(`Progress Bar Width - Before: ${beforeWidth}, After: ${afterWidth}`);

        // 宽度应该一致（允许1px误差）
        expect(Math.abs(beforeWidth - afterWidth)).toBeLessThanOrEqual(1);
    });

    test('TC-ML-V03: Hierarchy Indent Consistency', async ({ page }) => {
        await page.evaluate(() => {
            gantt.clearAll();
            gantt.parse({
                data: [
                    { id: 1, text: "Level 1", start_date: "2023-06-01", duration: 10, open: true },
                    { id: 2, text: "Level 2", start_date: "2023-06-01", duration: 5, parent: 1, open: true },
                    { id: 3, text: "Level 3", start_date: "2023-06-01", duration: 2, parent: 2 }
                ]
            });
        });
        await page.waitForTimeout(500);

        // 获取导出前缩进 - 使用任务的 level 属性作为层级依据 (最准确)
        const beforeLevels = await page.evaluate(() => {
            const tasks = gantt.getTaskByTime();
            // 按在甘特图中显示的顺序排序
            tasks.sort((a, b) => a.$index - b.$index);
            return tasks.map(t => t.$level);
        });

        const filePath = await exportExcelFile(page, 'indent_test.xlsx');

        await page.evaluate(() => gantt.clearAll());
        await importExcelFile(page, filePath);
        await page.waitForTimeout(500);

        // 获取导入后缩进
        const afterLevels = await page.evaluate(() => {
            const tasks = gantt.getTaskByTime();
            tasks.sort((a, b) => a.$index - b.$index);
            return tasks.map(t => t.$level);
        });

        console.log(`Levels - Before: ${beforeLevels}, After: ${afterLevels}`);

        // 层级结构应该保持一致
        expect(afterLevels).toEqual(beforeLevels);
    });

    test('TC-ML-V05: Toolbar Language Switch Verification', async ({ page }) => {
        const todayTexts = {
            'zh-CN': '今天',
            'en-US': 'Today',
            'ja-JP': '今日',
            'ko-KR': '오늘'
        };

        for (const lang of LANGUAGES) {
            await page.evaluate((langCode) => window.i18n.setLanguage(langCode), lang.code);
            await page.waitForTimeout(500);

            // 截图工具栏
            await page.screenshot({
                path: path.join(screenshotPath, `toolbar_${lang.code}.png`),
                clip: { x: 0, y: 0, width: 1920, height: 60 }
            });

            // 验证今日按钮文字
            const todayBtnText = await page.evaluate(() => {
                const btn = document.querySelector('#scroll-to-today-btn');
                return btn ? btn.textContent.trim() : '';
            });

            console.log(`${lang.name} Today Button: "${todayBtnText}"`);
            expect(todayBtnText).toBe(todayTexts[lang.code]);
        }
    });
});

test.describe('Multi-Language Special Characters Tests', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('.gantt_task', { timeout: 10000 });
    });

    test('TC-ML-S01: CJK Mixed Task Name', async ({ page }) => {
        const mixedName = "项目α-プロジェクト-프로젝트-Project";

        for (const lang of LANGUAGES) {
            await page.evaluate((langCode) => window.i18n.setLanguage(langCode), lang.code);
            await page.waitForTimeout(500);

            await page.evaluate((taskName) => {
                gantt.clearAll();
                gantt.parse({
                    data: [{ id: 1, text: taskName, start_date: "2023-06-01", duration: 5 }]
                });
            }, mixedName);

            const filePath = await exportExcelFile(page, `cjk_${lang.code}.xlsx`);

            await page.evaluate(() => gantt.clearAll());
            await importExcelFile(page, filePath);

            const tasks = await page.evaluate(() => gantt.serialize().data);
            console.log(`${lang.name} - CJK Import:`, tasks[0]?.text);

            expect(tasks.length).toBe(1);
            expect(tasks[0].text).toBe(mixedName);
        }
    });

    test('TC-ML-S02: Emoji Task Name Multi-Language', async ({ page }) => {
        const emojiName = "🎯任务🚀Task✅完了";

        for (const lang of LANGUAGES) {
            await page.evaluate((langCode) => window.i18n.setLanguage(langCode), lang.code);
            await page.waitForTimeout(500);

            await page.evaluate((taskName) => {
                gantt.clearAll();
                gantt.parse({
                    data: [{ id: 1, text: taskName, start_date: "2023-06-01", duration: 3 }]
                });
            }, emojiName);

            const filePath = await exportExcelFile(page, `emoji_${lang.code}.xlsx`);

            await page.evaluate(() => gantt.clearAll());
            await importExcelFile(page, filePath);

            const tasks = await page.evaluate(() => gantt.serialize().data);
            console.log(`${lang.name} - Emoji Import:`, tasks[0]?.text);

            expect(tasks.length).toBe(1);
            expect(tasks[0].text).toContain('🎯');
            expect(tasks[0].text).toContain('🚀');
            expect(tasks[0].text).toContain('✅');
        }
    });
});
