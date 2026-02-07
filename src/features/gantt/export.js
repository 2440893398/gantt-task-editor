// src/features/gantt/export.js
import { showToast } from '../../utils/toast.js';

/**
 * Export to Excel (using DHTMLX built-in if available)
 */
export function exportToExcel() {
    if (gantt.exportToExcel) {
        gantt.exportToExcel({
            name: `gantt_export_${new Date().toISOString().slice(0, 10)}.xlsx`
        });
    } else {
        showToast('Export to Excel service not available', 'warning');
    }
}
