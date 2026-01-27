import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEditorType } from '../../src/features/gantt/inline-edit.js';
import { state } from '../../src/core/store.js';

const originalCustomFields = state.customFields.slice();
const originalOverrides = { ...state.systemFieldSettings.typeOverrides };

beforeEach(() => {
  state.customFields = [...originalCustomFields];
  state.systemFieldSettings.typeOverrides = { ...originalOverrides };
});

afterEach(() => {
  state.customFields = [...originalCustomFields];
  state.systemFieldSettings.typeOverrides = { ...originalOverrides };
});

describe('getEditorType', () => {
  it('uses system field type overrides for assignee', () => {
    state.systemFieldSettings.typeOverrides.assignee = 'multiselect';
    expect(getEditorType('assignee')).toBe('multiselect');
  });

  it('returns system field default type when no override', () => {
    delete state.systemFieldSettings.typeOverrides.assignee;
    expect(getEditorType('assignee')).toBe('select');
  });

  it('maps custom field types', () => {
    state.customFields.push({ name: 'custom-date', type: 'date' });
    expect(getEditorType('custom-date')).toBe('date');
  });

  it('supports datetime editor for system fields', () => {
    state.systemFieldSettings.typeOverrides.start_date = 'datetime';
    expect(getEditorType('start_date')).toBe('datetime');
  });
});
