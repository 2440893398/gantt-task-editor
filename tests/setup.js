/**
 * Vitest 测试环境设置
 */

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
  configureLightbox: vi.fn()
}));

// Mock 其他可能被导入的模块
vi.mock('../src/features/gantt/resizer.js', () => ({
  initResizer: vi.fn()
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
  plugins: vi.fn(),
  setWorkTime: vi.fn(),
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

if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
}
