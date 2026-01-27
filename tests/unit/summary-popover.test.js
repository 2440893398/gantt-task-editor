import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/utils/dom.js', () => ({
  showSummaryPopover: vi.fn(),
  hideSummaryPopover: vi.fn()
}));

import { initSummaryPopover } from '../../src/features/gantt/summary-popover.js';
import { showSummaryPopover, hideSummaryPopover } from '../../src/utils/dom.js';

describe('initSummaryPopover', () => {
  let grid;

  beforeEach(() => {
    grid = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(grid);
  });

  it('shows and hides popover on hover', () => {
    const cell = document.createElement('div');
    cell.className = 'gantt-summary-cell';
    cell.dataset.summaryHtml = '<p>Hi</p>';
    grid.appendChild(cell);

    initSummaryPopover({ grid });

    cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(showSummaryPopover).toHaveBeenCalledWith(cell, '<p>Hi</p>');

    cell.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
    expect(hideSummaryPopover).toHaveBeenCalled();
  });
});
