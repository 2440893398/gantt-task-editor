/**
 * Field management tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  openFieldManagementPanel,
  closeFieldManagementPanel,
  renderFieldList,
  editField,
  deleteField,
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

// Mock showConfirmDialog to capture calls
// By default auto-confirm; set autoConfirm = false to simulate cancel
let autoConfirm = true;
const confirmDialogSpy = vi.fn();
vi.mock('../../src/components/common/confirm-dialog.js', () => ({
  showConfirmDialog: (opts) => {
    confirmDialogSpy(opts);
    if (autoConfirm) {
      opts.onConfirm?.();
    }
  },
  closeConfirmDialog: vi.fn()
}));

vi.mock('../../src/utils/i18n.js', () => ({
  i18n: {
    t: vi.fn((key, params) => {
      const map = {
        'fieldManagement.typeText': 'Text',
        'fieldManagement.typeNumber': 'Number',
        'fieldManagement.typeDate': 'Date',
        'fieldManagement.typeSelect': 'Select',
        'fieldManagement.typeMultiselect': 'Multi-select',
        'message.deleteConfirm': `Are you sure you want to delete field "${params?.name}"?`
      };
      return map[key] || key;
    })
  }
}));

describe('Field management panel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="field-management-panel"></div>
      <div id="field-management-backdrop" class="hidden opacity-0"></div>
      <div id="field-list-container"></div>
      <div id="field-config-modal"></div>
      <input id="field-name" />
      <select id="field-type">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="date">Date</option>
        <option value="select">Select</option>
        <option value="multiselect">Multi-select</option>
      </select>
      <input type="checkbox" id="field-required" />
      <input id="field-default-value" />
      <div id="options-config"></div>
      <div id="field-type-selector"><span class="field-type-text"></span></div>
      <div id="field-type-dropdown"></div>
      <div id="required-toggle"></div>
      <span id="field-type-icon"></span>
    `;

    state.customFields = [];
    state.fieldOrder = [];
  });

  it('opens the field management panel', () => {
    const panel = document.getElementById('field-management-panel');

    openFieldManagementPanel();

    expect(panel.classList.contains('open')).toBe(true);
  });

  it('closes the field management panel', () => {
    const panel = document.getElementById('field-management-panel');
    panel.classList.add('open');

    closeFieldManagementPanel();

    expect(panel.classList.contains('open')).toBe(false);
  });

  it('renders the field list', () => {
    state.customFields = [
      { name: 'custom_priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] },
      { name: 'custom_status', label: 'Status', type: 'text' }
    ];

    renderFieldList();

    const container = document.getElementById('field-list-container');
    expect(container.innerHTML).toContain('Priority');
    expect(container.innerHTML).toContain('Status');
  });

  it('renders custom field with correct label', () => {
    state.customFields = [
      { name: 'required_field', label: 'Required Field', type: 'text', required: true }
    ];

    renderFieldList();

    const container = document.getElementById('field-list-container');
    expect(container.innerHTML).toContain('Required Field');
    // Field item should have data-field-name attribute
    const fieldItem = container.querySelector('[data-field-name="required_field"]');
    expect(fieldItem).not.toBeNull();
  });
});

describe('Field type label', () => {
  it('returns correct labels', () => {
    expect(getFieldTypeLabel('text')).toBe('文本');
    expect(getFieldTypeLabel('number')).toBe('数字');
    expect(getFieldTypeLabel('date')).toBe('日期');
    expect(getFieldTypeLabel('select')).toBe('下拉选择');
    expect(getFieldTypeLabel('multiselect')).toBe('多选');
  });

  it('returns original value for unknown type', () => {
    expect(getFieldTypeLabel('unknown')).toBe('unknown');
  });
});

describe('Field edit', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="field-config-modal"></div>
      <div id="field-management-panel"></div>
      <input id="field-name" />
      <select id="field-type">
        <option value="text">Text</option>
        <option value="number">Number</option>
        <option value="date">Date</option>
        <option value="select">Select</option>
        <option value="multiselect">Multi-select</option>
      </select>
      <input type="checkbox" id="field-required" />
      <input id="field-default-value" />
      <div id="options-config"></div>
      <div id="options-list"></div>
      <div id="field-type-selector"><span class="field-type-text"></span></div>
      <div id="field-type-dropdown">
        <div class="field-type-option" data-value="text"></div>
        <div class="field-type-option" data-value="number"></div>
        <div class="field-type-option" data-value="select"></div>
      </div>
      <div id="required-toggle"></div>
      <span id="field-type-icon"></span>
      <input id="field-icon" type="hidden" />
      <span id="selected-icon"></span>
      <div id="icon-grid"></div>
      <div id="default-value-input-container"></div>
    `;

    // Use a custom field name that is NOT in SYSTEM_FIELD_CONFIG
    state.customFields = [
      {
        name: 'custom_priority',
        label: 'Custom Priority',
        type: 'select',
        required: true,
        options: ['High', 'Medium', 'Low']
      }
    ];
  });

  it('loads field data for editing', () => {
    editField('custom_priority');

    expect(document.getElementById('field-name').value).toBe('Custom Priority');
    expect(document.getElementById('field-type').value).toBe('select');
    expect(document.getElementById('field-required').checked).toBe(true);
  });

  it('sets edit mode flags', () => {
    editField('custom_priority');

    const modal = document.getElementById('field-config-modal');
    expect(modal.dataset.editMode).toBe('true');
    expect(modal.dataset.editFieldName).toBe('custom_priority');
  });

  it('shows options config for select type', () => {
    editField('custom_priority');

    const optionsConfig = document.getElementById('options-config');
    expect(optionsConfig.style.display).toBe('block');
  });
});

describe('Field delete', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="field-list-container"></div>
      <div id="field-management-panel"></div>
    `;

    confirmDialogSpy.mockClear();
    autoConfirm = true;

    global.gantt = {
      ...global.gantt,
      config: { columns: [] }
    };

    state.customFields = [
      { name: 'custom_priority', label: 'Custom Priority', type: 'text' },
      { name: 'custom_status', label: 'Custom Status', type: 'text' }
    ];
    state.fieldOrder = ['custom_priority', 'custom_status'];
  });

  it('deletes the target field via confirm dialog', () => {
    deleteField('custom_priority');

    // showConfirmDialog was called
    expect(confirmDialogSpy).toHaveBeenCalledTimes(1);

    // onConfirm was auto-invoked by our mock, so field should be removed
    expect(state.customFields).toHaveLength(1);
    expect(state.customFields[0].name).toBe('custom_status');
  });

  it('shows confirm dialog with correct title', () => {
    deleteField('custom_priority');

    expect(confirmDialogSpy).toHaveBeenCalledTimes(1);
    const opts = confirmDialogSpy.mock.calls[0][0];
    expect(opts.icon).toBe('trash-2');
    expect(opts.variant).toBe('danger');
  });

  it('does not delete when user cancels confirm dialog', () => {
    autoConfirm = false;

    deleteField('custom_priority');

    // Confirm dialog was shown but onConfirm was not called
    expect(confirmDialogSpy).toHaveBeenCalledTimes(1);
    // Field should still exist
    expect(state.customFields).toHaveLength(2);

    autoConfirm = true; // restore default
  });
});

describe('Field reorder', () => {
  beforeEach(() => {
    state.customFields = [
      { name: 'field1', label: 'Field 1' },
      { name: 'field2', label: 'Field 2' },
      { name: 'field3', label: 'Field 3' }
    ];
  });

  it('reorders fields correctly', () => {
    reorderFields(0, 2);

    expect(state.customFields[0].name).toBe('field2');
    expect(state.customFields[1].name).toBe('field3');
    expect(state.customFields[2].name).toBe('field1');
  });

  it('updates field order list', () => {
    reorderFields(0, 2);

    expect(state.fieldOrder).toContain('field1');
    expect(state.fieldOrder).toContain('field2');
    expect(state.fieldOrder).toContain('field3');
  });
});

describe('Field type selector updates', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="field-type-selector"><span class="field-type-text"></span></div>
      <span id="field-type-icon"></span>
      <div id="field-type-dropdown">
        <div class="field-type-option" data-value="text"></div>
        <div class="field-type-option" data-value="number"></div>
        <div class="field-type-option" data-value="date"></div>
      </div>
      <div id="default-value-input-container"></div>
    `;
  });

  it('updates selector display', () => {
    updateFieldTypeSelector('number');

    const textEl = document.querySelector('.field-type-text');
    expect(textEl.textContent).toBe('Number');
  });

  it('updates dropdown selected state', () => {
    updateFieldTypeSelector('number');

    const dropdown = document.getElementById('field-type-dropdown');
    const selectedOption = dropdown.querySelector('[data-value="number"]');
    expect(selectedOption.classList.contains('bg-primary/10')).toBe(true);
    expect(selectedOption.classList.contains('text-primary')).toBe(true);
  });
});
