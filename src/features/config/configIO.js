/**
 * 配置导入导出功能
 */

import * as XLSX from 'xlsx';
import { state } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { refreshLightbox } from '../lightbox/customization.js';
import { i18n } from '../../utils/i18n.js';
import { INTERNAL_PRIORITY_VALUES, INTERNAL_STATUS_VALUES } from '../../config/constants.js';

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
    // 尝试从i18n获取翻译
    if (window.i18n && typeof window.i18n.t === 'function') {
        const translated = window.i18n.t(`columns.${fieldName}`);
        if (translated !== `columns.${fieldName}`) {
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
    if (fieldName !== 'priority' && fieldName !== 'status') return displayValue;

    const valueStr = String(displayValue).trim();

    // 1. 优先使用反向映射表查找
    const reverseMap = ENUM_REVERSE_MAP[fieldName];
    if (reverseMap && reverseMap[valueStr]) {
        return reverseMap[valueStr];
    }

    // 2. 尝试小写匹配（兼容大小写不一致的情况）
    const lowerValue = valueStr.toLowerCase();
    const internalValues = fieldName === 'priority'
        ? INTERNAL_PRIORITY_VALUES
        : INTERNAL_STATUS_VALUES;

    if (internalValues.includes(lowerValue)) {
        return lowerValue;
    }

    // 3. 遍历反向映射表进行大小写不敏感匹配
    for (const [key, internal] of Object.entries(reverseMap)) {
        if (key.toLowerCase() === lowerValue) {
            return internal;
        }
    }

    // 4. 尝试匹配 fields.js 中的默认 options (针对存量数据)
    const field = state.customFields.find(f => f.name === fieldName);
    if (field && field.options) {
        const index = field.options.indexOf(valueStr);
        if (index !== -1 && index < internalValues.length) {
            return internalValues[index];
        }
    }

    return displayValue; // 未找到匹配，原样返回
}

/**
 * 构建下拉选项参考数据
 * @returns {Object} { fieldName: { options: [], colLetter: '' } }
 */
function buildDropdownOptionsData() {
    const dropdownFields = {};

    // 优先级
    dropdownFields['priority'] = {
        options: INTERNAL_PRIORITY_VALUES.map(k => getLocalizedEnumValue('priority', k)),
        internalValues: INTERNAL_PRIORITY_VALUES
    };

    // 状态
    dropdownFields['status'] = {
        options: INTERNAL_STATUS_VALUES.map(k => getLocalizedEnumValue('status', k)),
        internalValues: INTERNAL_STATUS_VALUES
    };

    // 其他自定义选择字段
    state.customFields.forEach(field => {
        if ((field.type === 'select' || field.type === 'multiselect') &&
            field.name !== 'priority' && field.name !== 'status' &&
            field.options && field.options.length > 0) {
            dropdownFields[field.name] = {
                options: field.options,
                internalValues: field.options
            };
        }
    });

    return dropdownFields;
}

/**
 * 导出Excel (按表格视图字段顺序, 使用层级字段)
 * BUG-002: 添加下拉选项数据验证
 */
export function exportToExcel() {
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

        // 动态遍历fieldOrder构建表头和字段映射
        state.fieldOrder.forEach(fieldName => {
            headers.push(getExcelColumnName(fieldName));
            fieldMapping.push(fieldName);
        });

        // 准备数据行
        const rows = [headers];

        tasks.forEach(task => {
            const row = [];

            // 第一列：层级编号
            row.push(generateHierarchy(task, taskMap, hierarchyCache));

            // 按照字段映射顺序动态添加数据 (跳过第一个hierarchy，因为它已经添加了)
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

            rows.push(row);
        });

        // 创建工作簿
        const wb = XLSX.utils.book_new();

        // ========================================
        // BUG-002: 创建选项参考表（隐藏工作表）
        // ========================================
        const dropdownFields = buildDropdownOptionsData();
        const optionsSheetData = [];
        const optionsSheetHeaders = [];
        const optionRanges = {}; // 记录每个字段的选项范围，用于数据验证

        // 构建选项表头和数据
        Object.keys(dropdownFields).forEach((fieldName, colIndex) => {
            const fieldData = dropdownFields[fieldName];
            optionsSheetHeaders.push(fieldName);

            // 记录此字段在选项表中的范围
            const colLetter = XLSX.utils.encode_col(colIndex);
            optionRanges[fieldName] = {
                colLetter,
                startRow: 2,
                endRow: fieldData.options.length + 1
            };
        });

        if (optionsSheetHeaders.length > 0) {
            optionsSheetData.push(optionsSheetHeaders);

            // 找出最长的选项列表
            const maxOptions = Math.max(...Object.values(dropdownFields).map(f => f.options.length));

            // 填充选项数据
            for (let rowIndex = 0; rowIndex < maxOptions; rowIndex++) {
                const row = [];
                Object.keys(dropdownFields).forEach(fieldName => {
                    const options = dropdownFields[fieldName].options;
                    row.push(options[rowIndex] || '');
                });
                optionsSheetData.push(row);
            }

            // 创建选项工作表
            const wsOptions = XLSX.utils.aoa_to_sheet(optionsSheetData);
            XLSX.utils.book_append_sheet(wb, wsOptions, '_Options');
        }

        // ========================================
        // 创建主任务工作表
        // ========================================
        const ws = XLSX.utils.aoa_to_sheet(rows);

        // 设置列宽
        const colWidths = headers.map((h, idx) => {
            if (idx === 0) return { wch: 10 }; // 层级列
            const fieldName = fieldMapping[idx];
            if (fieldName === 'text') return { wch: 25 };
            if (fieldName === 'start_date') return { wch: 12 };
            if (fieldName === 'duration') return { wch: 10 };
            if (fieldName === 'progress') return { wch: 10 };
            return { wch: 15 };
        });
        ws['!cols'] = colWidths;

        // ========================================
        // BUG-002: 添加数据验证
        // ========================================
        // 注意：xlsx 免费版对数据验证的支持有限
        // 我们使用 !dataValidation 属性（部分 Excel 版本支持）

        // 计算数据行数（用于数据验证范围）
        const dataRowCount = Math.max(tasks.length + 1, 100); // 至少支持100行

        const dataValidations = [];

        // 遍历字段，添加数据验证
        for (let i = 1; i < fieldMapping.length; i++) {
            const fieldName = fieldMapping[i];
            const colLetter = XLSX.utils.encode_col(i);

            // 下拉选择字段
            if (dropdownFields[fieldName]) {
                const options = dropdownFields[fieldName].options;
                // xlsx 库支持直接在 formula1 中使用逗号分隔的选项列表
                const optionsStr = options.join(',');

                dataValidations.push({
                    sqref: `${colLetter}2:${colLetter}${dataRowCount}`,
                    type: 'list',
                    formula1: `"${optionsStr}"`,
                    showDropDown: true,
                    allowBlank: true,
                    showErrorMessage: true,
                    errorStyle: 'warning',
                    errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                    error: i18n.t('validation.selectFromList') || 'Please select from the list'
                });
            }

            // 数值字段添加数字验证
            if (fieldName === 'duration') {
                dataValidations.push({
                    sqref: `${colLetter}2:${colLetter}${dataRowCount}`,
                    type: 'whole',
                    operator: 'greaterThanOrEqual',
                    formula1: '0',
                    allowBlank: true,
                    showErrorMessage: true,
                    errorStyle: 'stop',
                    errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                    error: i18n.t('validation.numberRequired') || 'Please enter a valid number'
                });
            }

            // 进度字段添加百分比验证 (0-100)
            if (fieldName === 'progress') {
                dataValidations.push({
                    sqref: `${colLetter}2:${colLetter}${dataRowCount}`,
                    type: 'whole',
                    operator: 'between',
                    formula1: '0',
                    formula2: '100',
                    allowBlank: true,
                    showErrorMessage: true,
                    errorStyle: 'stop',
                    errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                    error: i18n.t('validation.progressRange') || 'Progress must be between 0 and 100'
                });
            }

            // 自定义数字字段
            const customField = state.customFields.find(f => f.name === fieldName);
            if (customField && customField.type === 'number' && !dropdownFields[fieldName]) {
                dataValidations.push({
                    sqref: `${colLetter}2:${colLetter}${dataRowCount}`,
                    type: 'decimal',
                    allowBlank: !customField.required,
                    showErrorMessage: true,
                    errorStyle: customField.required ? 'stop' : 'warning',
                    errorTitle: i18n.t('validation.invalidInput') || 'Invalid Input',
                    error: i18n.t('validation.numberRequired') || 'Please enter a valid number'
                });
            }
        }

        // 应用数据验证
        if (dataValidations.length > 0) {
            ws['!dataValidation'] = dataValidations;
        }

        // 添加主工作表
        XLSX.utils.book_append_sheet(wb, ws, i18n.t('excel.sheetName') || '任务列表');

        // 导出文件
        const filename = `gantt-tasks-${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, filename);

        showToast(i18n.t('message.exportSuccess') || 'Excel导出成功', 'success');
    } catch (error) {
        console.error('Excel导出失败:', error);
        showToast((i18n.t('message.exportError') || 'Excel导出失败') + ': ' + error.message, 'error');
    }
}

/**
 * 导入Excel (支持层级字段和多语言列名)
 */
export function importFromExcel(file) {
    if (!file) return;

    // 预先加载所有语言包以支持多语言匹配
    i18n.loadAllLocales().then(() => {
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
                const columnMapping = getAllColumnNameMappings();

                // 识别列索引
                const fieldIndexMap = {}; // fieldName -> columnIndex
                headers.forEach((header, index) => {
                    const fieldName = columnMapping[header] || columnMapping[header.trim()];
                    if (fieldName) {
                        fieldIndexMap[fieldName] = index;
                    }
                });

                // 检查必要字段
                const hasHierarchy = fieldIndexMap['hierarchy'] !== undefined;
                const hasTaskId = fieldIndexMap['id'] !== undefined;

                // 兼容旧版硬编码列名（如果getAllColumnNameMappings覆盖不全）
                if (!hasHierarchy && !hasTaskId) {
                    // 尝试直接查找 '任务ID' 或 'Task ID'
                    const idIndex = headers.findIndex(h => h === '任务ID' || h === 'Task ID');
                    if (idIndex !== -1) fieldIndexMap['id'] = idIndex;
                }

                if (fieldIndexMap['text'] === undefined) {
                    // 尝试兜底
                    const textIndex = headers.findIndex(h => h === '任务名称' || h === 'Task Name');
                    if (textIndex !== -1) fieldIndexMap['text'] = textIndex;
                    else {
                        showToast('无法识别“任务名称”列，请检查Excel表头', 'error');
                        return;
                    }
                }

                // 解析数据
                const tasks = [];
                const hierarchyToId = {}; // 层级编号到任务ID的映射
                let nextId = 1;

                dataRows.forEach((row, index) => {
                    if (!row || row.length === 0) return;

                    try {
                        // 解析日期
                        let startDate = new Date();
                        if (fieldIndexMap['start_date'] !== undefined) {
                            const dateValue = row[fieldIndexMap['start_date']];
                            if (dateValue) {
                                if (typeof dateValue === 'string') {
                                    startDate = gantt.date.str_to_date('%Y-%m-%d')(dateValue);
                                } else if (typeof dateValue === 'number') {
                                    startDate = new Date((dateValue - 25569) * 86400 * 1000);
                                }
                            }
                        }

                        const task = {
                            text: row[fieldIndexMap['text']] || '新任务',
                            start_date: startDate,
                            duration: fieldIndexMap['duration'] !== undefined ? (parseInt(row[fieldIndexMap['duration']]) || 1) : 1,
                            progress: fieldIndexMap['progress'] !== undefined ? ((parseInt(row[fieldIndexMap['progress']]) || 0) / 100) : 0
                        };

                        if (hasHierarchy) {
                            // 新格式：使用层级编号
                            const hierarchy = String(row[fieldIndexMap['hierarchy']] || '');
                            task.id = nextId++;

                            // 解析父任务
                            const parts = hierarchy.split('.');
                            if (parts.length > 1) {
                                const parentHierarchy = parts.slice(0, -1).join('.');
                                if (hierarchyToId[parentHierarchy]) {
                                    task.parent = hierarchyToId[parentHierarchy];
                                }
                            }

                            hierarchyToId[hierarchy] = task.id;
                        } else if (hasTaskId) {
                            // 旧格式：使用任务ID
                            task.id = row[fieldIndexMap['id']];
                            if (fieldIndexMap['parent'] !== undefined) {
                                task.parent = row[fieldIndexMap['parent']];
                            }
                        } else {
                            // 无层级也无ID，生成新ID
                            task.id = nextId++;
                        }

                        // 解析其他自定义字段（排除 priority 和 status，这两个字段需要特殊处理枚举值转换）
                        state.customFields.forEach(field => {
                            if (fieldIndexMap[field.name] !== undefined && field.name !== 'priority' && field.name !== 'status') {
                                task[field.name] = row[fieldIndexMap[field.name]];
                            }
                        });

                        // 特殊处理 priority, assignee, status（priority 和 status 需要转换枚举值）
                        ['priority', 'assignee', 'status'].forEach(field => {
                            if (fieldIndexMap[field] !== undefined) {
                                let value = row[fieldIndexMap[field]];
                                // 如果是 priority 或 status，必须转换为内部值
                                if (field === 'priority' || field === 'status') {
                                    value = getInternalEnumValue(field, value);
                                }
                                if (value !== undefined) {
                                    task[field] = value;
                                }
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
        };
        reader.readAsArrayBuffer(file);
    }).catch(e => {
        console.error('Loading locales failed', e);
        showToast('加载语言包失败，无法导入', 'error');
    });
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

    // JSON导入 (备用)
    document.getElementById('config-import-btn')?.addEventListener('click', function () {
        document.getElementById('config-file-input').click();
    });

    document.getElementById('config-file-input')?.addEventListener('change', function (e) {
        importConfig(e.target.files[0]);
        this.value = ''; // 重置以便再次选择同一文件
    });
}
