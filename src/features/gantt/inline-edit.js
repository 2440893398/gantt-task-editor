/**
 * 内联编辑模块
 *
 * OPT-002: 支持直接在表格中编辑值
 * - 双击单元格进入编辑模式
 * - 支持文本、日期、下拉选择等编辑器
 * - Enter 保存 / Escape 取消
 */

import { state, getFieldType, getSystemFieldOptions } from '../../core/store.js';

import { i18n } from '../../utils/i18n.js';
// F-112: 任务详情面板
import { openTaskDetailsPanel } from '../task-details/index.js';


// 当前活跃的编辑器
let activeEditor = null;

/**
 * 初始化内联编辑功能
 */
export function initInlineEdit() {
    console.log('🔧 初始化内联编辑模块...');

    // 绑定双击事件
    bindDoubleClickEdit();

    // 绑定点击外部关闭编辑器
    bindClickOutside();

    console.log('✅ 内联编辑模块初始化完成');
}

/**
 * 获取列的编辑器类型
 * @param {string} columnName - 列名
 * @returns {string} 编辑器类型: 'text' | 'number' | 'date' | 'datetime' | 'select' | 'multiselect' | 'progress' | 'textarea' | 'none'
 */
function getEditorType(columnName) {
    // 特殊字段处理
    if (columnName === 'progress') return 'progress';
    if (columnName === 'summary') return 'textarea';  // F-112

    // 使用 store 中的 getFieldType 获取实际字段类型
    // 这会自动处理系统字段的类型覆盖
    const fieldType = getFieldType(columnName);

    // 映射字段类型到编辑器类型
    switch (fieldType) {
        case 'text':
            return 'text';
        case 'number':
            return 'number';
        case 'date':
            return 'date';
        case 'datetime':
            return 'datetime';
        case 'select':
            return 'select';
        case 'multiselect':
            return 'multiselect';
        case 'richtext':
            // 富文本暂不支持行内编辑,使用文本框
            return 'text';
        default:
            return 'none';
    }
}

/**
 * 绑定双击编辑事件
 */
function bindDoubleClickEdit() {
    // F-112: 禁用默认的 lightbox 双击行为
    gantt.config.details_on_dblclick = false;

    gantt.attachEvent("onTaskDblClick", function (id, e) {
        const target = e.target;
        const cell = target.closest('.gantt_cell');

        // 如果不是在单元格内双击（例如在时间轴上），打开任务详情面板
        if (!cell) {
            openTaskDetailsPanel(id);
            return false;
        }

        const columnName = cell.getAttribute('data-column-name');
        if (!columnName) {
            openTaskDetailsPanel(id);
            return false;
        }


        // 检查是否为 buttons 列（复选框列），不可编辑
        if (columnName === 'buttons' || columnName === 'add') {
            return true;
        }

        const editorType = getEditorType(columnName);

        // F-112: 对于不可内联编辑的列，打开新的任务详情面板
        if (editorType === 'none') {
            openTaskDetailsPanel(id);
            return false; // 阻止默认的 lightbox 打开
        }

        // 关闭之前的编辑器
        if (activeEditor) {
            saveAndCloseEditor();
        }

        // 启动内联编辑
        startInlineEdit(id, columnName, cell, editorType);
        return false; // 阻止默认的 lightbox 打开
    });
}

/**
 * 绑定点击外部关闭编辑器
 */
function bindClickOutside() {
    document.addEventListener('mousedown', (e) => {
        if (!activeEditor) return;

        const editorElement = activeEditor.element;
        if (editorElement && !editorElement.contains(e.target)) {
            saveAndCloseEditor();
        }
    });
}

/**
 * 开始内联编辑
 * @param {number} taskId - 任务 ID
 * @param {string} columnName - 列名
 * @param {HTMLElement} cell - 单元格元素
 * @param {string} editorType - 编辑器类型
 */
function startInlineEdit(taskId, columnName, cell, editorType) {
    const task = gantt.getTask(taskId);
    const originalValue = task[columnName];

    // 保存原始内容
    const originalContent = cell.innerHTML;

    // 创建编辑器容器
    const editorContainer = document.createElement('div');
    editorContainer.className = 'gantt-inline-editor-container';
    editorContainer.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    let editorElement;

    switch (editorType) {
        case 'text':
            editorElement = createTextEditor(originalValue);
            break;
        case 'number':
            editorElement = createNumberEditor(originalValue);
            break;
        case 'date':
            editorElement = createDateEditor(originalValue, false);
            break;
        case 'datetime':
            editorElement = createDateEditor(originalValue, true);
            break;
        case 'progress':
            editorElement = createProgressEditor(originalValue);
            break;
        case 'select':
            editorElement = createSelectEditor(columnName, originalValue);
            break;
        case 'multiselect':
            editorElement = createMultiselectEditor(columnName, originalValue);
            break;
        case 'textarea':  // F-112
            editorElement = createTextareaEditor(originalValue);
            break;
        default:
            return;
    }

    editorContainer.appendChild(editorElement);
    cell.innerHTML = '';
    cell.appendChild(editorContainer);
    cell.classList.add('editing');

    // 聚焦
    if (editorElement.focus) {
        editorElement.focus();
        if (editorElement.select) {
            editorElement.select();
        }
    }

    // 保存活跃编辑器信息
    activeEditor = {
        taskId,
        columnName,
        cell,
        element: editorContainer,
        editorElement,
        originalContent,
        originalValue,
        editorType
    };

    // 绑定键盘事件
    editorElement.addEventListener('keydown', handleKeydown);
}

/**
 * 创建文本编辑器
 */
function createTextEditor(value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.className = 'gantt-inline-editor';
    return input;
}

/**
 * 创建数字编辑器
 */
function createNumberEditor(value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value || 0;
    input.min = '0';
    input.className = 'gantt-inline-editor';
    return input;
}

/**
 * 创建日期编辑器
 * @param {*} value - 日期值
 * @param {boolean} enableTime - 是否启用时间选择
 */
function createDateEditor(value, enableTime = false) {
    const input = document.createElement('input');
    input.type = enableTime ? 'datetime-local' : 'date';
    if (value) {
        if (value instanceof Date) {
            if (enableTime) {
                // datetime-local 需要 YYYY-MM-DDTHH:mm 格式
                const year = value.getFullYear();
                const month = String(value.getMonth() + 1).padStart(2, '0');
                const day = String(value.getDate()).padStart(2, '0');
                const hours = String(value.getHours()).padStart(2, '0');
                const minutes = String(value.getMinutes()).padStart(2, '0');
                input.value = `${year}-${month}-${day}T${hours}:${minutes}`;
            } else {
                input.value = value.toISOString().split('T')[0];
            }
        } else if (typeof value === 'string') {
            if (enableTime) {
                // 处理字符串格式
                const date = new Date(value);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                input.value = `${year}-${month}-${day}T${hours}:${minutes}`;
            } else {
                input.value = value.split('T')[0];
            }
        }
    }
    input.className = 'gantt-inline-editor';
    return input;
}

/**
 * 创建进度编辑器
 */
function createProgressEditor(value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = Math.round((value || 0) * 100);
    input.min = '0';
    input.max = '100';
    input.step = '5';
    input.className = 'gantt-inline-editor';
    return input;
}

/**
 * 创建多行文本编辑器 (F-112)
 */
function createTextareaEditor(value) {
    const textarea = document.createElement('textarea');
    textarea.value = value || '';
    textarea.className = 'gantt-inline-editor gantt-textarea-editor';
    textarea.rows = 3;
    textarea.placeholder = i18n.t('ai.result.originalTask') || '输入任务概述...';
    return textarea;
}

/**
 * 创建下拉选择编辑器
 */
function createSelectEditor(columnName, value) {
    const select = document.createElement('select');
    select.className = 'gantt-inline-editor';

    // 获取字段配置 - 先检查系统字段覆盖，再检查自定义字段
    const systemOptions = getSystemFieldOptions(columnName);
    const customField = state.customFields.find(f => f.name === columnName);

    // 确定有效选项：系统字段覆盖优先，否则使用自定义字段选项
    const effectiveOptions = systemOptions || (customField && customField.options) || [];

    if (effectiveOptions.length === 0) return select;

    // 添加空选项
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = i18n.t('form.selectPlaceholder') || '请选择';
    select.appendChild(emptyOption);

    // 添加选项
    effectiveOptions.forEach(option => {
        const optElement = document.createElement('option');
        optElement.value = option;

        // 本地化显示值
        let displayValue = option;
        if (customField && customField.i18nKey) {
            const translated = i18n.t(`${customField.i18nKey}.${option}`);
            if (translated !== `${customField.i18nKey}.${option}`) {
                displayValue = translated;
            }
        }
        optElement.textContent = displayValue;

        if (option === value) {
            optElement.selected = true;
        }
        select.appendChild(optElement);
    });

    return select;
}


/**
 * 创建多选编辑器
 */
function createMultiselectEditor(columnName, value) {
    const select = document.createElement('select');
    select.className = 'gantt-inline-editor';
    select.multiple = true;
    select.style.minHeight = '60px';

    // 获取字段配置 - 先检查系统字段覆盖，再检查自定义字段
    const systemOptions = getSystemFieldOptions(columnName);
    const customField = state.customFields.find(f => f.name === columnName);

    // 确定有效选项
    const effectiveOptions = systemOptions || (customField && customField.options) || [];

    if (effectiveOptions.length === 0) return select;

    // 解析当前选中值
    const selectedValues = Array.isArray(value) ? value : (value ? String(value).split(',') : []);

    // 添加选项
    effectiveOptions.forEach(option => {
        const optElement = document.createElement('option');
        optElement.value = option;

        // 本地化显示值
        let displayValue = option;
        if (customField && customField.i18nKey) {
            const translated = i18n.t(`${customField.i18nKey}.${option}`);
            if (translated !== `${customField.i18nKey}.${option}`) {
                displayValue = translated;
            }
        }
        optElement.textContent = displayValue;

        if (selectedValues.includes(option)) {
            optElement.selected = true;
        }
        select.appendChild(optElement);
    });

    return select;
}


/**
 * 处理键盘事件
 */
function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveAndCloseEditor();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelAndCloseEditor();
    }
}

/**
 * 保存并关闭编辑器
 */
function saveAndCloseEditor() {
    if (!activeEditor) return;

    const { taskId, columnName, cell, editorElement, originalContent, originalValue, editorType } = activeEditor;
    const task = gantt.getTask(taskId);

    // 获取新值
    let newValue;
    switch (editorType) {
        case 'text':
        case 'number':
            newValue = editorElement.value;
            if (editorType === 'number') {
                newValue = parseFloat(newValue) || 0;
            }
            break;
        case 'date':
            newValue = editorElement.value ? gantt.date.str_to_date('%Y-%m-%d')(editorElement.value) : null;
            break;
        case 'datetime':
            // datetime-local 返回格式: YYYY-MM-DDTHH:mm
            newValue = editorElement.value ? new Date(editorElement.value) : null;
            break;
        case 'progress':
            newValue = (parseInt(editorElement.value) || 0) / 100;
            newValue = Math.max(0, Math.min(1, newValue));
            break;
        case 'select':
            newValue = editorElement.value;
            break;
        case 'multiselect':
            newValue = Array.from(editorElement.selectedOptions).map(o => o.value).join(',');
            break;
        case 'textarea':  // F-112
            newValue = editorElement.value.trim();
            break;
        default:
            newValue = editorElement.value;
    }

    // 更新任务
    if (newValue !== originalValue) {
        task[columnName] = newValue;
        gantt.updateTask(taskId);
        console.log('💾 内联编辑保存:', columnName, '=', newValue);
    }

    // 清理
    cleanup(cell, originalContent);
}

/**
 * 取消并关闭编辑器
 */
function cancelAndCloseEditor() {
    if (!activeEditor) return;

    const { cell, originalContent } = activeEditor;
    console.log('❌ 内联编辑取消');

    // 清理
    cleanup(cell, originalContent);
}

/**
 * 清理编辑器
 */
function cleanup(cell, originalContent) {
    cell.innerHTML = originalContent;
    cell.classList.remove('editing');
    activeEditor = null;
    gantt.render();
}

/**
 * 添加内联编辑器样式
 */
export function addInlineEditStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .gantt-inline-editor-container {
            width: 100%;
            height: 100%;
            padding: 2px;
            box-sizing: border-box;
        }

        .gantt-inline-editor {
            width: 100%;
            height: 32px;
            border: 2px solid #9810FA;
            border-radius: 6px;
            padding: 4px 8px;
            font-size: 13px;
            font-family: inherit;
            outline: none;
            box-sizing: border-box;
            background: white;
        }

        .gantt-inline-editor:focus {
            box-shadow: 0 0 0 3px rgba(152, 16, 250, 0.2);
        }

        select.gantt-inline-editor {
            cursor: pointer;
        }

        select.gantt-inline-editor[multiple] {
            height: auto;
            min-height: 60px;
        }

        .gantt_cell.editing {
            padding: 2px !important;
            overflow: visible !important;
            z-index: 10;
        }

        /* 确保编辑器可见 */
        .gantt_row .gantt_cell.editing {
            overflow: visible !important;
        }

        /* F-112: Textarea 编辑器样式 */
        .gantt-textarea-editor {
            height: auto !important;
            min-height: 70px;
            resize: vertical;
            font-size: 12px;
            line-height: 1.4;
        }

        .gantt-summary-cell {
            text-align: left;
            padding: 2px 4px;
        }
    `;
    document.head.appendChild(style);
}
