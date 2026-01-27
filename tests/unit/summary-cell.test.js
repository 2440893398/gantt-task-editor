import { describe, it, expect, beforeAll, vi } from 'vitest';

let buildSummaryCell;

beforeAll(async () => {
  ({ buildSummaryCell } = await vi.importActual('../../src/features/gantt/columns.js'));
});

describe('buildSummaryCell', () => {
  it('renders plain text and stores html for popover', () => {
    const html = '<p>Hello <strong>World</strong></p>';
    const result = buildSummaryCell(html, { emptyText: 'No summary' });

    expect(result).toContain('gantt-summary-cell');
    expect(result).toContain('Hello World');
    expect(result).toContain('data-summary-html="&lt;p&gt;Hello &lt;strong&gt;World&lt;/strong&gt;&lt;/p&gt;"');
  });

  it('truncates long text to 50 chars with ellipsis', () => {
    const html = '<p>' + 'a'.repeat(60) + '</p>';
    const result = buildSummaryCell(html, { emptyText: 'No summary' });

    expect(result).toContain('a'.repeat(50));
    expect(result).toContain('...');
  });

  it('renders empty text when summary is empty', () => {
    const result = buildSummaryCell('', { emptyText: 'No summary' });

    expect(result).toContain('No summary');
  });
});
