/**
 * 内联编辑模块
 * 
 * 实现 PRD-竞品改进-v1.0 中的交互优化功能：
 * - 双击单元格进入编辑模式
 * - Input/DatePicker 编辑器
 * - Enter 保存 / Escape 取消
 */

/**
 * 初始化内联编辑功能
 */
export function initInlineEdit() {
    console.log('🔧 初始化内联编辑模块...');

    // 启用 DHTMLX 内置的行内编辑
    gantt.config.inline_input = true;

    // 配置可编辑列
    gantt.config.editor_types = {
        text: {
            show: function (id, column, config, placeholder) {
                const task = gantt.getTask(id);
                const input = document.createElement("input");
                input.type = "text";
                input.value = task[column.name] || "";
                input.className = "gantt-inline-input";
                return input;
            },
            hide: function (input) {
                input.parentNode?.removeChild(input);
            },
            set_value: function (value, id, column, node) {
                node.value = value;
            },
            get_value: function (id, column, node) {
                return node.value;
            },
            is_changed: function (value, id, column, node) {
                return node.value !== (value || "");
            },
            focus: function (node) {
                node.focus();
                node.select();
            }
        }
    };

    // 绑定双击事件
    bindDoubleClickEdit();

    // 绑定键盘事件
    bindKeyboardEvents();

    console.log('✅ 内联编辑模块初始化完成');
}

/**
 * 绑定双击编辑事件
 */
function bindDoubleClickEdit() {
    gantt.attachEvent("onTaskDblClick", function (id, e) {
        const target = e.target;
        const cell = target.closest('.gantt_cell');

        if (cell) {
            const columnName = cell.getAttribute('data-column-name');

            if (columnName === 'text') {
                startInlineEdit(id, columnName, cell);
                return false; // 阻止默认的 lightbox 打开
            }
        }

        return true; // 允许其他列打开 lightbox
    });
}

/**
 * 开始内联编辑
 * @param {number} taskId - 任务 ID
 * @param {string} columnName - 列名
 * @param {HTMLElement} cell - 单元格元素
 */
function startInlineEdit(taskId, columnName, cell) {
    const task = gantt.getTask(taskId);
    const originalValue = task[columnName] || '';

    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalValue;
    input.className = 'gantt-inline-editor';
    input.style.cssText = `
        width: 100%;
        height: 100%;
        border: 2px solid #9810FA;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: inherit;
        font-family: inherit;
        outline: none;
        box-sizing: border-box;
    `;

    // 保存原始内容
    const originalContent = cell.innerHTML;
    cell.innerHTML = '';
    cell.appendChild(input);

    input.focus();
    input.select();

    // 保存函数
    const save = () => {
        const newValue = input.value.trim();
        if (newValue && newValue !== originalValue) {
            task[columnName] = newValue;
            gantt.updateTask(taskId);
            console.log('💾 内联编辑保存:', columnName, '=', newValue);
        }
        cleanup();
    };

    // 取消函数
    const cancel = () => {
        console.log('❌ 内联编辑取消');
        cleanup();
    };

    // 清理函数
    const cleanup = () => {
        cell.innerHTML = originalContent;
        gantt.render();
    };

    // 绑定事件
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    });

    input.addEventListener('blur', () => {
        save();
    });
}

/**
 * 绑定键盘事件
 */
function bindKeyboardEvents() {
    document.addEventListener('keydown', (e) => {
        // 检查是否有活动的内联编辑器
        const activeInput = document.querySelector('.gantt-inline-editor');
        if (activeInput) {
            // 键盘事件由 input 处理
            return;
        }
    });
}

/**
 * 添加内联编辑器样式
 */
export function addInlineEditStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .gantt-inline-editor {
            width: 100%;
            height: 100%;
            border: 2px solid #9810FA;
            border-radius: 6px;
            padding: 4px 8px;
            font-size: inherit;
            font-family: inherit;
            outline: none;
            box-sizing: border-box;
            background: white;
        }
        
        .gantt-inline-editor:focus {
            box-shadow: 0 0 0 3px rgba(152, 16, 250, 0.2);
        }
        
        .gantt_cell.editing {
            padding: 2px !important;
            overflow: visible !important;
        }
    `;
    document.head.appendChild(style);
}
