/**
 * Vitest 测试环境设置
 *
 * 重要说明：
 * 1. 此文件中的 Mock 仅用于提供对 gantt-init.test.js 等测试文件的全局依赖
 * 2. 使用 importOriginal 来保留原始模块的导出，同时只覆盖特定函数
 * 3. 单元测试文件如果需要真实的模块导出，应该在各自测试文件中配置自己的 mock
 */

import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Mock showToast 函数避免 DOM 操作问题
vi.mock('../src/utils/toast.js', () => ({
  showToast: vi.fn()
}));

// Mock updateGanttColumns 和 refreshLightbox
vi.mock('../src/features/gantt/columns.js', () => ({
  updateGanttColumns: vi.fn()
}));

vi.mock('../src/features/lightbox/customization.js', () => ({
  refreshLightbox: vi.fn(),
  registerCustomFieldsBlock: vi.fn(),
  configureLightbox: vi.fn(),
  registerNameInput: vi.fn()
}));

// Mock 其他可能被导入的模块
vi.mock('../src/features/gantt/resizer.js', () => ({
  initResizer: vi.fn()
}));

// 对于 zoom.js, 只 mock 初始化函数（避免 DOM 操作），保留其他原始导出
vi.mock('../src/features/gantt/zoom.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    initZoom: vi.fn(),
    refreshZoomBindings: vi.fn()
    // 注意：resetZoomLevel 保留原始实现，供 zoom.test.js 使用
  };
});

// 对于 scheduler.js, 需要保留原始导出以便单元测试使用真实函数
vi.mock('../src/features/gantt/scheduler.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    initScheduler: vi.fn()
  };
});

vi.mock('../src/features/gantt/responsive.js', () => ({
  initResponsive: vi.fn()
}));

vi.mock('../src/features/gantt/inline-edit.js', () => ({
  initInlineEdit: vi.fn(),
  addInlineEditStyles: vi.fn()
}));

vi.mock('../src/features/gantt/critical-path.js', () => ({
  initCriticalPath: vi.fn()
}));


vi.mock('../src/features/selection/selectionManager.js', () => ({
  updateSelectedTasksUI: vi.fn(),
  applySelectionStyles: vi.fn()
}));

vi.mock('../src/features/gantt/navigation.js', () => ({
  initNavigation: vi.fn()
}));

vi.mock('../src/features/gantt/markers.js', () => ({
  initMarkers: vi.fn()
}));

vi.mock('../src/data/tasks.js', () => ({
  defaultTasks: { data: [], links: [] }
}));

// 模拟 gantt 全局对象
global.gantt = {
  config: {
    date_format: "%Y-%m-%d",
    xml_date: "%Y-%m-%d",
    row_height: 50,
    scale_height: 40,
    scales: [],
    layout: {},
    columns: [],
    lightbox: {
      sections: []
    }
  },
  i18n: {
    setLocale: vi.fn()
  },
  templates: {},
  init: vi.fn(),
  parse: vi.fn(),
  attachEvent: vi.fn((event, handler) => {
    return true;
  }),
  eachTask: vi.fn(),
  getTask: vi.fn(),
  updateTask: vi.fn(),
  hideLightbox: vi.fn(),
  getLightbox: vi.fn(() => ({ sections: [] })),
  render: vi.fn(),
  plugins: vi.fn(),
  setWorkTime: vi.fn(),
  $grid: document.createElement('div'),
  $grid_scale: document.createElement('div')
};

// 模拟 localStorage
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};

// 模拟 Sortable (SortableJS)
global.Sortable = vi.fn(() => ({
  destroy: vi.fn()
}));
