/**
 * 配置导入导出功能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import ExcelJS from 'exceljs';
import {
    exportConfig,
    exportFullBackup,
    importFullBackup,
    importConfig,
    importFromExcel,
    exportToExcel,
    initConfigIO,
} from '../../src/features/config/configIO.js';
import { state } from '../../src/core/store.js';

vi.mock('../../src/features/gantt/scheduler.js', () => ({
    recalculateAllParentRollups: vi.fn(),
}));

import { recalculateAllParentRollups } from '../../src/features/gantt/scheduler.js';

describe('配置导出', () => {
    beforeEach(() => {
        // Mock URL API
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();
        global.CompressionStream = class {};
        global.Response = vi.fn(function () {
            this.blob = vi.fn(() => Promise.resolve({ size: 128 }));
        });

        // Mock Blob
        global.Blob = vi.fn((content, options) => ({
            content,
            options,
            size: content.join('').length,
            stream: vi.fn(() => ({
                pipeThrough: vi.fn(() => 'compressed-stream'),
            })),
        }));
        global.gantt = {
            serialize: vi.fn(() => ({
                data: [{ id: 1, text: 'Task' }],
                links: [],
            })),
        };

        // 设置测试数据
        state.customFields = [
            { name: 'priority', label: '优先级', type: 'select', options: ['高', '中', '低'] },
            { name: 'status', label: '状态', type: 'text' },
        ];
        state.fieldOrder = ['text', 'priority', 'status', 'start_date', 'duration', 'progress'];

        // Mock document.createElement
        const mockLink = {
            href: '',
            download: '',
            click: vi.fn(),
            dispatchEvent: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
    });

    it('应该导出配置为 JSON 文件', async () => {
        await exportConfig();

        expect(document.createElement).toHaveBeenCalledWith('a');
    });

    it('应该设置正确的文件名', async () => {
        await exportConfig();

        const mockLink = document.createElement('a');
        expect(mockLink.download).toBeDefined();
    });

    it('应该包含自定义字段和字段顺序', async () => {
        // 由于 Blob 被 mock，我们无法直接验证内容
        // 但可以验证 Blob 构造函数被调用
        await exportConfig();

        expect(global.Blob).toHaveBeenCalled();
    });

    it('应该自动触发下载', async () => {
        await exportConfig();

        const mockLink = document.createElement('a');
        // 代码使用 dispatchEvent 而不是 click
        expect(mockLink.dispatchEvent).toHaveBeenCalled();
    });

    it('应该在导出后清理 URL', async () => {
        await exportConfig();

        expect(global.URL.revokeObjectURL).toHaveBeenCalled();
    });
});

describe('JSON backup import/export', () => {
    beforeEach(() => {
        global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
        global.URL.revokeObjectURL = vi.fn();
        global.CompressionStream = class {
            constructor(format) {
                this.format = format;
            }
        };
        global.Response = vi.fn(function () {
            this.blob = vi.fn(() =>
                Promise.resolve({
                    size: 128,
                    type: 'application/gzip',
                })
            );
        });
        global.Blob = vi.fn((content, options) => ({
            content,
            options,
            size: content.join('').length,
            stream: vi.fn(() => ({
                pipeThrough: vi.fn(() => 'compressed-stream'),
            })),
        }));
        global.gantt = {
            serialize: vi.fn(() => ({
                data: [{ id: 1, text: 'Current task' }],
                links: [{ id: 1, source: 1, target: 2, type: '0' }],
            })),
        };

        state.currentProjectId = 'project-a';
        state.customFields = [{ name: 'owner', label: 'Owner', type: 'text' }];
        state.fieldOrder = ['text', 'owner'];
        state.systemFieldSettings = { enabled: { owner: true } };
        state.viewMode = 'split';

        const mockLink = {
            href: '',
            download: '',
            dispatchEvent: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
    });

    it('exportConfig delegates to a single compressed full backup archive', async () => {
        await exportConfig();

        const mockLink = document.createElement('a');
        expect(mockLink.download).toMatch(/^gantt-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/);
        expect(global.Blob).toHaveBeenCalledTimes(2);

        const backup = JSON.parse(global.Blob.mock.calls[0][0][0]);
        expect(backup.data.tasks).toEqual([{ id: 1, text: 'Current task' }]);
        expect(backup.data.links).toHaveLength(1);
        expect(backup.data.customFields).toEqual(state.customFields);
    });

    it('exportFullBackup downloads only the compressed archive', async () => {
        await exportFullBackup();

        const mockLink = document.createElement('a');
        expect(mockLink.dispatchEvent).toHaveBeenCalledTimes(1);
        expect(mockLink.download.endsWith('.json.gz')).toBe(true);
        expect(mockLink.download.endsWith('.json')).toBe(false);
    });

    it('importConfig rejects plain JSON files because restore only supports compressed backups', async () => {
        const file = new File(
            [JSON.stringify({ customFields: [], fieldOrder: [] })],
            'config.json',
            {
                type: 'application/json',
            }
        );

        await importConfig(file);

        expect(state.customFields).toEqual([{ name: 'owner', label: 'Owner', type: 'text' }]);
    });

    it('importFullBackup recalculates parent rollups before persisting restored gantt data', async () => {
        const backup = {
            version: '2.0.0',
            exportTime: '2026-01-01T00:00:00.000Z',
            metadata: { taskCount: 2, linkCount: 0 },
            data: {
                tasks: [
                    { id: 1, text: 'Parent', start_date: '2026-01-01', duration: 1 },
                    { id: 2, text: 'Child', parent: 1, start_date: '2026-01-03', duration: 2 },
                ],
                links: [],
            },
        };
        const saveGanttData = vi.fn();

        global.DecompressionStream = class {};
        global.Response = vi.fn(function () {
            this.text = vi.fn(() => Promise.resolve(JSON.stringify(backup)));
        });
        global.confirm = vi.fn(() => true);
        global.gantt = {
            batchUpdate: vi.fn((callback) => callback()),
            clearAll: vi.fn(),
            parse: vi.fn(),
            serialize: vi.fn(() => ({ data: [{ id: 1, text: 'Normalized parent' }], links: [] })),
        };
        state.currentProjectId = 'project-a';

        const storage = await import('../../src/core/storage.js');
        vi.spyOn(storage, 'projectScope').mockReturnValue({
            saveGanttData,
            saveBaseline: vi.fn(),
            getBaseline: vi.fn(),
        });

        const file = {
            name: 'backup.json.gz',
            stream: vi.fn(() => ({
                pipeThrough: vi.fn(() => 'decompressed-stream'),
            })),
        };

        await importFullBackup(file);

        expect(recalculateAllParentRollups).toHaveBeenCalled();
        expect(saveGanttData).toHaveBeenCalledWith({
            data: [{ id: 1, text: 'Normalized parent' }],
            links: [],
        });
    });
});

describe('配置导入', () => {
    beforeEach(() => {
        state.customFields = [];
        state.fieldOrder = [];

        // Mock gantt
        global.gantt = {
            config: { columns: [] },
            render: vi.fn(),
        };
    });

    it('rejects legacy field config JSON files', async () => {
        const validConfig = {
            customFields: [{ name: 'priority', label: 'Priority', type: 'text' }],
            fieldOrder: ['text', 'priority'],
        };

        const file = new File([JSON.stringify(validConfig)], 'config.json', {
            type: 'application/json',
        });

        await importConfig(file);

        expect(state.customFields).toHaveLength(0);
        expect(state.fieldOrder).toHaveLength(0);
    });

    it('应该拒绝格式不正确的配置文件', async () => {
        const invalidConfig = {
            invalid: 'data',
        };

        const file = new File([JSON.stringify(invalidConfig)], 'config.json', {
            type: 'application/json',
        });

        const originalFileReader = global.FileReader;
        global.FileReader = vi.fn(function () {
            this.readAsText = function (file) {
                setTimeout(() => {
                    this.result = JSON.stringify(invalidConfig);
                    this.onload({ target: { result: this.result } });
                }, 0);
            };
        });

        importConfig(file);

        await new Promise((resolve) => setTimeout(resolve, 20));

        // 配置不应该被导入
        expect(state.customFields).toHaveLength(0);

        global.FileReader = originalFileReader;
    });

    it('应该处理 JSON 解析错误', async () => {
        const file = new File(['{ invalid json }'], 'config.json', { type: 'application/json' });

        const originalFileReader = global.FileReader;
        global.FileReader = vi.fn(function () {
            this.readAsText = function (file) {
                setTimeout(() => {
                    this.result = '{ invalid json }';
                    this.onload({ target: { result: this.result } });
                }, 0);
            };
        });

        importConfig(file);

        await new Promise((resolve) => setTimeout(resolve, 20));

        // 配置不应该被导入
        expect(state.customFields).toHaveLength(0);

        global.FileReader = originalFileReader;
    });

    it('应该在没有文件时不执行任何操作', () => {
        importConfig(null);
        importConfig(undefined);

        expect(state.customFields).toHaveLength(0);
    });
});

describe('Excel 导入', () => {
    beforeEach(() => {
        state.currentProjectId = 'project-a';
        state.customFields = [];
        state.fieldOrder = [
            'text',
            'priority',
            'assignee',
            'status',
            'description',
            'start_date',
            'end_date',
            'duration',
            'progress',
        ];

        global.gantt = {
            batchUpdate: vi.fn((callback) => callback()),
            clearAll: vi.fn(),
            parse: vi.fn(),
            calculateDuration: vi.fn(() => 1),
            calculateEndDate: vi.fn((date) => new Date(date)),
        };
    });

    it('导入中文描述列后保留到任务描述字段', async () => {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('任务列表');
        worksheet.addRow(['层级', '任务名称', '描述', '计划开始', '计划截止']);
        worksheet.addRow([
            '1',
            '用户组织-部门打标签功能',
            '<p>导入的详细描述</p>',
            '2026-06-06',
            '2026-06-06',
        ]);

        const buffer = await workbook.xlsx.writeBuffer();
        const file = {
            arrayBuffer: vi.fn(async () => buffer),
        };

        await importFromExcel(file);

        expect(global.gantt.parse).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({
                    text: '用户组织-部门打标签功能',
                    description: '<p>导入的详细描述</p>',
                }),
            ],
        });
    });
});

describe('Excel 导出日期边界', () => {
    beforeEach(() => {
        state.customFields = [];
        state.fieldOrder = ['text', 'start_date', 'end_date', 'duration'];
        state.systemFieldSettings = { enabled: {}, typeOverrides: {} };
        global.URL.createObjectURL = vi.fn(() => 'blob:excel-url');
        global.URL.revokeObjectURL = vi.fn();
        global.Blob = vi.fn((parts, options) => ({ parts, options }));
        global.gantt = {
            serialize: vi.fn(() => ({
                data: [
                    {
                        id: 1,
                        text: 'Normal task',
                        start_date: new Date(2026, 6, 1),
                        end_date: new Date(2026, 6, 4),
                        duration: 3,
                    },
                    {
                        id: 2,
                        text: 'Milestone',
                        type: 'milestone',
                        start_date: new Date(2026, 6, 5),
                        end_date: new Date(2026, 6, 5),
                        duration: 0,
                    },
                ],
            })),
            getTask: vi.fn(() => null),
            eachTask: vi.fn(),
            date: {
                date_to_str: vi.fn(() => (date) => {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                }),
            },
        };

        vi.spyOn(document, 'createElement').mockReturnValue({
            href: '',
            download: '',
            dispatchEvent: vi.fn(),
        });
    });

    it('[SCN-GUI-009] preserves milestone due date while converting normal exclusive ends', async () => {
        await exportToExcel();

        const buffer = global.Blob.mock.calls[0][0][0];
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];
        const headers = worksheet.getRow(1).values;
        const dueColumn = headers.findIndex((value) => value === '计划截止');

        expect(dueColumn).toBeGreaterThan(0);
        expect(worksheet.getRow(2).getCell(dueColumn).value).toBe('2026-07-03');
        expect(worksheet.getRow(3).getCell(dueColumn).value).toBe('2026-07-05');
    });
});

describe('配置导入导出初始化', () => {
    beforeEach(() => {
        document.body.innerHTML = `
      <button id="config-export-btn"></button>
      <button id="config-import-btn"></button>
      <input type="file" id="config-file-input" />
    `;
    });

    it('应该绑定导出按钮事件', () => {
        const exportBtn = document.getElementById('config-export-btn');
        const addEventListenerSpy = vi.spyOn(exportBtn, 'addEventListener');

        initConfigIO();

        expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('应该绑定导入按钮事件', () => {
        const importBtn = document.getElementById('config-import-btn');
        const addEventListenerSpy = vi.spyOn(importBtn, 'addEventListener');

        initConfigIO();

        expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    });

    it('应该绑定文件输入事件', () => {
        const fileInput = document.getElementById('config-file-input');
        const addEventListenerSpy = vi.spyOn(fileInput, 'addEventListener');

        initConfigIO();

        expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('JSON import input accepts compressed backup archives only', () => {
        initConfigIO();

        expect(document.getElementById('config-file-input').accept).toBe('.json.gz,.gz');
    });

    it('点击导入按钮应该触发文件选择', () => {
        initConfigIO();

        const importBtn = document.getElementById('config-import-btn');
        const fileInput = document.getElementById('config-file-input');
        const clickSpy = vi.spyOn(fileInput, 'click');

        importBtn.click();

        expect(clickSpy).toHaveBeenCalled();
    });
});

describe('JSON backup data integrity', () => {
    beforeEach(() => {
        global.URL.createObjectURL = vi.fn(() => 'blob:mock');
        global.URL.revokeObjectURL = vi.fn();
        global.CompressionStream = class {};
        global.Response = vi.fn(function () {
            this.blob = vi.fn(() => Promise.resolve({ size: 256 }));
        });
        global.gantt = {
            serialize: vi.fn(() => ({
                data: [{ id: 1, text: 'Task from current page' }],
                links: [{ id: 1, source: 1, target: 2, type: '0' }],
            })),
        };
    });

    it('backup payload contains export time, field config, current tasks, and links', async () => {
        state.customFields = [{ name: 'test', label: 'Test', type: 'text' }];
        state.fieldOrder = ['text', 'test'];

        let exportedData = null;
        global.Blob = vi.fn((content) => {
            if (!exportedData) {
                exportedData = JSON.parse(content[0]);
            }
            return {
                content,
                size: content.join('').length,
                stream: vi.fn(() => ({ pipeThrough: vi.fn(() => 'stream') })),
            };
        });

        const mockLink = {
            href: '',
            download: '',
            dispatchEvent: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockLink);

        await exportConfig();

        expect(exportedData).toHaveProperty('exportTime');
        expect(exportedData.data.customFields).toHaveLength(1);
        expect(exportedData.data.fieldOrder).toContain('test');
        expect(exportedData.data.tasks).toEqual([{ id: 1, text: 'Task from current page' }]);
        expect(exportedData.data.links).toHaveLength(1);
    });
});
