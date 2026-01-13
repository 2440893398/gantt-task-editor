/**
 * 配置导入导出功能
 */

import * as XLSX from 'xlsx';
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
    a.dispatchEvent(new MouseEvent('click'));
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
 * 导出Excel (带下拉字段数据验证)
 */
export function exportToExcel() {
    try {
        // 获取所有任务数据
        const tasks = gantt.serialize().data;

        // 准备表头
        const headers = ['任务ID', '任务名称', '开始时间', '工期(天)', '进度(%)', '父任务ID'];

        // 添加自定义字段到表头
        state.customFields.forEach(field => {
            headers.push(field.label || field.name);
        });

        // 准备数据行
        const rows = [headers];

        tasks.forEach(task => {
            // 安全处理日期格式
            let startDateStr = '';
            if (task.start_date) {
                if (typeof task.start_date === 'string') {
                    startDateStr = task.start_date;
                } else if (task.start_date instanceof Date) {
                    startDateStr = gantt.date.date_to_str('%Y-%m-%d')(task.start_date);
                }
            }

            const row = [
                task.id,
                task.text,
                startDateStr,
                task.duration || 0,
                Math.round((task.progress || 0) * 100),
                task.parent || ''
            ];

            // 添加自定义字段数据
            state.customFields.forEach(field => {
                row.push(task[field.id] || task[field.name] || '');
            });

            rows.push(row);
        });

        // 创建工作簿和工作表
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);

        // 设置列宽
        const colWidths = headers.map(() => ({ wch: 15 }));
        ws['!cols'] = colWidths;

        // 为下拉字段添加数据验证
        const dataValidations = [];
        state.customFields.forEach((field, fieldIndex) => {
            if (field.type === 'select' || field.type === 'multiselect') {
                const colIndex = 6 + fieldIndex; // 前6列是固定列
                const colLetter = XLSX.utils.encode_col(colIndex);

                // 数据验证适用于第2行到第1000行（排除表头）
                const sqref = `${colLetter}2:${colLetter}1000`;

                // 选项用逗号分隔
                const options = (field.options || []).join(',');

                dataValidations.push({
                    type: 'list',
                    sqref: sqref,
                    formula1: `"${options}"`,
                    showDropDown: true,
                    allowBlank: !field.required,
                    errorStyle: 'warning',
                    errorTitle: '无效输入',
                    error: `请从列表中选择有效的选项`
                });
            }
        });

        // 应用数据验证到工作表
        if (dataValidations.length > 0) {
            ws['!dataValidation'] = dataValidations;
        }

        XLSX.utils.book_append_sheet(wb, ws, '任务列表');

        // 导出文件
        const filename = `gantt-tasks-${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, filename);

        showToast('Excel导出成功', 'success');
    } catch (error) {
        console.error('Excel导出失败:', error);
        showToast('Excel导出失败: ' + error.message, 'error');
    }
}

/**
 * 导入Excel
 */
export function importFromExcel(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });

            // 读取第一个工作表
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

            if (rows.length < 2) {
                showToast('Excel文件格式错误：没有数据行', 'error');
                return;
            }

            const headers = rows[0];
            const dataRows = rows.slice(1);

            // 验证必要列
            const requiredColumns = ['任务ID', '任务名称', '开始时间', '工期(天)', '进度(%)'];
            const missingColumns = requiredColumns.filter(col => !headers.includes(col));
            if (missingColumns.length > 0) {
                showToast(`Excel文件缺少必要列: ${missingColumns.join(', ')}`, 'error');
                return;
            }

            // 解析数据
            const tasks = [];
            const columnMap = {};
            headers.forEach((header, index) => {
                columnMap[header] = index;
            });

            dataRows.forEach((row, index) => {
                if (!row || row.length === 0) return;

                try {
                    const task = {
                        id: row[columnMap['任务ID']],
                        text: row[columnMap['任务名称']] || '',
                        start_date: gantt.date.str_to_date('%Y-%m-%d')(row[columnMap['开始时间']]),
                        duration: parseInt(row[columnMap['工期(天)']]) || 1,
                        progress: (parseInt(row[columnMap['进度(%)']]) || 0) / 100
                    };

                    // 父任务ID
                    if (row[columnMap['父任务ID']]) {
                        task.parent = row[columnMap['父任务ID']];
                    }

                    // 自定义字段
                    state.customFields.forEach(field => {
                        if (columnMap[field.name] !== undefined) {
                            task[field.id] = row[columnMap[field.name]];
                        }
                    });

                    tasks.push(task);
                } catch (error) {
                    console.warn(`解析第 ${index + 2} 行失败:`, error);
                }
            });

            if (tasks.length === 0) {
                showToast('没有有效的任务数据', 'error');
                return;
            }

            // 批量更新（性能优化）
            gantt.batchUpdate(() => {
                gantt.clearAll();
                gantt.parse({ data: tasks });
            });

            showToast(`成功导入 ${tasks.length} 个任务`, 'success');
        } catch (error) {
            console.error('Excel导入失败:', error);
            showToast('Excel导入失败: ' + error.message, 'error');
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * 初始化配置导入导出
 */
export function initConfigIO() {
    // JSON导出 (备用)
    document.getElementById('config-export-btn').addEventListener('click', exportConfig);

    // Excel导出
    document.getElementById('dropdown-export-excel')?.addEventListener('click', exportToExcel);

    // Excel导入
    document.getElementById('dropdown-import-excel')?.addEventListener('click', function () {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx, .xls';
        input.onchange = (e) => {
            importFromExcel(e.target.files[0]);
        };
        input.click();
    });

    // JSON导入 (备用)
    document.getElementById('config-import-btn')?.addEventListener('click', function () {
        document.getElementById('config-file-input').click();
    });

    document.getElementById('config-file-input')?.addEventListener('change', function (e) {
        importConfig(e.target.files[0]);
        this.value = ''; // 重置以便再次选择同一文件
    });
}
