/**
 * 配置导入导出功能
 */

import { state } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { refreshLightbox } from '../lightbox/customization.js';

/**
 * 导出配置
 */
export function exportConfig() {
    const config = {
        customFields: state.customFields,
        fieldOrder: state.fieldOrder,
        exportTime: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gantt-fields-config.json';
    a.click();
    URL.revokeObjectURL(url);

    showToast('配置导出成功', 'success');
}

/**
 * 导入配置
 */
export function importConfig(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const config = JSON.parse(e.target.result);
            if (config.customFields && config.fieldOrder) {
                state.customFields = config.customFields;
                state.fieldOrder = config.fieldOrder;
                updateGanttColumns();
                refreshLightbox();
                showToast('配置导入成功', 'success');
            } else {
                showToast('配置文件格式不正确', 'error', 3000);
            }
        } catch (error) {
            showToast('配置文件解析失败: ' + error.message, 'error', 3000);
        }
    };
    reader.readAsText(file);
}

/**
 * 初始化配置导入导出
 */
export function initConfigIO() {
    // 导出配置
    document.getElementById('config-export-btn').addEventListener('click', exportConfig);

    // 导入配置
    document.getElementById('config-import-btn').addEventListener('click', function () {
        document.getElementById('config-file-input').click();
    });

    document.getElementById('config-file-input').addEventListener('change', function (e) {
        importConfig(e.target.files[0]);
        this.value = ''; // 重置以便再次选择同一文件
    });
}
