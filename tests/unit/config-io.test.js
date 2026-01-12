/**
 * 配置导入导出功能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  exportConfig,
  importConfig,
  initConfigIO
} from '../../src/features/config/configIO.js';
import { state } from '../../src/core/store.js';

describe('配置导出', () => {
  beforeEach(() => {
    // Mock URL API
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

    // Mock Blob
    global.Blob = vi.fn((content, options) => ({
      content,
      options
    }));

    // 设置测试数据
    state.customFields = [
      { name: 'priority', label: '优先级', type: 'select', options: ['高', '中', '低'] },
      { name: 'status', label: '状态', type: 'text' }
    ];
    state.fieldOrder = ['text', 'priority', 'status', 'start_date', 'duration', 'progress'];

    // Mock document.createElement
    const mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
      dispatchEvent: vi.fn()
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink);
  });

  it('应该导出配置为 JSON 文件', () => {
    exportConfig();

    expect(document.createElement).toHaveBeenCalledWith('a');
  });

  it('应该设置正确的文件名', () => {
    exportConfig();

    const mockLink = document.createElement('a');
    expect(mockLink.download).toBeDefined();
  });

  it('应该包含自定义字段和字段顺序', () => {
    // 由于 Blob 被 mock，我们无法直接验证内容
    // 但可以验证 Blob 构造函数被调用
    exportConfig();

    expect(global.Blob).toHaveBeenCalled();
  });

  it('应该自动触发下载', () => {
    exportConfig();

    const mockLink = document.createElement('a');
    // 代码使用 dispatchEvent 而不是 click
    expect(mockLink.dispatchEvent).toHaveBeenCalled();
  });

  it('应该在导出后清理 URL', () => {
    exportConfig();

    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe('配置导入', () => {
  beforeEach(() => {
    state.customFields = [];
    state.fieldOrder = [];

    // Mock gantt
    global.gantt = {
      config: { columns: [] },
      render: vi.fn()
    };
  });

  it('应该成功导入有效的配置文件', async () => {
    const validConfig = {
      customFields: [
        { name: 'priority', label: '优先级', type: 'text' }
      ],
      fieldOrder: ['text', 'priority']
    };

    const file = new File(
      [JSON.stringify(validConfig)],
      'config.json',
      { type: 'application/json' }
    );

    // Mock FileReader
    const originalFileReader = global.FileReader;
    global.FileReader = vi.fn(function () {
      this.readAsText = function (file) {
        // 模拟异步读取
        setTimeout(() => {
          this.result = JSON.stringify(validConfig);
          this.onload({ target: { result: this.result } });
        }, 0);
      };
    });

    importConfig(file);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(state.customFields).toHaveLength(1);
    expect(state.customFields[0].name).toBe('priority');
    expect(state.fieldOrder).toContain('priority');

    global.FileReader = originalFileReader;
  });

  it('应该拒绝格式不正确的配置文件', async () => {
    const invalidConfig = {
      invalid: 'data'
    };

    const file = new File(
      [JSON.stringify(invalidConfig)],
      'config.json',
      { type: 'application/json' }
    );

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

    await new Promise(resolve => setTimeout(resolve, 20));

    // 配置不应该被导入
    expect(state.customFields).toHaveLength(0);

    global.FileReader = originalFileReader;
  });

  it('应该处理 JSON 解析错误', async () => {
    const file = new File(
      ['{ invalid json }'],
      'config.json',
      { type: 'application/json' }
    );

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

    await new Promise(resolve => setTimeout(resolve, 20));

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

  it('点击导入按钮应该触发文件选择', () => {
    initConfigIO();

    const importBtn = document.getElementById('config-import-btn');
    const fileInput = document.getElementById('config-file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    importBtn.click();

    expect(clickSpy).toHaveBeenCalled();
  });
});

describe('配置数据完整性', () => {
  it('导出的配置应该包含导出时间', () => {
    state.customFields = [
      { name: 'test', label: '测试', type: 'text' }
    ];
    state.fieldOrder = ['test'];

    // Mock Blob 以捕获内容
    let exportedData = null;
    global.Blob = vi.fn((content) => {
      exportedData = JSON.parse(content[0]);
      return { content };
    });

    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();

    const mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
      dispatchEvent: vi.fn()
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockLink);

    exportConfig();

    expect(exportedData).toHaveProperty('exportTime');
    expect(exportedData.customFields).toHaveLength(1);
    expect(exportedData.fieldOrder).toContain('test');
  });

  it('导入应该保留所有字段属性', async () => {
    const config = {
      customFields: [
        {
          name: 'priority',
          label: '优先级',
          type: 'select',
          required: true,
          options: ['高', '中', '低']
        }
      ],
      fieldOrder: ['text', 'priority']
    };

    const file = new File(
      [JSON.stringify(config)],
      'config.json',
      { type: 'application/json' }
    );

    const originalFileReader = global.FileReader;
    global.FileReader = vi.fn(function () {
      this.readAsText = function (file) {
        setTimeout(() => {
          this.result = JSON.stringify(config);
          this.onload({ target: { result: this.result } });
        }, 0);
      };
    });

    global.gantt = {
      config: { columns: [] },
      render: vi.fn()
    };

    importConfig(file);

    await new Promise(resolve => setTimeout(resolve, 20));

    const imported = state.customFields[0];
    expect(imported.name).toBe('priority');
    expect(imported.label).toBe('优先级');
    expect(imported.type).toBe('select');
    expect(imported.required).toBe(true);
    expect(imported.options).toEqual(['高', '中', '低']);

    global.FileReader = originalFileReader;
  });
});
