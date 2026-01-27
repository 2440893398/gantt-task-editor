import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractPlainText,
  escapeAttr,
  showSummaryPopover,
  hideSummaryPopover
} from '../../src/utils/dom.js';

describe('dom utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('extractPlainText strips html and normalizes whitespace', () => {
    expect(extractPlainText('<p>Hello <strong>World</strong></p>')).toBe('Hello World');
    expect(extractPlainText('  <div>Foo</div>   <span>Bar</span>  ')).toBe('Foo Bar');
    expect(extractPlainText(null)).toBe('');
  });

  it('escapeAttr escapes characters for attributes', () => {
    expect(escapeAttr('"Tom & Jerry\'s <tag>"')).toBe('&quot;Tom &amp; Jerry&#39;s &lt;tag&gt;&quot;');
  });

  it('showSummaryPopover renders and hideSummaryPopover removes', () => {
    const cell = document.createElement('div');
    document.body.appendChild(cell);
    cell.getBoundingClientRect = () => ({
      left: 10,
      right: 20,
      top: 10,
      bottom: 20,
      width: 10,
      height: 10
    });

    const popover = showSummaryPopover(cell, '<p>Hi</p>');
    expect(popover).toBeTruthy();
    expect(document.getElementById('summary-popover')).toBe(popover);
    expect(popover.querySelector('.ql-editor')?.textContent).toBe('Hi');

    showSummaryPopover(cell, '<p>Again</p>');
    const popovers = document.querySelectorAll('#summary-popover');
    expect(popovers.length).toBe(1);

    hideSummaryPopover();
    expect(document.getElementById('summary-popover')).toBeNull();
  });
});
