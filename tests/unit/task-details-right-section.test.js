import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../../src/core/store.js';
import { renderAssigneeField, validateDateRange } from '../../src/features/task-details/right-section.js';

const originalCustomFields = state.customFields.slice();
const originalOverrides = { ...state.systemFieldSettings.typeOverrides };

beforeEach(() => {
  state.customFields = [...originalCustomFields];
  state.systemFieldSettings.typeOverrides = { ...originalOverrides };
});

describe('task details right section', () => {
  it('renders assignee as text input when type is text', () => {
    state.systemFieldSettings.typeOverrides.assignee = 'text';
    const html = renderAssigneeField({ assignee: 'Alice' });
    expect(html).toContain('type="text"');
    expect(html).toContain('data-field="assignee"');
  });

  it('renders assignee as select when type is select', () => {
    state.systemFieldSettings.typeOverrides.assignee = 'select';
    state.customFields = state.customFields.map(f => f.name === 'assignee'
      ? { ...f, type: 'select', options: ['Alice', 'Bob'] }
      : f
    );
    const html = renderAssigneeField({ assignee: 'Bob' });
    expect(html).toContain('<select');
    expect(html).toContain('option value="Alice"');
    expect(html).toContain('option value="Bob"');
  });

  it('renders assignee as multiselect when type is multiselect', () => {
    state.systemFieldSettings.typeOverrides.assignee = 'multiselect';
    state.customFields = state.customFields.map(f => f.name === 'assignee'
      ? { ...f, type: 'multiselect', options: ['Alice', 'Bob'] }
      : f
    );
    const html = renderAssigneeField({ assignee: 'Alice,Bob' });
    expect(html).toContain('multiple');
    expect(html).toContain('data-field="assignee"');
  });

  it('validates actual date range correctly', () => {
    const ok = validateDateRange({ actual_start: '2025-01-01', actual_end: '2025-01-02' });
    const bad = validateDateRange({ actual_start: '2025-01-03', actual_end: '2025-01-02' });
    expect(ok).toBe(true);
    expect(bad).toBe(false);
  });
});
