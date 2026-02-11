/**
 * 配置导入导出功能
 * BUG-002: 使用 ExcelJS 替换 xlsx 以支持数据验证（下拉选项）
 */

import ExcelJS from 'exceljs';
import { state, isFieldEnabled, getSystemFieldOptions, getFieldType, getCustomFieldByName } from '../../core/store.js';
import { INTERNAL_FIELDS, SYSTEM_FIELD_CONFIG } from '../../data/fields.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { refreshLightbox } from '../lightbox/customization.js';
import { i18n } from '../../utils/i18n.js';
import { INTERNAL_PRIORITY_VALUES, INTERNAL_STATUS_VALUES } from '../../config/constants.js';

/**
 * 导出配置（仅字段定义）
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
 * 将数据通过浏览器原生 CompressionStream 进行 gzip 压缩
 * @param {string} text - 要压缩的文本
 * @returns {Promise<Blob>} 压缩后的 Blob
 */
async function compressData(text) {
    const blob = new Blob([text]);
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).blob();
}

/**
 * 将 gzip 压缩的 Blob/File 解压为文本
 * @param {Blob|File} blob - 压缩的数据
 * @returns {Promise<string>} 解压后的文本
 */
async function decompressData(blob) {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
}

/**
 * 导出完整系统备份（单个压缩文件，包含所有数据）
 */
export async function exportFullBackup() {
    try {
        // 获取所有数据
        const ganttData = gantt.serialize();

        // 获取 baseline 数据
        let baselineData = null;
        try {
            const { loadBaseline } = await import('../../core/store.js');
            const baseline = await loadBaseline();
            baselineData = baseline ? baseline.snapshot : null;
        } catch (error) {
            console.warn('[Backup] Could not load baseline:', error);
        }

        // 构建单一备份数据结构
        const backup = {
            version: "1.0.0",
            exportTime: new Date().toISOString(),
            metadata: {
                taskCount: ganttData.data.length,
                linkCount: ganttData.links.length,
                appVersion: "1.0.0"
            },
            data: {
                tasks: ganttData.data,
                links: ganttData.links,
                customFields: state.customFields,
                fieldOrder: state.fieldOrder,
                systemFieldSettings: state.systemFieldSettings,
                baseline: baselineData,
                preferences: {
                    locale: localStorage.getItem('gantt_locale'),
                    viewMode: state.viewMode,
                    gridWidth: localStorage.getItem('gantt_grid_width')
                }
            }
        };

        // JSON 不带缩进，减小体积
        const jsonStr = JSON.stringify(backup);

        // gzip 压缩
        const compressedBlob = await compressData(jsonStr);

        // 计算压缩率
        const originalSize = new Blob([jsonStr]).size;
        const compressedSize = compressedBlob.size;
        const ratio = Math.round((1 - compressedSize / originalSize) * 100);
        console.log(`[Backup] Compressed: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${ratio}% smaller)`);

        // 下载单个压缩文件
        const url = URL.createObjectURL(compressedBlob);
        const a = document.createElement('a');
        a.href = url;
        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `gantt-backup-${dateStr}.json.gz`;
        a.dispatchEvent(new MouseEvent('click'));
        URL.revokeObjectURL(url);

        showToast(
            `备份导出成功 (${backup.metadata.taskCount} 个任务, 压缩${ratio}%)`,
            'success'
        );
    } catch (error) {
        console.error('[Backup] Export failed:', error);
        showToast('备份导出失败: ' + error.message, 'error', 3000);
    }
}

/**
 * 验证备份文件格式
 * @param {Object} backup - 备份数据对象
 * @returns {Object} { valid: boolean, error: string }
 */
function validateBackup(backup) {
    if (!backup || typeof backup !== 'object') {
        return { valid: false, error: '备份文件格式不正确' };
    }

    // 检查版本
    if (!backup.version) {
        return { valid: false, error: '缺少版本信息' };
    }

    // 检查必要数据
    if (!backup.data) {
        return { valid: false, error: '缺少数据部分' };
    }

    // 验证任务数据
    if (!Array.isArray(backup.data.tasks)) {
        return { valid: false, error: '任务数据格式不正确' };
    }

    // 验证链接数据
    if (!Array.isArray(backup.data.links)) {
        return { valid: false, error: '链接数据格式不正确' };
    }

    return { valid: true };
}

/**
 * 从备份文件还原完整系统数据
 * 支持 .json.gz（压缩）和 .json（未压缩）两种格式
 * @param {File} file - 备份文件
 */
export async function importFullBackup(file) {
    if (!file) return;

    try {
        // 根据文件类型自动判断是否需要解压
        let text;
        if (file.name.endsWith('.gz')) {
            // gzip 压缩文件 → 解压
            text = await decompressData(file);
        } else {
            // 普通 JSON 文件
            text = await file.text();
        }
        const backup = JSON.parse(text);

        // 验证备份格式
        const validation = validateBackup(backup);
        if (!validation.valid) {
            showToast(validation.error, 'error', 3000);
            return;
        }

        // 兼容旧格式（只有字段配置）
        const isOldFormat = !backup.version && backup.customFields;
        if (isOldFormat) {
            showToast('检测到旧格式配置文件，仅恢复字段设置', 'warning', 3000);
            state.customFields = backup.customFields || [];
            state.fieldOrder = backup.fieldOrder || [];
            updateGanttColumns();
            refreshLightbox();
            showToast('配置恢复成功', 'success');
            return;
        }

        // 确认操作（会清除现有数据）
        const confirmed = confirm(
            `即将从备份还原数据:\n` +
            `- 任务: ${backup.metadata?.taskCount || backup.data.tasks.length} 个\n` +
            `- 链接: ${backup.metadata?.linkCount || backup.data.links.length} 个\n` +
            `- 自定义字段: ${backup.data.customFields?.length || 0} 个\n\n` +
            `警告: 这将覆盖当前所有数据，是否继续？`
        );

        if (!confirmed) {
            showToast('还原已取消', 'info');
            return;
        }

        // 还原任务和链接数据
        gantt.batchUpdate(() => {
            gantt.clearAll();
            gantt.parse({
                data: backup.data.tasks || [],
                links: backup.data.links || []
            });
        });

        // 还原字段配置
        if (backup.data.customFields) {
            state.customFields = backup.data.customFields;
        }
        if (backup.data.fieldOrder) {
            state.fieldOrder = backup.data.fieldOrder;
        }
        if (backup.data.systemFieldSettings) {
            state.systemFieldSettings = backup.data.systemFieldSettings;
        }

        // 持久化到存储
        const { saveGanttData } = await import('../../core/storage.js');
        const { persistCustomFields, persistSystemFieldSettings, persistLocale } = await import('../../core/store.js');
        
        await saveGanttData(gantt.serialize());
        persistCustomFields();
        persistSystemFieldSettings();

        // 还原 baseline（如果存在）
        if (backup.data.baseline) {
            try {
                const { saveBaseline } = await import('../../core/store.js');
                await saveBaseline(backup.data.baseline);
            } catch (error) {
                console.warn('[Backup] Could not restore baseline:', error);
            }
        }

        // 还原偏好设置
        if (backup.data.preferences) {
            // 还原语言设置
            if (backup.data.preferences.locale) {
                await i18n.setLanguage(backup.data.preferences.locale);
                persistLocale(backup.data.preferences.locale); // 持久化语言设置
            }
            // 还原视图模式
            if (backup.data.preferences.viewMode) {
                state.viewMode = backup.data.preferences.viewMode;
                const { saveViewMode } = await import('../../core/storage.js');
                saveViewMode(backup.data.preferences.viewMode); // 持久化视图模式
            }
        }

        // 刷新界面
        updateGanttColumns();
        refreshLightbox();

        showToast(
            `系统还原成功: ${backup.metadata?.taskCount || backup.data.tasks.length} 个任务`,
            'success',
            3000
        );
    } catch (error) {
        console.error('[Backup] Import failed:', error);
        showToast('系统还原失败: ' + error.message, 'error', 3000);
    }
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
 * 生成层级编号
 * @param {Object} task - 任务对象
 * @param {Object} taskMap - 任务ID到任务的映射
 * @param {Object} hierarchyCache - 层级缓存
 * @returns {string} 层级编号如 "1", "1.1", "1.1.1"
 */
function generateHierarchy(task, taskMap, hierarchyCache) {
    if (hierarchyCache[task.id]) {
        return hierarchyCache[task.id];
    }

    // 获取同级任务的排序（按照ID或创建顺序）
    const getSiblingIndex = (taskId, parentId) => {
        const siblings = Object.values(taskMap)
            .filter(t => (t.parent || 0) === parentId)
            .sort((a, b) => a.id - b.id);
        return siblings.findIndex(t => t.id === taskId) + 1;
    };

    if (!task.parent || task.parent === 0) {
        // 顶级任务
        const index = getSiblingIndex(task.id, 0);
        hierarchyCache[task.id] = String(index);
    } else {
        // 子任务
        const parentTask = taskMap[task.parent];
        if (parentTask) {
            const parentHierarchy = generateHierarchy(parentTask, taskMap, hierarchyCache);
            const siblingIndex = getSiblingIndex(task.id, task.parent);
            hierarchyCache[task.id] = `${parentHierarchy}.${siblingIndex}`;
        } else {
            hierarchyCache[task.id] = String(getSiblingIndex(task.id, task.parent));
        }
    }

    return hierarchyCache[task.id];
}

/**
 * 获取Excel导出的列名（本地化）
 * 优先使用i18n翻译，其次使用字段定义的label
 * @param {string} fieldName - 字段名
 * @returns {string} 本地化的列名
 */
function getExcelColumnName(fieldName) {
    // 1. Check if it's a system field with a specific i18n key override
    if (SYSTEM_FIELD_CONFIG[fieldName] && SYSTEM_FIELD_CONFIG[fieldName].i18nKey) {
        if (window.i18n && typeof window.i18n.t === 'function') {
            const key = SYSTEM_FIELD_CONFIG[fieldName].i18nKey;
            const translated = window.i18n.t(key);
            if (translated && translated !== key) {
                return translated;
            }
        }
    }

    // 2. Try default columns.${fieldName} (legacy/fallback)
    if (window.i18n && typeof window.i18n.t === 'function') {
        const translated = window.i18n.t(`columns.${fieldName}`);
        if (translated && translated !== `columns.${fieldName}`) {
            return translated;
        }
    }

    // 查找自定义字段定义获取label
    const customField = state.customFields.find(f => f.name === fieldName);
    if (customField && customField.label) {
        return customField.label;
    }

    // 返回字段名本身
    return fieldName;
}

/**
 * 获取所有语言的列名映射（用于导入识别）
 * @returns {Object} 映射对象 { '任务名称': 'text', 'Task Name': 'text', ... }
 */
function getAllColumnNameMappings() {
    const mapping = {};
    const allLocales = i18n.getAllLocales();

    // 内置字段
    const builtinFields = ['text', 'start_date', 'duration', 'progress', 'priority', 'assignee', 'status', 'hierarchy'];

    // 遍历每种语言
    Object.values(allLocales).forEach(lang => {
        if (!lang || !lang.columns) return;

        builtinFields.forEach(field => {
            if (lang.columns[field]) {
                mapping[lang.columns[field]] = field;
            }
        });
    });

    // 添加自定义字段（Label）
    state.customFields.forEach(field => {
        if (field.label) {
            mapping[field.label] = field.name;
        }
        mapping[field.name] = field.name; // 支持字段原名
    });

    return mapping;
}

/**
 * 获取本地化的枚举值（用于导出）
 * @param {string} fieldName 
 * @param {string} value 
 */
function getLocalizedEnumValue(fieldName, value) {
    if (!value) return '';
    // 仅处理 priority 和 status
    if ((fieldName === 'priority' || fieldName === 'status') && window.i18n) {
        // 尝试从 i18n 获取翻译
        const translated = window.i18n.t(`enums.${fieldName}.${value}`);
        if (translated && translated !== `enums.${fieldName}.${value}`) {
            return translated;
        }
    }
    return value;
}

/**
 * 枚举值反向映射表 - 用于将所有语言的显示值转换为内部值
 * 支持中文、英文、日文、韩文
 */
const ENUM_REVERSE_MAP = {
    priority: {
        // 中文
        '高': 'high', '中': 'medium', '低': 'low',
        // 英文（包括首字母大写和全小写）
        'High': 'high', 'Medium': 'medium', 'Low': 'low',
        'HIGH': 'high', 'MEDIUM': 'medium', 'LOW': 'low',
        // 日文（与中文相同的字符）
        // '高': 'high', '中': 'medium', '低': 'low', // 已包含
        // 韩文
        '높음': 'high', '중간': 'medium', '낮음': 'low',
        // 内部值（原样返回）
        'high': 'high', 'medium': 'medium', 'low': 'low'
    },
    status: {
        // 中文
        '待开始': 'pending', '进行中': 'in_progress', '已完成': 'completed', '已取消': 'suspended',
        // 英文（包括多种大小写形式）
        'Pending': 'pending', 'In Progress': 'in_progress', 'Completed': 'completed', 'Cancelled': 'suspended',
        'PENDING': 'pending', 'IN PROGRESS': 'in_progress', 'COMPLETED': 'completed', 'CANCELLED': 'suspended',
        // 日文
        '未着手': 'pending', '進行中': 'in_progress', '完了': 'completed', 'キャンセル': 'suspended',
        // 韩文
        '대기중': 'pending', '진행중': 'in_progress', '완료': 'completed', '취소': 'suspended',
        // 内部值（原样返回）
        'pending': 'pending', 'in_progress': 'in_progress', 'completed': 'completed', 'suspended': 'suspended'
    }
};

/**
 * 获取枚举类型的内部值（用于导入）
 * 使用完整的反向映射表确保所有语言的显示值都能正确转换
 * @param {string} fieldName
 * @param {string} displayValue
 */
function getInternalEnumValue(fieldName, displayValue) {
    if (!displayValue) return displayValue;

    const valueStr = String(displayValue).trim();

    // 1. Check if it matches any configured internal value (system or custom override)
    const fieldOptions = getSystemFieldOptions(fieldName);
    if (fieldOptions && fieldOptions.includes(valueStr)) {
        return valueStr;
    }

    if (fieldName !== 'priority' && fieldName !== 'status') {
        // For custom select fields, try matching against configured options
        const customField = getCustomFieldByName(fieldName);
        if (customField && customField.options) {
            if (customField.options.includes(valueStr)) {
                return valueStr;
            }
        }
        return displayValue;
    }

    // 2. For legacy priority/status, try static reverse map
    const reverseMap = ENUM_REVERSE_MAP[fieldName];
    if (reverseMap && reverseMap[valueStr]) {
        return reverseMap[valueStr];
    }

    // 3. Try case-insensitive match
    const lowerValue = valueStr.toLowerCase();
    const internalValues = fieldName === 'priority'
        ? INTERNAL_PRIORITY_VALUES
        : INTERNAL_STATUS_VALUES;

    if (internalValues.includes(lowerValue)) {
        return lowerValue;
    }

    // 4. Case-insensitive reverse map match
    for (const [key, internal] of Object.entries(reverseMap)) {
        if (key.toLowerCase() === lowerValue) {
            return internal;
        }
    }

    // 5. Fallback: try matching default options
    const field = state.customFields.find(f => f.name === fieldName);
    if (field && field.options) {
        const index = field.options.indexOf(valueStr);
        if (index !== -1 && index < internalValues.length) {
            return internalValues[index];
        }
    }

    return displayValue; // No match found
}

/**
 * 获取所有可导出字段（基于字段配置，而非列表显示）
 * @returns {string[]} 字段名数组
 */
function getAllExportableFields() {
    const exportFields = [];

    // 1. Get all available unique field names
    const allSystemFields = Object.keys(SYSTEM_FIELD_CONFIG).filter(f => !INTERNAL_FIELDS.includes(f));
    const allCustomFields = state.customFields.map(f => f.name);
    // Use Set to ensure uniqueness
    const allFields = [...new Set([...allSystemFields, ...allCustomFields])];

    // 2. Add fields from current visual order (Enabled fields), respecting user's sort order
    state.fieldOrder.forEach(f => {
        if (allFields.includes(f)) {
            exportFields.push(f);
        }
    });

    // 3. Add remaining fields (Disabled/Hidden fields)
    allFields.forEach(f => {
        if (!state.fieldOrder.includes(f)) {
            exportFields.push(f);
        }
    });

    return exportFields;
}

/**
 * 构建下拉选项参考数据 - 使用字段配置的选项
 * @returns {Object} { fieldName: { options: [], internalValues: [] } }
 */
function buildDropdownOptionsData() {
    const dropdownFields = {};

    // Priority - check for configured options first
    const priorityOptions = getSystemFieldOptions('priority');
    if (priorityOptions && priorityOptions.length > 0) {
        dropdownFields['priority'] = {
            options: priorityOptions.map(k => getLocalizedEnumValue('priority', k) || k),
            internalValues: priorityOptions
        };
    } else {
        dropdownFields['priority'] = {
            options: INTERNAL_PRIORITY_VALUES.map(k => getLocalizedEnumValue('priority', k)),
            internalValues: INTERNAL_PRIORITY_VALUES
        };
    }

    // Status - check for configured options first
    const statusOptions = getSystemFieldOptions('status');
    if (statusOptions && statusOptions.length > 0) {
        dropdownFields['status'] = {
            options: statusOptions.map(k => getLocalizedEnumValue('status', k) || k),
            internalValues: statusOptions
        };
    } else {
        dropdownFields['status'] = {
            options: INTERNAL_STATUS_VALUES.map(k => getLocalizedEnumValue('status', k)),
            internalValues: INTERNAL_STATUS_VALUES
        };
    }

    // Other select fields - check both custom fields and system field overrides
    const processedFields = ['priority', 'status'];

    // Process system fields with type overrides
    Object.keys(SYSTEM_FIELD_CONFIG).forEach(fieldName => {
        if (processedFields.includes(fieldName)) return;

        const fieldType = getFieldType(fieldName);
        if (fieldType !== 'select' && fieldType !== 'multiselect') return;

        const options = getSystemFieldOptions(fieldName);
        if (options && options.length > 0) {
            dropdownFields[fieldName] = {
                options: options,
                internalValues: options
            };
            processedFields.push(fieldName);
        }
    });

    // Process custom fields
    state.customFields.forEach(field => {
        if (processedFields.includes(field.name)) return;
        if (field.type !== 'select' && field.type !== 'multiselect') return;
        if (!field.options || field.options.length === 0) return;

        dropdownFields[field.name] = {
            options: field.options,
            internalValues: field.options
        };
    });

    return dropdownFields;
}

/**
 * 导出Excel (按表格视图字段顺序, 使用层级字段)
 * BUG-002: 使用 ExcelJS 实现数据验证（下拉选项、数值限制）
 */
export async function exportToExcel() {
    try {
        // 获取所有任务数据
        const tasks = gantt.serialize().data;

        // 构建任务映射和层级缓存
        const taskMap = {};
        tasks.forEach(task => { taskMap[task.id] = task; });
        const hierarchyCache = {};

        // 按照 fieldOrder 顺序构建表头 - 第一列是层级（固定）
        const headers = [getExcelColumnName('hierarchy')];
        const fieldMapping = ['hierarchy']; // 记录每列对应的字段名

        // 获取所有可导出字段（基于字段配置）
        const exportableFields = getAllExportableFields();

        // 首先添加 fieldOrder 中的字段（保持用户的列顺序偏好）
        // 然后添加不在 fieldOrder 中但可导出的字段（即所有其他字段）
        // 因为 exportableFields 已经按照这个顺序排序了，我们直接遍历它即可
        exportableFields.forEach(fieldName => {
            if (INTERNAL_FIELDS.includes(fieldName)) return;
            if (fieldMapping.includes(fieldName)) return; // 避免重复（如 hierarchy）

            headers.push(getExcelColumnName(fieldName));
            fieldMapping.push(fieldName);
        });

        // 创建 ExcelJS 工作簿
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Gantt Task Editor';
        workbook.created = new Date();

        // 创建主工作表
        const sheetName = i18n.t('excel.sheetName') || '任务列表';
        const worksheet = workbook.addWorksheet(sheetName);

        // 添加表头行
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // 添加数据行
        tasks.forEach(task => {
            const row = [];

            // 第一列：层级编号
            row.push(generateHierarchy(task, taskMap, hierarchyCache));

            // 按照字段映射顺序动态添加数据
            for (let i = 1; i < fieldMapping.length; i++) {
                const fieldName = fieldMapping[i];
                const value = task[fieldName];

                // 特殊处理日期字段
                if (fieldName === 'start_date' && value) {
                    if (typeof value === 'string') {
                        row.push(value);
                    } else if (value instanceof Date) {
                        row.push(gantt.date.date_to_str('%Y-%m-%d')(value));
                    } else {
                        row.push('');
                    }
                }
                // 特殊处理进度字段（转换为百分比）
                else if (fieldName === 'progress') {
                    row.push(Math.round((value || 0) * 100));
                }
                // 特殊处理枚举字段（本地化）
                else if (fieldName === 'priority' || fieldName === 'status') {
                    row.push(getLocalizedEnumValue(fieldName, value));
                }
                // 其他字段直接取值
                else {
                    row.push(value !== undefined && value !== null ? value : '');
                }
            }

            worksheet.addRow(row);
        });

        // 设置列宽
        worksheet.columns = headers.map((h, idx) => {
            if (idx === 0) return { width: 10 }; // 层级列
            const fieldName = fieldMapping[idx];
            if (fieldName === 'text') return { width: 30 };
            if (fieldName === 'start_date') return { width: 14 };
            if (fieldName === 'duration') return { width: 10 };
            if (fieldName === 'progress') return { width: 10 };
            return { width: 15 };
        });

        // ========================================
        // BUG-002: 添加数据验证（下拉选项）
        // ========================================
        const dropdownFields = buildDropdownOptionsData();
        const dataRowCount = Math.max(tasks.length + 1, 100); // 至少支持100行

        // 遍历字段，添加数据验证
        for (let colIdx = 1; colIdx < fieldMapping.length; colIdx++) {
            const fieldName = fieldMapping[colIdx];
            const colNumber = colIdx + 1; // ExcelJS 列号从1开始

            // 下拉选择字段
            if (dropdownFields[fieldName]) {
                const options = dropdownFields[fieldName].options;
                // ExcelJS 使用 formulae 格式: ['"选项1,选项2,选项3"']
                const formulae = [`"${options.join(',')}"`];

                for (let rowNum = 2; rowNum <= dataRowCount; rowNum++) {
                    const cell = worksheet.getCell(rowNum, colNumber);
                    cell.dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: formulae,
                        showErrorMessage: true,
                        errorStyle: 'warning',
                        errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                        error: i18n.t('validation.selectFromList') || 'Please select from the list'
                    };
                }
            }

            // 工期字段添加整数验证 (>=0)
            if (fieldName === 'duration') {
                for (let rowNum = 2; rowNum <= dataRowCount; rowNum++) {
                    const cell = worksheet.getCell(rowNum, colNumber);
                    cell.dataValidation = {
                        type: 'whole',
                        operator: 'greaterThanOrEqual',
                        allowBlank: true,
                        formulae: [0],
                        showErrorMessage: true,
                        errorStyle: 'stop',
                        errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                        error: i18n.t('validation.numberRequired') || 'Please enter a valid number (>=0)'
                    };
                }
            }

            // 进度字段添加百分比验证 (0-100)
            if (fieldName === 'progress') {
                for (let rowNum = 2; rowNum <= dataRowCount; rowNum++) {
                    const cell = worksheet.getCell(rowNum, colNumber);
                    cell.dataValidation = {
                        type: 'whole',
                        operator: 'between',
                        allowBlank: true,
                        formulae: [0, 100],
                        showErrorMessage: true,
                        errorStyle: 'stop',
                        errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                        error: i18n.t('validation.progressRange') || 'Progress must be between 0 and 100'
                    };
                }
            }

            // 自定义数字字段
            const customField = state.customFields.find(f => f.name === fieldName);
            if (customField && customField.type === 'number' && !dropdownFields[fieldName]) {
                for (let rowNum = 2; rowNum <= dataRowCount; rowNum++) {
                    const cell = worksheet.getCell(rowNum, colNumber);
                    cell.dataValidation = {
                        type: 'decimal',
                        allowBlank: !customField.required,
                        showErrorMessage: true,
                        errorStyle: customField.required ? 'stop' : 'warning',
                        errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                        error: i18n.t('validation.numberRequired') || 'Please enter a valid number'
                    };
                }
            }
        }

        // 导出文件（浏览器环境）
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gantt-tasks-${new Date().toISOString().split('T')[0]}.xlsx`;
        a.dispatchEvent(new MouseEvent('click'));
        URL.revokeObjectURL(url);

        showToast(i18n.t('message.exportSuccess') || 'Excel导出成功', 'success');
    } catch (error) {
        console.error('Excel导出失败:', error);
        showToast((i18n.t('message.exportError') || 'Excel导出失败') + ': ' + error.message, 'error');
    }
}

/**
 * 导入Excel (支持层级字段和多语言列名)
 * 使用 ExcelJS 替代 xlsx
 */
export async function importFromExcel(file) {
    if (!file) return;

    try {
        // 预先加载所有语言包以支持多语言匹配
        await i18n.loadAllLocales();

        // 读取文件为 ArrayBuffer
        const buffer = await file.arrayBuffer();

        // 使用 ExcelJS 解析
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);

        // 读取第一个工作表
        const worksheet = workbook.worksheets[0];
        if (!worksheet || worksheet.rowCount < 2) {
            showToast('Excel文件格式错误：没有数据行', 'error');
            return;
        }

        // 获取表头（第一行）
        const headerRow = worksheet.getRow(1);
        const headers = [];
        headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            headers[colNumber - 1] = cell.value ? String(cell.value).trim() : '';
        });

        const columnMapping = getAllColumnNameMappings();

        // 识别列索引
        const fieldIndexMap = {}; // fieldName -> columnIndex
        headers.forEach((header, index) => {
            if (!header) return;
            const fieldName = columnMapping[header] || columnMapping[header.trim()];
            if (fieldName) {
                fieldIndexMap[fieldName] = index;
            }
        });

        // 检查必要字段
        const hasHierarchy = fieldIndexMap['hierarchy'] !== undefined;
        const hasTaskId = fieldIndexMap['id'] !== undefined;

        // 兼容旧版硬编码列名
        if (!hasHierarchy && !hasTaskId) {
            const idIndex = headers.findIndex(h => h === '任务ID' || h === 'Task ID');
            if (idIndex !== -1) fieldIndexMap['id'] = idIndex;
        }

        if (fieldIndexMap['text'] === undefined) {
            const textIndex = headers.findIndex(h => h === '任务名称' || h === 'Task Name');
            if (textIndex !== -1) fieldIndexMap['text'] = textIndex;
            else {
                showToast('无法识别"任务名称"列，请检查Excel表头', 'error');
                return;
            }
        }

        // 解析数据行
        const tasks = [];
        const hierarchyToId = {};
        let nextId = 1;

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // 跳过表头

            try {
                // 获取行数据为数组
                const rowData = [];
                row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                    // 处理不同类型的单元格值
                    let value = cell.value;
                    // ExcelJS 的富文本处理
                    if (value && typeof value === 'object') {
                        if (value.richText) {
                            value = value.richText.map(rt => rt.text).join('');
                        } else if (value.text) {
                            value = value.text;
                        } else if (value instanceof Date) {
                            // 保持 Date 对象
                        } else if (value.result !== undefined) {
                            value = value.result; // 公式结果
                        }
                    }
                    rowData[colNumber - 1] = value;
                });

                if (rowData.every(v => v === null || v === undefined || v === '')) return;

                // 解析日期
                let startDate = new Date();
                if (fieldIndexMap['start_date'] !== undefined) {
                    const dateValue = rowData[fieldIndexMap['start_date']];
                    if (dateValue) {
                        if (dateValue instanceof Date) {
                            startDate = dateValue;
                        } else if (typeof dateValue === 'string') {
                            startDate = gantt.date.str_to_date('%Y-%m-%d')(dateValue);
                        } else if (typeof dateValue === 'number') {
                            // Excel 日期序列号
                            startDate = new Date((dateValue - 25569) * 86400 * 1000);
                        }
                    }
                }

                const task = {
                    text: rowData[fieldIndexMap['text']] || '新任务',
                    start_date: startDate,
                    duration: fieldIndexMap['duration'] !== undefined ? (parseInt(rowData[fieldIndexMap['duration']]) || 1) : 1,
                    progress: fieldIndexMap['progress'] !== undefined ? ((parseInt(rowData[fieldIndexMap['progress']]) || 0) / 100) : 0
                };

                if (hasHierarchy) {
                    const hierarchy = String(rowData[fieldIndexMap['hierarchy']] || '');
                    task.id = nextId++;

                    const parts = hierarchy.split('.');
                    if (parts.length > 1) {
                        const parentHierarchy = parts.slice(0, -1).join('.');
                        if (hierarchyToId[parentHierarchy]) {
                            task.parent = hierarchyToId[parentHierarchy];
                        }
                    }

                    hierarchyToId[hierarchy] = task.id;
                } else if (hasTaskId) {
                    task.id = rowData[fieldIndexMap['id']];
                    if (fieldIndexMap['parent'] !== undefined) {
                        task.parent = rowData[fieldIndexMap['parent']];
                    }
                } else {
                    task.id = nextId++;
                }

                // 解析所有字段（包括自定义字段和系统字段）
                state.customFields.forEach(field => {
                    if (fieldIndexMap[field.name] !== undefined) {
                        let value = rowData[fieldIndexMap[field.name]];

                        // 特殊处理 priority 和 status 的枚举值转换
                        if (field.name === 'priority' || field.name === 'status') {
                            value = getInternalEnumValue(field.name, value);
                        }

                        // Validate select/multiselect fields
                        if ((field.type === 'select' || field.type === 'multiselect') && value) {
                            // 获取选项：优先检查系统字段配置覆盖，如果没有则使用字段定义中的 options
                            let options = getSystemFieldOptions(field.name);
                            if (!options || options.length === 0) {
                                options = field.options || [];
                            }

                            // For multiselect, value might be comma-separated
                            const valuesToCheck = field.type === 'multiselect' ? String(value).split(',') : [value];
                            // 检查值是否有效 (Internal values)
                            const invalidValues = valuesToCheck.filter(v => options.length > 0 && !options.includes(v.trim()));

                            if (invalidValues.length > 0) {
                                console.warn(`Invalid value(s) "${invalidValues.join(',')}" for field "${field.name}", valid options: ${options.join(', ')}`);
                            }
                        }

                        // Assign value
                        task[field.name] = value;
                    }
                });

                tasks.push(task);
            } catch (error) {
                console.warn(`解析第 ${rowNumber} 行失败:`, error);
            }
        });

        if (tasks.length === 0) {
            showToast('没有有效的任务数据', 'error');
            return;
        }

        // 批量更新
        gantt.batchUpdate(() => {
            gantt.clearAll();
            gantt.parse({ data: tasks });
        });

        showToast(`成功导入 ${tasks.length} 个任务`, 'success');
    } catch (error) {
        console.error('Excel导入失败:', error);
        showToast('Excel导入失败: ' + error.message, 'error');
    }
}

/**
 * 初始化配置导入导出
 */
export function initConfigIO() {
    // 导出按钮 - 默认导出Excel
    document.getElementById('config-export-btn').addEventListener('click', exportToExcel);

    // Excel导出 (下拉菜单)
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

    // JSON完整备份导出
    document.getElementById('dropdown-export-json')?.addEventListener('click', async function () {
        // 关闭下拉菜单
        const dropdown = document.querySelector('.dropdown-content.active');
        if (dropdown) dropdown.classList.remove('active');
        
        await exportFullBackup();
    });

    // JSON完整备份导入
    document.getElementById('dropdown-import-json')?.addEventListener('click', function () {
        // 关闭下拉菜单
        const dropdown = document.querySelector('.dropdown-content.active');
        if (dropdown) dropdown.classList.remove('active');
        
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.json.gz,.gz';
        input.onchange = async (e) => {
            await importFullBackup(e.target.files[0]);
        };
        input.click();
    });

    // JSON配置导入 (备用 - 保持兼容旧功能)
    document.getElementById('config-import-btn')?.addEventListener('click', function () {
        document.getElementById('config-file-input').click();
    });

    document.getElementById('config-file-input')?.addEventListener('change', function (e) {
        importConfig(e.target.files[0]);
        this.value = ''; // 重置以便再次选择同一文件
    });
}
