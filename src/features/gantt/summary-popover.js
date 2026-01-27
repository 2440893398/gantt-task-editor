import { showSummaryPopover, hideSummaryPopover } from '../../utils/dom.js';

/**
 * 初始化摘要弹窗事件
 * @param {object} options
 * @param {HTMLElement} options.grid
 */
export function initSummaryPopover({ grid = gantt?.$grid } = {}) {
    if (!grid) return;

    let activeCell = null;

    grid.addEventListener('mouseover', (e) => {
        const cell = e.target.closest('.gantt-summary-cell');
        if (!cell || !grid.contains(cell) || cell === activeCell) return;

        activeCell = cell;
        const html = cell.dataset.summaryHtml || '';
        if (html) {
            showSummaryPopover(cell, html);
        }
    });

    grid.addEventListener('mouseout', (e) => {
        const cell = e.target.closest('.gantt-summary-cell');
        if (!cell || !grid.contains(cell)) return;

        if (cell.contains(e.relatedTarget)) return;

        activeCell = null;
        hideSummaryPopover();
    });
}
