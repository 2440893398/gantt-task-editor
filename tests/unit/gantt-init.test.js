/**
 * 甘特图初始化和渲染测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initGantt, setupGlobalEvents } from '../../src/features/gantt/init.js';

describe('甘特图初始化', () => {
  beforeEach(() => {
    // 重置 DOM
    document.body.innerHTML = `
      <div id="gantt_here"></div>
      <div id="gantt-legend"></div>
    `;

    // 重置 gantt mock
    global.gantt.init = vi.fn();
    global.gantt.parse = vi.fn();
    global.gantt.attachEvent = vi.fn();
    global.gantt.i18n.setLocale = vi.fn();
  });

  it('应该正确初始化甘特图', () => {
    initGantt();

    // 验证语言设置
    expect(gantt.i18n.setLocale).toHaveBeenCalledWith('cn');

    // 验证日期格式配置
    expect(gantt.config.date_format).toBe('%Y-%m-%d');
    expect(gantt.config.xml_date).toBe('%Y-%m-%d');

    // 验证初始化和数据解析
    expect(gantt.init).toHaveBeenCalledWith('gantt_here');
    expect(gantt.parse).toHaveBeenCalled();
  });

  it('应该配置正确的时间刻度', () => {
    initGantt();

    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.scales[0].unit).toBe('month');
    expect(gantt.config.scales[1].unit).toBe('day');
  });

  it('应该设置正确的行高和刻度高度', () => {
    initGantt();

    expect(gantt.config.row_height).toBe(50);
    expect(gantt.config.scale_height).toBe(40);
    expect(gantt.config.reorder_grid_columns).toBe(true);
  });

  it('应该从 localStorage 恢复网格宽度', () => {
    localStorage.getItem.mockReturnValue('500');

    initGantt();

    expect(localStorage.getItem).toHaveBeenCalledWith('gantt_grid_width');
    expect(gantt.config.layout.cols[0].width).toBe(500);
  });

  it('应该设置默认网格宽度为 600', () => {
    localStorage.getItem.mockReturnValue(null);

    initGantt();

    expect(gantt.config.layout.cols[0].width).toBe(600);
  });

  it('应该注册任务点击事件处理器', () => {
    initGantt();

    expect(gantt.attachEvent).toHaveBeenCalledWith(
      'onTaskClick',
      expect.any(Function)
    );
  });

  it('应该注册 Lightbox 保存事件处理器', () => {
    initGantt();

    expect(gantt.attachEvent).toHaveBeenCalledWith(
      'onLightboxSave',
      expect.any(Function)
    );
  });

  it('应该配置任务样式模板', () => {
    initGantt();

    expect(gantt.templates.task_class).toBeDefined();
    expect(gantt.templates.grid_row_class).toBeDefined();
    expect(gantt.templates.task_row_class).toBeDefined();
  });
});

describe('全局事件设置', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="gantt_here"></div>
    `;

    global.gantt.$grid = document.createElement('div');
    global.gantt.$grid_scale = document.createElement('div');
  });

  it('应该设置 Ctrl 键监听', () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

    setupGlobalEvents();

    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('keyup', expect.any(Function));
  });

  it('应该设置复选框事件委托', () => {
    const addEventListenerSpy = vi.spyOn(gantt.$grid, 'addEventListener');

    setupGlobalEvents();

    expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('应该设置全选复选框事件', () => {
    const addEventListenerSpy = vi.spyOn(gantt.$grid_scale, 'addEventListener');

    setupGlobalEvents();

    expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
  });
});

describe('任务样式渲染', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="gantt_here"></div>`;
    initGantt();
  });

  it('应该为逾期未完成任务添加 overdue 样式', () => {
    const pastDate = new Date('2020-01-01');
    const task = { progress: 0.5 };

    const className = gantt.templates.task_class(new Date(), pastDate, task);

    expect(className).toContain('task_overdue');
  });

  it('应该为已完成任务添加 completed 样式', () => {
    const task = { progress: 1 };

    const className = gantt.templates.task_class(new Date(), new Date(), task);

    expect(className).toContain('task_completed');
  });

  it('应该为进行中任务不添加特殊样式', () => {
    const futureDate = new Date('2030-01-01');
    const task = { progress: 0.5 };

    const className = gantt.templates.task_class(new Date(), futureDate, task);

    expect(className).not.toContain('task_overdue');
    expect(className).not.toContain('task_completed');
  });
});
