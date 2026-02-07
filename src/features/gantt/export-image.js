// src/features/gantt/export-image.js
// Using DHTMLX Gantt native export API for better performance and fidelity

import { showToast } from '../../utils/toast.js';
import i18n from '../../utils/i18n.js';

const OVERLAY_ID = 'export-progress-overlay';

/**
 * Show progress overlay
 * @param {string} message
 */
function showProgress(message) {
    if (document.getElementById(OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    overlay.innerHTML = `
        <div class="bg-base-100 rounded-lg p-6 shadow-xl text-center">
            <div class="loading loading-spinner loading-lg text-primary mb-4"></div>
            <div class="text-lg font-semibold">${message}</div>
            <div class="text-sm text-base-content/60 mt-2">${i18n.t('export.serverProcessing')}</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

/**
 * Hide progress overlay
 */
function hideProgress() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
}

/**
 * Check if DHTMLX export API is available
 * @returns {boolean}
 */
function isExportApiAvailable() {
    return typeof gantt !== 'undefined' && typeof gantt.exportToPNG === 'function';
}

/**
 * Export current viewport as PNG using DHTMLX native API
 */
export async function exportCurrentView() {
    if (!isExportApiAvailable()) {
        showToast(i18n.t('export.apiNotAvailable'), 'error');
        console.error('DHTMLX export API not available. Make sure https://export.dhtmlx.com/gantt/api.js is loaded.');
        return;
    }

    showProgress(i18n.t('export.capturing'));

    try {
        const filename = `gantt-view-${new Date().toISOString().slice(0, 10)}.png`;

        gantt.exportToPNG({
            name: filename,
            raw: true, // Export custom styles and markup
            callback: (result) => {
                hideProgress();
                if (result && result.url) {
                    // Trigger download
                    const link = document.createElement('a');
                    link.href = result.url;
                    link.download = filename;
                    link.click();
                    showToast(i18n.t('export.success'), 'success');
                } else {
                    showToast(i18n.t('export.error'), 'error');
                }
            }
        });
    } catch (error) {
        hideProgress();
        showToast(`${i18n.t('export.error')}: ${error.message}`, 'error');
        console.error('Export error:', error);
    }
}

/**
 * Export full gantt chart as PNG using DHTMLX native API
 * For large charts, uses sliced export
 */
export async function exportFullGantt() {
    if (!isExportApiAvailable()) {
        showToast(i18n.t('export.apiNotAvailable'), 'error');
        console.error('DHTMLX export API not available. Make sure https://export.dhtmlx.com/gantt/api.js is loaded.');
        return;
    }

    showProgress(i18n.t('export.preparing'));

    try {
        const filename = `gantt-full-${new Date().toISOString().slice(0, 10)}.png`;

        // Get the full date range of all tasks
        const state = gantt.getState();
        const startDate = gantt.date.date_to_str('%d-%m-%Y')(state.min_date);
        const endDate = gantt.date.date_to_str('%d-%m-%Y')(state.max_date);

        gantt.exportToPNG({
            name: filename,
            start: startDate,
            end: endDate,
            raw: true, // Export custom styles and markup
            callback: (result) => {
                hideProgress();
                if (result && result.url) {
                    // Trigger download
                    const link = document.createElement('a');
                    link.href = result.url;
                    link.download = filename;
                    link.click();
                    showToast(i18n.t('export.success'), 'success');
                } else {
                    showToast(i18n.t('export.error'), 'error');
                }
            }
        });
    } catch (error) {
        hideProgress();
        showToast(`${i18n.t('export.error')}: ${error.message}`, 'error');
        console.error('Export error:', error);
    }
}

/**
 * Export gantt chart to PDF using DHTMLX native API
 */
export async function exportToPDF() {
    if (!isExportApiAvailable()) {
        showToast(i18n.t('export.apiNotAvailable'), 'error');
        console.error('DHTMLX export API not available.');
        return;
    }

    showProgress(i18n.t('export.preparing'));

    try {
        const filename = `gantt-${new Date().toISOString().slice(0, 10)}.pdf`;

        gantt.exportToPDF({
            name: filename,
            raw: true,
            callback: (result) => {
                hideProgress();
                if (result && result.url) {
                    const link = document.createElement('a');
                    link.href = result.url;
                    link.download = filename;
                    link.click();
                    showToast(i18n.t('export.success'), 'success');
                } else {
                    showToast(i18n.t('export.error'), 'error');
                }
            }
        });
    } catch (error) {
        hideProgress();
        showToast(`${i18n.t('export.error')}: ${error.message}`, 'error');
        console.error('Export error:', error);
    }
}
