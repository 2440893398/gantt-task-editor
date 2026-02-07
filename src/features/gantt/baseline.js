// src/features/gantt/baseline.js
import { saveBaseline, loadBaseline, hasBaseline } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import i18n from '../../utils/i18n.js';

let baselineLayer = null;
let isBaselineVisible = false;

/**
 * Initialize baseline feature
 * Adds task layer for rendering baseline bars
 */
export function initBaseline() {
    if (gantt.addTaskLayer) {
        baselineLayer = gantt.addTaskLayer({
            renderer: {
                render: function (task) {
                    if (!task.baseline_start || !task.baseline_end) return false;
                    if (!isBaselineVisible) return false;

                    const sizes = gantt.getTaskPosition(
                        task,
                        new Date(task.baseline_start),
                        new Date(task.baseline_end)
                    );

                    const el = document.createElement('div');
                    el.className = 'baseline-bar';
                    el.style.left = sizes.left + 'px';
                    el.style.width = sizes.width + 'px';
                    el.style.height = '6px'; // Slightly thinner than plan
                    el.style.top = '28px'; // Just below main bar

                    // Add rounded corners
                    el.style.borderRadius = '3px';

                    return el;
                },
                getRectangle: function (task) {
                    if (!task.baseline_start || !task.baseline_end) return null;

                    return gantt.getTaskPosition(
                        task,
                        new Date(task.baseline_start),
                        new Date(task.baseline_end)
                    );
                }
            }
        });
    } else {
        console.warn('gantt.addTaskLayer not available. Baseline display disabled.');
    }

    // Load baseline state from localStorage
    isBaselineVisible = localStorage.getItem('show_baseline') === 'true';

    // Load baseline data if exists
    loadBaselineData();
}

/**
 * Save current project state as baseline
 */
export async function handleSaveBaseline() {
    const confirmed = confirm(i18n.t('baseline.saveConfirm'));
    if (!confirmed) return;

    const snapshot = gantt.serialize();

    // Clean up snapshot to only keep essential data for baseline
    snapshot.data.forEach(task => {
        // Ensure dates are strings
        if (task.start_date instanceof Date) task.start_date = gantt.date.date_to_str('%Y-%m-%d')(task.start_date);
        if (task.end_date instanceof Date) task.end_date = gantt.date.date_to_str('%Y-%m-%d')(task.end_date);
    });

    await saveBaseline(snapshot);

    const date = new Date().toLocaleString();
    showToast(i18n.t('baseline.saved') + ` (${date})`, 'success');

    // Load baseline data to update display
    await loadBaselineData();
    if (isBaselineVisible) {
        gantt.render();
    }
}

/**
 * Toggle baseline visibility
 */
export function handleToggleBaseline(checked) {
    isBaselineVisible = checked;
    localStorage.setItem('show_baseline', String(checked));
    gantt.render();
}

/**
 * Load baseline data and merge into tasks
 */
async function loadBaselineData() {
    const baseline = await loadBaseline();
    if (!baseline) return;

    const baselineMap = new Map();
    baseline.snapshot.data.forEach(task => {
        baselineMap.set(task.id, {
            baseline_start: task.start_date,
            baseline_end: task.end_date,
            baseline_duration: task.duration
        });
    });

    // Merge baseline data into current tasks
    gantt.eachTask(task => {
        const baselineData = baselineMap.get(task.id);
        if (baselineData) {
            Object.assign(task, baselineData);
        }
    });
}
