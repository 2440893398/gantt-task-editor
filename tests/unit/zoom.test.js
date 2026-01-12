/**
 * 视图缩放功能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initZoom,
  setZoomLevel,
  zoomIn,
  zoomOut,
  getCurrentLevel,
  getCurrentLevelName,
  getAvailableLevels,
  resetZoomLevel
} from '../../src/features/gantt/zoom.js';

describe('缩放功能初始化', () => {
  beforeEach(() => {
    // 重置缩放级别到默认值
    resetZoomLevel('week');

    document.body.innerHTML = `
      <div id="gantt_here"></div>
      <button id="zoom-in-btn"></button>
      <button id="zoom-out-btn"></button>
      <input type="range" id="zoom-slider" min="0" max="4" value="1" />
      <select id="view-selector">
        <option value="day">日视图</option>
        <option value="week" selected>周视图</option>
        <option value="month">月视图</option>
        <option value="quarter">季度视图</option>
        <option value="year">年视图</option>
      </select>
      <span id="zoom-level-display">周视图</span>
    `;

    global.gantt = {
      config: {
        scales: [],
        min_column_width: 50
      },
      render: vi.fn()
    };
  });

  it('应该正确初始化缩放功能', () => {
    initZoom();

    // 验证初始缩放级别
    expect(getCurrentLevel()).toBe('week');
    expect(getCurrentLevelName()).toBe('周视图');
  });

  it('应该绑定缩放按钮事件', () => {
    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');

    const addEventListenerSpy = vi.spyOn(zoomInBtn, 'addEventListener');

    initZoom();

    expect(addEventListenerSpy).toHaveBeenCalled();
  });

  it('应该绑定视图选择器事件', () => {
    const viewSelector = document.getElementById('view-selector');
    const addEventListenerSpy = vi.spyOn(viewSelector, 'addEventListener');

    initZoom();

    expect(addEventListenerSpy).toHaveBeenCalled();
  });

  it('应该更新初始 UI 状态', () => {
    initZoom();

    const slider = document.getElementById('zoom-slider');
    const viewSelector = document.getElementById('view-selector');
    const levelDisplay = document.getElementById('zoom-level-display');

    expect(slider.value).toBe('1'); // week is at index 1
    expect(viewSelector.value).toBe('week');
    expect(levelDisplay.textContent).toBe('周视图');
  });
});

describe('缩放级别设置', () => {
  beforeEach(() => {
    // 重置缩放级别到默认值
    resetZoomLevel('week');

    document.body.innerHTML = `
      <div id="gantt_here"></div>
      <input type="range" id="zoom-slider" />
      <select id="view-selector">
        <option value="day">日视图</option>
        <option value="week">周视图</option>
        <option value="month">月视图</option>
        <option value="quarter">季度视图</option>
        <option value="year">年视图</option>
      </select>
      <span id="zoom-level-display"></span>
      <button id="zoom-in-btn"></button>
      <button id="zoom-out-btn"></button>
    `;

    global.gantt = {
      config: {
        scales: [],
        min_column_width: 50
      },
      render: vi.fn()
    };

    initZoom();
  });

  it('应该正确设置日视图', () => {
    setZoomLevel('day');

    expect(getCurrentLevel()).toBe('day');
    expect(getCurrentLevelName()).toBe('日视图');
    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.min_column_width).toBe(80);
    expect(gantt.render).toHaveBeenCalled();
  });

  it('应该正确设置周视图', () => {
    setZoomLevel('week');

    expect(getCurrentLevel()).toBe('week');
    expect(getCurrentLevelName()).toBe('周视图');
    expect(gantt.config.min_column_width).toBe(50);
  });

  it('应该正确设置月视图', () => {
    setZoomLevel('month');

    expect(getCurrentLevel()).toBe('month');
    expect(getCurrentLevelName()).toBe('月视图');
    expect(gantt.config.min_column_width).toBe(120);
  });

  it('应该正确设置季度视图', () => {
    setZoomLevel('quarter');

    expect(getCurrentLevel()).toBe('quarter');
    expect(getCurrentLevelName()).toBe('季度视图');
    expect(gantt.config.min_column_width).toBe(100);
  });

  it('应该正确设置年视图', () => {
    setZoomLevel('year');

    expect(getCurrentLevel()).toBe('year');
    expect(getCurrentLevelName()).toBe('年视图');
    expect(gantt.config.min_column_width).toBe(80);
  });

  it('应该忽略无效的缩放级别', () => {
    const currentLevel = getCurrentLevel();
    setZoomLevel('invalid_level');

    expect(getCurrentLevel()).toBe(currentLevel);
  });

  it('应该更新 UI 元素', () => {
    setZoomLevel('month');

    const viewSelector = document.getElementById('view-selector');
    const levelDisplay = document.getElementById('zoom-level-display');

    expect(viewSelector.value).toBe('month');
    expect(levelDisplay.textContent).toBe('月视图');
  });
});

describe('放大缩小操作', () => {
  beforeEach(() => {
    // 重置缩放级别到默认值
    resetZoomLevel('week');

    document.body.innerHTML = `
      <div id="gantt_here"></div>
      <input type="range" id="zoom-slider" />
      <select id="view-selector"></select>
      <span id="zoom-level-display"></span>
      <button id="zoom-in-btn"></button>
      <button id="zoom-out-btn"></button>
    `;

    global.gantt = {
      config: {
        scales: [],
        min_column_width: 50
      },
      render: vi.fn()
    };

    initZoom();
    // 设置初始级别为周视图
    setZoomLevel('week');
  });

  it('应该放大到日视图', () => {
    zoomIn();

    expect(getCurrentLevel()).toBe('day');
  });

  it('应该缩小到月视图', () => {
    zoomOut();

    expect(getCurrentLevel()).toBe('month');
  });

  it('应该在最大放大级别时无法继续放大', () => {
    setZoomLevel('day');
    zoomIn();

    expect(getCurrentLevel()).toBe('day');
  });

  it('应该在最小缩小级别时无法继续缩小', () => {
    setZoomLevel('year');
    zoomOut();

    expect(getCurrentLevel()).toBe('year');
  });

  it('应该禁用最大放大级别的放大按钮', () => {
    setZoomLevel('day');

    const zoomInBtn = document.getElementById('zoom-in-btn');
    expect(zoomInBtn.disabled).toBe(true);
  });

  it('应该禁用最小缩小级别的缩小按钮', () => {
    setZoomLevel('year');

    const zoomOutBtn = document.getElementById('zoom-out-btn');
    expect(zoomOutBtn.disabled).toBe(true);
  });
});

describe('缩放级别信息', () => {
  beforeEach(() => {
    // 重置缩放级别到默认值
    resetZoomLevel('week');

    document.body.innerHTML = `<div id="gantt_here"></div>`;
    global.gantt = {
      config: {
        scales: [],
        min_column_width: 50
      },
      render: vi.fn()
    };
  });

  it('应该返回当前缩放级别', () => {
    expect(getCurrentLevel()).toBe('week');
  });

  it('应该返回当前缩放级别名称', () => {
    expect(getCurrentLevelName()).toBe('周视图');
  });

  it('应该返回所有可用的缩放级别', () => {
    const levels = getAvailableLevels();

    expect(levels).toHaveLength(5);
    expect(levels[0]).toEqual({ key: 'day', name: '日视图' });
    expect(levels[1]).toEqual({ key: 'week', name: '周视图' });
    expect(levels[2]).toEqual({ key: 'month', name: '月视图' });
    expect(levels[3]).toEqual({ key: 'quarter', name: '季度视图' });
    expect(levels[4]).toEqual({ key: 'year', name: '年视图' });
  });
});

describe('缩放刻度配置', () => {
  beforeEach(() => {
    // 重置缩放级别到默认值
    resetZoomLevel('week');

    document.body.innerHTML = `<div id="gantt_here"></div>`;
    global.gantt = {
      config: {
        scales: [],
        min_column_width: 50
      },
      render: vi.fn()
    };
  });

  it('应该为日视图配置正确的刻度', () => {
    setZoomLevel('day');

    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.scales[0].unit).toBe('week');
    expect(gantt.config.scales[1].unit).toBe('day');
  });

  it('应该为周视图配置正确的刻度', () => {
    setZoomLevel('week');

    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.scales[0].unit).toBe('month');
    expect(gantt.config.scales[1].unit).toBe('day');
  });

  it('应该为月视图配置正确的刻度', () => {
    setZoomLevel('month');

    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.scales[0].unit).toBe('year');
    expect(gantt.config.scales[1].unit).toBe('month');
  });

  it('应该为季度视图配置正确的刻度', () => {
    setZoomLevel('quarter');

    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.scales[0].unit).toBe('year');
    expect(gantt.config.scales[1].unit).toBe('quarter');
  });

  it('应该为年视图配置正确的刻度', () => {
    setZoomLevel('year');

    expect(gantt.config.scales).toHaveLength(2);
    expect(gantt.config.scales[0].unit).toBe('year');
    expect(gantt.config.scales[1].unit).toBe('quarter');
  });
});

describe('滑块控件', () => {
  beforeEach(() => {
    // 重置缩放级别到默认值
    resetZoomLevel('week');

    document.body.innerHTML = `
      <div id="gantt_here"></div>
      <input type="range" id="zoom-slider" min="0" max="4" value="1" />
      <select id="view-selector"></select>
      <span id="zoom-level-display"></span>
    `;

    global.gantt = {
      config: {
        scales: [],
        min_column_width: 50
      },
      render: vi.fn()
    };

    initZoom();
  });

  it('应该通过滑块切换到日视图', () => {
    const slider = document.getElementById('zoom-slider');
    slider.value = 0;
    slider.dispatchEvent(new Event('input'));

    expect(getCurrentLevel()).toBe('day');
  });

  it('应该通过滑块切换到月视图', () => {
    const slider = document.getElementById('zoom-slider');
    slider.value = 2;
    slider.dispatchEvent(new Event('input'));

    expect(getCurrentLevel()).toBe('month');
  });

  it('应该通过滑块切换到年视图', () => {
    const slider = document.getElementById('zoom-slider');
    slider.value = 4;
    slider.dispatchEvent(new Event('input'));

    expect(getCurrentLevel()).toBe('year');
  });

  it('应该在缩放级别改变时更新滑块值', () => {
    setZoomLevel('quarter');

    const slider = document.getElementById('zoom-slider');
    expect(slider.value).toBe('3');
  });
});
