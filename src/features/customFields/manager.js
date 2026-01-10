/**
 * 自定义字段管理
 */

import { state, reorderFields, removeCustomField, getCustomFieldByName } from '../../core/store.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { refreshLightbox } from '../lightbox/customization.js';
import { FIELD_TYPE_CONFIG } from '../../config/constants.js';
import { addOptionInput } from '../../utils/dom.js';

let sortableInstance = null;

/**
 * 获取字段类型标签
 */
export function getFieldTypeLabel(type) {
    const config = FIELD_TYPE_CONFIG[type];
    return config ? config.label : type;
}

/**
 * 打开字段管理面板
 */
export function openFieldManagementPanel() {
    const panel = document.getElementById('field-management-panel');
    panel.classList.add('open');
    renderFieldList();
}

/**
 * 关闭字段管理面板
 */
export function closeFieldManagementPanel() {
    const panel = document.getElementById('field-management-panel');
    panel.classList.remove('open');
}

/**
 * 渲染字段列表
 */
export function renderFieldList() {
    const container = document.getElementById('field-list-container');
    let html = '';

    state.customFields.forEach((field, index) => {
        html += `
            <div class="field-item" data-field-name="${field.name}">
                <div class="field-drag-handle">⋮⋮</div>
                <div class="field-info">
                    <div class="field-name">${field.label}${field.required ? ' <span style="color: #EF4444;">*</span>' : ''}</div>
                    <div class="field-type-badge">${getFieldTypeLabel(field.type)}</div>
                </div>
                <div class="field-actions">
                    <button class="field-action-btn" data-action="edit" data-field="${field.name}" title="编辑">✏️</button>
                    <button class="field-action-btn" data-action="delete" data-field="${field.name}" title="删除">🗑️</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // 绑定编辑和删除事件
    container.querySelectorAll('.field-action-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const action = this.dataset.action;
            const fieldName = this.dataset.field;
            if (action === 'edit') {
                editField(fieldName);
            } else if (action === 'delete') {
                deleteField(fieldName);
            }
        });
    });

    // 初始化字段拖拽排序
    if (sortableInstance) {
        sortableInstance.destroy();
    }

    if (typeof Sortable !== 'undefined') {
        sortableInstance = new Sortable(container, {
            animation: 150,
            handle: '.field-drag-handle',
            onEnd: function (evt) {
                reorderFields(evt.oldIndex, evt.newIndex);
                updateGanttColumns();
                refreshLightbox();
            }
        });
    }
}

/**
 * 更新字段类型选择器 UI
 */
export function updateFieldTypeSelector(value) {
    const selector = document.getElementById('field-type-selector');
    const dropdown = document.getElementById('field-type-dropdown');

    const config = FIELD_TYPE_CONFIG[value] || FIELD_TYPE_CONFIG['text'];
    const label = getFieldTypeLabel(value);

    // 更新选择器显示
    selector.innerHTML = `
        <span class="field-type-icon ${config.class}">${config.icon}</span>
        <span class="field-type-text">${label}</span>
        <span style="margin-left: auto; color: #9CA3AF;">▼</span>
    `;

    // 更新下拉菜单选中状态
    dropdown.querySelectorAll('.field-type-option').forEach(opt => {
        const isSelected = opt.dataset.value === value;
        opt.classList.toggle('selected', isSelected);

        // 更新勾选图标
        let checkIcon = opt.querySelector('.check-icon');
        if (isSelected) {
            if (!checkIcon) {
                checkIcon = document.createElement('span');
                checkIcon.className = 'check-icon';
                checkIcon.textContent = '✓';
                opt.appendChild(checkIcon);
            }
        } else if (checkIcon) {
            checkIcon.remove();
        }
    });
}

/**
 * 编辑字段
 */
export function editField(fieldName) {
    const field = getCustomFieldByName(fieldName);
    if (!field) return;

    document.getElementById('field-name').value = field.label;
    document.getElementById('field-type').value = field.type;
    document.getElementById('field-required').checked = field.required || false;
    document.getElementById('field-default-value').value = '';

    // 更新字段类型选择器 UI
    updateFieldTypeSelector(field.type);

    // 更新必填字段切换 UI
    const toggle = document.getElementById('required-toggle');
    toggle.classList.toggle('active', field.required || false);

    const optionsConfig = document.getElementById('options-config');
    if (field.type === 'select' || field.type === 'multiselect') {
        optionsConfig.style.display = 'block';
        const optionsList = document.getElementById('options-list');
        optionsList.innerHTML = '';

        if (field.options) {
            field.options.forEach(option => {
                addOptionInput(option);
            });
        }
    } else {
        optionsConfig.style.display = 'none';
    }

    const modal = document.getElementById('field-config-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);

    // 标记为编辑模式
    modal.dataset.editMode = 'true';
    modal.dataset.editFieldName = fieldName;
}

/**
 * 删除字段
 */
export function deleteField(fieldName) {
    const field = getCustomFieldByName(fieldName);
    if (!confirm(`确定要删除字段 "${field?.label}" 吗?`)) {
        return;
    }

    removeCustomField(fieldName);
    updateGanttColumns();
    refreshLightbox();
    renderFieldList();
    showToast('字段删除成功', 'success');
}

/**
 * 初始化自定义字段 UI
 */
export function initCustomFieldsUI() {
    // 新增字段按钮
    document.getElementById('add-field-btn').addEventListener('click', function () {
        const modal = document.getElementById('field-config-modal');
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('show'), 10);

        document.getElementById('field-name').value = '';
        document.getElementById('field-type').value = 'text';
        document.getElementById('field-required').checked = false;
        document.getElementById('field-default-value').value = '';
        document.getElementById('options-config').style.display = 'none';
        document.getElementById('options-list').innerHTML = '';

        // 重置字段类型选择器 UI
        updateFieldTypeSelector('text');

        // 重置必填字段切换
        document.getElementById('required-toggle').classList.remove('active');

        delete modal.dataset.editMode;
        delete modal.dataset.editFieldName;
    });

    // 字段类型选择器点击事件
    document.getElementById('field-type-selector').addEventListener('click', function (e) {
        e.stopPropagation();
        const dropdown = document.getElementById('field-type-dropdown');
        dropdown.classList.toggle('open');
    });

    // 字段类型选项点击事件
    document.querySelectorAll('.field-type-option').forEach(option => {
        option.addEventListener('click', function (e) {
            e.stopPropagation();
            const value = this.dataset.value;
            document.getElementById('field-type').value = value;
            updateFieldTypeSelector(value);
            document.getElementById('field-type-dropdown').classList.remove('open');

            // 触发字段类型变化逻辑
            const optionsConfig = document.getElementById('options-config');
            if (value === 'select' || value === 'multiselect') {
                optionsConfig.style.display = 'block';
            } else {
                optionsConfig.style.display = 'none';
            }
        });
    });

    // 点击外部关闭下拉菜单
    document.addEventListener('click', function () {
        document.getElementById('field-type-dropdown').classList.remove('open');
    });

    // 必填字段行点击事件
    document.getElementById('required-field-row').addEventListener('click', function () {
        const checkbox = document.getElementById('field-required');
        const toggle = document.getElementById('required-toggle');
        checkbox.checked = !checkbox.checked;
        toggle.classList.toggle('active', checkbox.checked);
    });

    // 弹窗关闭按钮
    document.getElementById('modal-close-x').addEventListener('click', function () {
        const modal = document.getElementById('field-config-modal');
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    });

    document.getElementById('add-field-from-panel-btn').addEventListener('click', function () {
        document.getElementById('add-field-btn').click();
    });

    // 字段管理面板
    document.getElementById('close-field-management').addEventListener('click', closeFieldManagementPanel);

    // 字段类型变化
    document.getElementById('field-type').addEventListener('change', function () {
        const type = this.value;
        const optionsConfig = document.getElementById('options-config');
        if (type === 'select' || type === 'multiselect') {
            optionsConfig.style.display = 'block';
        } else {
            optionsConfig.style.display = 'none';
        }
    });

    // 添加选项按钮
    document.getElementById('add-option-btn').addEventListener('click', function () {
        addOptionInput('');
    });

    // 保存字段配置
    document.getElementById('save-field-btn').addEventListener('click', function () {
        const fieldName = document.getElementById('field-name').value.trim();
        const fieldType = document.getElementById('field-type').value;
        const fieldRequired = document.getElementById('field-required').checked;
        const fieldDefaultValue = document.getElementById('field-default-value').value.trim();
        const modal = document.getElementById('field-config-modal');

        if (!fieldName) {
            showToast('请输入字段名称', 'error', 3000);
            return;
        }

        const fieldConfig = {
            name: fieldName.toLowerCase().replace(/\s+/g, '_'),
            label: fieldName,
            type: fieldType,
            width: 100,
            required: fieldRequired
        };

        if (fieldType === 'select' || fieldType === 'multiselect') {
            const options = [];
            document.querySelectorAll('#options-list input[type="text"]').forEach(input => {
                if (input.value.trim()) {
                    options.push(input.value.trim());
                }
            });

            if (options.length === 0) {
                showToast('请至少添加一个选项', 'error', 3000);
                return;
            }

            fieldConfig.options = options;
        }

        // 编辑模式或新增模式
        if (modal.dataset.editMode === 'true') {
            const oldFieldName = modal.dataset.editFieldName;
            const field = getCustomFieldByName(oldFieldName);

            if (field) {
                field.label = fieldName;
                field.type = fieldType;
                field.required = fieldRequired;

                if (fieldType === 'select' || fieldType === 'multiselect') {
                    const options = [];
                    document.querySelectorAll('#options-list input[type="text"]').forEach(input => {
                        if (input.value.trim()) {
                            options.push(input.value.trim());
                        }
                    });

                    if (options.length === 0) {
                        showToast('请至少添加一个选项', 'error', 3000);
                        return;
                    }

                    field.options = options;
                }
            }

            showToast('字段更新成功', 'success');
        } else {
            state.customFields.push(fieldConfig);
            state.fieldOrder.push(fieldConfig.name);

            // 应用默认值到所有现有任务
            if (fieldDefaultValue) {
                gantt.eachTask(function (task) {
                    task[fieldConfig.name] = fieldDefaultValue;
                    gantt.updateTask(task.id);
                });
            }

            showToast('字段创建成功', 'success');
        }

        updateGanttColumns();
        refreshLightbox();
        renderFieldList();

        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    });

    // 取消字段配置
    document.getElementById('cancel-field-btn').addEventListener('click', function () {
        const modal = document.getElementById('field-config-modal');
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    });
}
