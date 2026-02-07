// src/features/gantt/snapping.js

/**
 * Initialize smart snapping using DHTMLX built-in behavior
 */
export function initSnapping() {
    if (typeof gantt === 'undefined') return;

    gantt.config.round_dnd_dates = true;
    gantt.config.duration_step = 1;
}
