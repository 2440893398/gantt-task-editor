/**
 * 字段管理功能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  openFieldManagementPanel,
  closeFieldManagementPanel,
  renderFieldList,
  editField,
  deleteField,
  confirmDeleteField,
  cancelDeleteField,
  getFieldTypeLabel,
  updateFieldTypeSelector
} from '../../src/features/customFields/manager.js';
import {
  state,
  addCustomField,
  removeCustomField,
  getCustomFieldByName,
  reorderFields
} from '../../src/core/store.js';

// Mock i18n
vi.mock('../../src/utils/i18n.js', () => ({
  i18n: {
    t: vi.fn((key, params) => {
      const map = {
        'fieldManagement.typeText': '文本',
        'fieldManagement.typeNumber': '数字',
        'fieldManagement.typeDate': '日期',
        'fieldManagement.typeSelect': '下拉选择',
        'fieldManagement.typeMultiselect': '多选',
        'fieldManagement.deleteMessage': `Are you sure you want to delete field "${params?.name}"?`
      };
      return map[key] || key;
    })
  }
}));

describe('字段管理面板', () => {
  beforeEach(() => {
    // 设置 DOM
    document.body.innerHTML = `
      <div id="field-management-panel"></div>
      <div id="field-list-container"></div>
      <div id="field-config-modal"></div>
      <input id="field-name" />
      <select id="field-type">
        <option value="text">文本</option>
        <option value="number">数字</option>
        <option value="date">日期</option>
        <option value="select">下拉选择</option>
        <option value="multiselect">多选</option>
      </select>
      <input id="field-icon" />
      <span id="selected-icon"></span>
      <div id="icon-grid"></div>
      <input type="checkbox" id="field-required" />
      <input id="field-default-value" />
      <div id="options-config"></div>
      <div id="field-type-selector"></div>
      <div id="field-type-dropdown"></div>
      <div id="required-toggle"></div>
    `;

    // 重置状态
    state.customFields = [];
    state.fieldOrder = [];
  });

  it('应该打开字段管理面板', () => {
    const panel = document.getElementById('field-management-panel');

    openFieldManagementPanel();

    expect(panel.classList.contains('open')).toBe(true);
  });

  it('应该关闭字段管理面板', () => {
    const panel = document.getElementById('field-management-panel');
    panel.classList.add('open');

    closeFieldManagementPanel();

    expect(panel.classList.contains('open')).toBe(false);
  });

  it('应该渲染字段列表', () => {
    state.customFields = [
      { name: 'custom_priority', label: '优先级', type: 'select', options: ['高', '中', '低'] },
      { name: 'custom_status', label: '状态', type: 'text' }
    ];
    state.fieldOrder = ['custom_priority', 'custom_status'];

    renderFieldList();

    const container = document.getElementById('field-list-container');
    expect(container.innerHTML).toContain('优先级');
    expect(container.innerHTML).toContain('状态');
  });

  it('应该显示必填字段标记', () => {
    state.customFields = [
      { name: 'required_field', label: '必填字段', type: 'text', required: true }
    ];
    state.fieldOrder = ['required_field'];

    renderFieldList();

    const container = document.getElementById('field-list-container');
    expect(container.innerHTML).toContain('必填字段');
    expect(container.innerHTML).toContain('*');
  });
});

describe('字段类型标签', () => {
  it('应该返回正确的字段类型标签', () => {
    expect(getFieldTypeLabel('text')).toBe('文本');
    expect(getFieldTypeLabel('number')).toBe('数字');
    expect(getFieldTypeLabel('date')).toBe('日期');
    expect(getFieldTypeLabel('select')).toBe('下拉选择');
    expect(getFieldTypeLabel('multiselect')).toBe('多选');
  });

  it('应该为未知类型返回原值', () => {
    expect(getFieldTypeLabel('unknown')).toBe('unknown');
  });
});

describe('字段编辑', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="field-config-modal"></div>
      <input id="field-name" />
      <select id="field-type">
        <option value="text">文本</option>
        <option value="number">数字</option>
        <option value="date">日期</option>
        <option value="select">下拉选择</option>
        <option value="multiselect">多选</option>
      </select>
      <input id="field-icon" />
      <span id="selected-icon"></span>
      <div id="icon-grid"></div>
      <input type="checkbox" id="field-required" />
      <input id="field-default-value" />
      <div id="options-config"></div>
      <div id="options-list"></div>
      <div id="field-type-selector"></div>
      <div id="field-type-dropdown">
        <div class="field-type-option" data-value="text"></div>
        <div class="field-type-option" data-value="number"></div>
      </div>
      <div id="required-toggle"></div>
    `;

    state.customFields = [
      {
        name: 'custom_priority',
        label: '优先级',
        type: 'select',
        required: true,
        options: ['高', '中', '低']
      }
    ];
  });

  it('应该加载字段进行编辑', () => {
    editField('custom_priority');

    expect(document.getElementById('field-name').value).toBe('优先级');
    expect(document.getElementById('field-type').value).toBe('select');
    expect(document.getElementById('field-required').checked).toBe(true);
  });

  it('应该设置编辑模式标记', () => {
    editField('custom_priority');

    const modal = document.getElementById('field-config-modal');
    expect(modal.dataset.editMode).toBe('true');
    expect(modal.dataset.editFieldName).toBe('custom_priority');
  });

  it('应该显示选项配置面板（下拉选择类型）', () => {
    editField('custom_priority');

    const optionsConfig = document.getElementById('options-config');
    expect(optionsConfig.style.display).toBe('block');
  });
});

describe('字段删除', () => {
  beforeEach(() => {
    // 设置必要的 DOM 元素
    document.body.innerHTML = `
      <div id="field-list-container"></div>
      <div id="field-management-panel"></div>
      <dialog id="delete-confirm-modal"></dialog>
      <div id="delete-confirm-message"></div>
    `;

    const confirmModal = document.getElementById('delete-confirm-modal');
    confirmModal.showModal = vi.fn();
    confirmModal.close = vi.fn();

    global.gantt = {
      ...global.gantt,
      config: { columns: [] }
    };

    state.customFields = [
      { name: 'custom_priority', label: '优先级', type: 'text' },
      { name: 'custom_status', label: '状态', type: 'text' }
    ];
    state.fieldOrder = ['custom_priority', 'custom_status'];
  });

  it('应该删除指定字段', () => {
    deleteField('custom_priority');
    confirmDeleteField();

    expect(state.customFields).toHaveLength(1);
    expect(state.customFields[0].name).toBe('custom_status');
    expect(state.fieldOrder).not.toContain('custom_priority');
  });

  it('应该在删除前请求确认', () => {
    deleteField('custom_priority');

    const confirmModal = document.getElementById('delete-confirm-modal');
    const message = document.getElementById('delete-confirm-message');
    expect(confirmModal.showModal).toHaveBeenCalled();
    expect(message.textContent).toBe('Are you sure you want to delete field "优先级"?');
  });

  it('应该在用户取消时不删除字段', () => {
    deleteField('custom_priority');
    cancelDeleteField();

    expect(state.customFields).toHaveLength(2);
  });
});

describe('字段重排序', () => {
  beforeEach(() => {
    state.customFields = [
      { name: 'field1', label: '字段1' },
      { name: 'field2', label: '字段2' },
      { name: 'field3', label: '字段3' }
    ];
  });

  it('应该正确重排序字段', () => {
    reorderFields(0, 2);

    expect(state.customFields[0].name).toBe('field2');
    expect(state.customFields[1].name).toBe('field3');
    expect(state.customFields[2].name).toBe('field1');
  });

  it('应该更新字段顺序数组', () => {
    reorderFields(0, 2);

    expect(state.fieldOrder).toContain('field1');
    expect(state.fieldOrder).toContain('field2');
    expect(state.fieldOrder).toContain('field3');
  });
});

describe('字段类型选择器更新', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="field-type-selector">
        <span id="field-type-icon"></span>
        <span class="field-type-text"></span>
      </div>
      <div id="field-type-dropdown">
        <div class="field-type-option" data-value="text"></div>
        <div class="field-type-option" data-value="number"></div>
        <div class="field-type-option" data-value="date"></div>
      </div>
    `;
  });

  it('应该更新选择器显示', () => {
    updateFieldTypeSelector('number');

    const selector = document.getElementById('field-type-selector');
    const label = selector.querySelector('.field-type-text');
    expect(label.textContent).toContain('数字');
  });

  it('应该更新下拉菜单选中状态', () => {
    updateFieldTypeSelector('number');

    const dropdown = document.getElementById('field-type-dropdown');
    const selectedOption = dropdown.querySelector('[data-value="number"]');
    expect(selectedOption.classList.contains('text-primary')).toBe(true);
    expect(selectedOption.querySelector('.check-icon')).not.toBeNull();
  });
});
