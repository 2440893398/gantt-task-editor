/**
 * 自定义字段管理
 */

import {
    state,
    removeCustomField,
    getCustomFieldByName,
    persistCustomFields,
    isSystemField,
    isFieldEnabled,
    toggleSystemFieldEnabled,
    setSystemFieldType
} from '../../core/store.js';
import { SYSTEM_FIELD_CONFIG, INTERNAL_FIELDS } from '../../data/fields.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { refreshLightbox } from '../lightbox/customization.js';
import { FIELD_TYPE_CONFIG, ICON_OPTIONS } from '../../config/constants.js';
import { addOptionInput, setOnOptionsChangeCallback } from '../../utils/dom.js';
import { i18n } from '../../utils/i18n.js';

let sortableInstance = null;
const DEFAULT_FIELD_ICON = '📝';

/**
 * 获取字段类型标签
 */
export function getFieldTypeLabel(type) {
    const config = FIELD_TYPE_CONFIG[type];
    return config ? config.label : type;
}

function getLocalizedFieldTypeLabel(type) {
    const config = FIELD_TYPE_CONFIG[type];
    if (!config) return type;

    // Map type to i18n key
    // assuming type is 'text', 'number', 'date', 'select', 'multiselect'
    const keyMap = {
        'text': 'fieldManagement.typeText',
        'number': 'fieldManagement.typeNumber',
        'date': 'fieldManagement.typeDate',
        'select': 'fieldManagement.typeSelect',
        'multiselect': 'fieldManagement.typeMultiselect'
    };

    return i18n.t(keyMap[type] || 'fieldManagement.typeText');
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
 * 打开新增字段弹窗
 */
export function openAddFieldModal() {
    const modal = document.getElementById('field-config-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);

    document.getElementById('field-name').value = '';
    document.getElementById('field-type').value = 'text';
    document.getElementById('field-required').checked = false;
    document.getElementById('field-default-value').value = '';
    document.getElementById('options-config').style.display = 'none';
    document.getElementById('options-list').innerHTML = '';

    // 重置图标选择为默认值
    updateIconSelector(DEFAULT_FIELD_ICON);

    // 重置字段类型选择器 UI
    updateFieldTypeSelector('text');

    // 重置必填字段切换
    document.getElementById('required-toggle').classList.remove('active');

    delete modal.dataset.editMode;
    delete modal.dataset.editFieldName;
}

/**
 * 更新图标选择器 UI
 */
export function updateIconSelector(icon) {
    document.getElementById('field-icon').value = icon;
    document.getElementById('selected-icon').textContent = icon;

    // 更新图标网格中的选中状态
    document.querySelectorAll('#icon-grid .icon-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.icon === icon);
    });
}

/**
 * 初始化图标选择器
 */
function initIconPicker() {
    const iconGrid = document.getElementById('icon-grid');
    const iconDropdown = document.getElementById('icon-dropdown');
    const iconSelector = document.getElementById('field-icon-selector');

    // 生成图标网格
    let gridHTML = '';
    ICON_OPTIONS.forEach(option => {
        gridHTML += `<div class="icon-option" data-icon="${option.value}" title="${option.label}">${option.value}</div>`;
    });
    iconGrid.innerHTML = gridHTML;

    // 点击图标选择按钮显示/隐藏下拉菜单
    iconSelector.addEventListener('click', function (e) {
        e.stopPropagation();
        iconDropdown.classList.toggle('open');
        // 关闭字段类型下拉菜单
        document.getElementById('field-type-dropdown').classList.remove('open');
    });

    // 点击图标选项
    iconGrid.addEventListener('click', function (e) {
        const option = e.target.closest('.icon-option');
        if (option) {
            const icon = option.dataset.icon;
            updateIconSelector(icon);
            iconDropdown.classList.remove('open');
        }
    });
}

/**
 * Render field list (system + custom fields)
 */
export function renderFieldList() {
    const container = document.getElementById('field-list-container');
    let html = '';

    // Get all manageable fields from fieldOrder
    const manageableFields = state.fieldOrder.filter(fieldName => {
        // Exclude internal fields
        if (INTERNAL_FIELDS.includes(fieldName)) return false;
        // Include system fields that are in SYSTEM_FIELD_CONFIG
        if (SYSTEM_FIELD_CONFIG[fieldName]) return true;
        // Include custom fields
        return state.customFields.some(f => f.name === fieldName);
    });

    manageableFields.forEach((fieldName) => {
        const isSystem = !!SYSTEM_FIELD_CONFIG[fieldName];
        let fieldConfig;
        let fieldLabel;
        let fieldIcon;
        let fieldType;

        if (isSystem) {
            fieldConfig = SYSTEM_FIELD_CONFIG[fieldName];
            fieldLabel = i18n.t(fieldConfig.i18nKey) || fieldName;
            fieldIcon = getSystemFieldIcon(fieldName);
            fieldType = fieldConfig.type;
        } else {
            fieldConfig = state.customFields.find(f => f.name === fieldName);
            if (!fieldConfig) return;
            fieldLabel = fieldConfig.label;
            fieldIcon = fieldConfig.icon || DEFAULT_FIELD_ICON;
            fieldType = fieldConfig.type;
        }

        const enabled = isSystem ? isFieldEnabled(fieldName) : true;
        const canDisable = isSystem && fieldConfig.canDisable;

        html += `
            <div class="flex items-center gap-3 p-3 bg-base-100 border border-base-200 rounded-lg shadow-sm hover:shadow-md transition-all group ${!enabled ? 'opacity-50' : ''}" data-field-name="${fieldName}">
                <div class="field-drag-handle cursor-move text-base-content/30 hover:text-primary flex flex-col justify-center leading-none text-xs">⋮⋮</div>
                <div class="w-10 h-10 flex items-center justify-center bg-primary/10 rounded-lg text-xl shrink-0">${fieldIcon}</div>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm truncate flex items-center gap-2">
                        ${fieldLabel}
                        <span class="badge badge-xs ${isSystem ? 'badge-info' : 'badge-success'}">${isSystem ? i18n.t('fieldManagement.systemTag') : i18n.t('fieldManagement.customTag')}</span>
                    </div>
                    <div class="mt-1">
                        <span class="badge badge-sm badge-ghost text-xs text-base-content/70">${getLocalizedFieldTypeLabel(fieldType)}</span>
                    </div>
                </div>
                <div class="flex gap-1 items-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    ${canDisable ? `
                        <label class="swap swap-flip">
                            <input type="checkbox" class="toggle-field-enabled" data-field="${fieldName}" ${enabled ? 'checked' : ''}>
                            <div class="swap-on btn btn-xs btn-success">${i18n.t('fieldManagement.enableField')}</div>
                            <div class="swap-off btn btn-xs btn-ghost">${i18n.t('fieldManagement.disableField')}</div>
                        </label>
                    ` : ''}
                    <button class="field-action-btn btn btn-ghost btn-xs btn-square" data-action="edit" data-field="${fieldName}" title="${i18n.t('form.save')}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    ${!isSystem ? `
                        <button class="field-action-btn btn btn-ghost btn-xs btn-square text-error" data-action="delete" data-field="${fieldName}" title="${i18n.t('form.delete')}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Bind edit and delete events
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

    // Bind enable/disable toggle events
    container.querySelectorAll('.toggle-field-enabled').forEach(toggle => {
        toggle.addEventListener('change', function (e) {
            e.stopPropagation();
            const fieldName = this.dataset.field;
            const enabled = this.checked;
            toggleSystemFieldEnabled(fieldName, enabled);
            // Refresh UI to reflect linked field changes
            renderFieldList();
            updateGanttColumns();
            refreshLightbox();
        });
    });

    // Initialize drag-and-drop sorting
    if (sortableInstance) {
        sortableInstance.destroy();
    }

    if (typeof Sortable !== 'undefined') {
        sortableInstance = new Sortable(container, {
            animation: 150,
            handle: '.field-drag-handle',
            onEnd: function (evt) {
                // Update fieldOrder based on new positions
                const items = container.querySelectorAll('[data-field-name]');
                const newOrder = Array.from(items).map(item => item.dataset.fieldName);

                // Merge with internal fields to preserve complete fieldOrder
                state.fieldOrder = state.fieldOrder.filter(f => INTERNAL_FIELDS.includes(f));
                state.fieldOrder = [...newOrder, ...state.fieldOrder.filter(f => !newOrder.includes(f))];

                updateGanttColumns();
                refreshLightbox();
                persistCustomFields();
            }
        });
    }
}

/**
 * Get icon for system field
 */
function getSystemFieldIcon(fieldName) {
    const iconMap = {
        text: '📝',
        description: '📄',
        priority: '🔥',
        assignee: '👤',
        status: '📊',
        progress: '📈',
        start_date: '📅',
        end_date: '🏁',
        duration: '⏱️',
        actual_start: '▶️',
        actual_end: '⏹️',
        actual_hours: '⏰'
    };
    return iconMap[fieldName] || '📝';
}

/**
 * 更新字段类型选择器 UI
 */
export function updateFieldTypeSelector(value) {
    const selector = document.getElementById('field-type-selector');
    const dropdown = document.getElementById('field-type-dropdown');
    const iconEl = document.getElementById('field-type-icon');
    const textEl = selector.querySelector('.field-type-text');

    const config = FIELD_TYPE_CONFIG[value] || FIELD_TYPE_CONFIG['text'];
    const label = getLocalizedFieldTypeLabel(value);

    // 更新选择器显示
    if (iconEl) {
        iconEl.textContent = config.icon;
    }
    if (textEl) {
        textEl.textContent = label;
    }

    // 更新下拉菜单选中状态
    dropdown.querySelectorAll('.field-type-option').forEach(opt => {
        const isSelected = opt.dataset.value === value;
        // Tailwind styling for selection state
        opt.classList.toggle('bg-primary/10', isSelected);
        opt.classList.toggle('text-primary', isSelected);
        opt.classList.toggle('hover:bg-base-200', !isSelected);

        // 更新勾选图标
        let checkIcon = opt.querySelector('.check-icon');
        if (isSelected) {
            if (!checkIcon) {
                checkIcon = document.createElement('span');
                checkIcon.className = 'check-icon ml-auto font-bold text-primary';
                checkIcon.textContent = '✓';
                opt.appendChild(checkIcon);
            }
        } else if (checkIcon) {
            checkIcon.remove();
        }
    });

    // 同时更新默认值输入框
    updateDefaultValueInput(value);
}

/**
 * 更新默认值输入框（根据字段类型动态切换）
 */
export function updateDefaultValueInput(fieldType) {
    const container = document.getElementById('default-value-input-container');
    const configSection = document.getElementById('default-value-config');

    if (!container) return;

    // 显示默认值配置区域
    if (configSection) {
        configSection.style.display = 'block';
    }

    let inputHTML = '';
    const placeholder = i18n.t('fieldManagement.defaultPlaceholder');
    const selectPlaceholder = i18n.t('form.selectPlaceholder');

    switch (fieldType) {
        case 'number':
            inputHTML = `<input type="number" id="field-default-value"
                class="input input-sm input-bordered w-full bg-white"
                placeholder="${placeholder}">`;
            break;
        case 'date':
            inputHTML = `<input type="date" id="field-default-value"
                class="input input-sm input-bordered w-full bg-white">`;
            break;
        case 'select':
            // 从选项列表中获取选项
            inputHTML = `<select id="field-default-value" class="select select-sm select-bordered w-full bg-white">
                <option value="">${selectPlaceholder}</option>
            </select>
            <p class="text-xs text-gray-400 mt-1" data-i18n="fieldManagement.defaultSelectHint">${i18n.t('fieldManagement.defaultSelectHint')}</p>`;
            break;
        case 'multiselect':
            // 多选下拉框
            inputHTML = `<select id="field-default-value" class="select select-sm select-bordered w-full bg-white" multiple style="min-height: 80px;">
            </select>
            <p class="text-xs text-gray-400 mt-1" data-i18n="fieldManagement.defaultMultiselectHint">${i18n.t('fieldManagement.defaultMultiselectHint')}</p>`;
            break;
        case 'text':
        default:
            inputHTML = `<input type="text" id="field-default-value"
                class="input input-sm input-bordered w-full bg-white"
                placeholder="${placeholder}">`;
            break;
    }

    container.innerHTML = inputHTML;

    // 对于 select 和 multiselect，需要填充选项
    if (fieldType === 'select' || fieldType === 'multiselect') {
        updateDefaultValueOptions();
    }
}

/**
 * 更新默认值下拉框的选项（从选项列表中获取）
 */
export function updateDefaultValueOptions() {
    const fieldType = document.getElementById('field-type').value;
    const defaultValueSelect = document.getElementById('field-default-value');

    if (!defaultValueSelect || (fieldType !== 'select' && fieldType !== 'multiselect')) {
        return;
    }

    // 获取当前已配置的选项
    const options = [];
    document.querySelectorAll('#options-list input[type="text"]').forEach(input => {
        if (input.value.trim()) {
            options.push(input.value.trim());
        }
    });

    // 保留当前选中的值
    const currentValue = defaultValueSelect.value;
    const currentValues = fieldType === 'multiselect'
        ? Array.from(defaultValueSelect.selectedOptions).map(o => o.value)
        : [currentValue];

    // 重新生成选项
    if (fieldType === 'select') {
        const selectPlaceholder = i18n.t('form.selectPlaceholder');
        defaultValueSelect.innerHTML = `<option value="">${selectPlaceholder}</option>`;
        options.forEach(opt => {
            const selected = currentValues.includes(opt) ? 'selected' : '';
            defaultValueSelect.innerHTML += `<option value="${opt}" ${selected}>${opt}</option>`;
        });
    } else {
        defaultValueSelect.innerHTML = '';
        options.forEach(opt => {
            const selected = currentValues.includes(opt) ? 'selected' : '';
            defaultValueSelect.innerHTML += `<option value="${opt}" ${selected}>${opt}</option>`;
        });
    }
}

/**
 * 编辑字段
 */
/**
 * Edit field (routes to appropriate modal)
 */
export function editField(fieldName) {
    if (isSystemField(fieldName)) {
        openSystemFieldEditModal(fieldName);
    } else {
        openCustomFieldEditModal(fieldName);
    }
}

/**
 * Open edit modal for custom field (original logic)
 */
function openCustomFieldEditModal(fieldName) {
    const field = getCustomFieldByName(fieldName);
    if (!field) return;

    document.getElementById('field-name').value = field.label;
    document.getElementById('field-type').value = field.type;
    document.getElementById('field-required').checked = field.required || false;
    document.getElementById('field-default-value').value = '';

    updateIconSelector(field.icon || DEFAULT_FIELD_ICON);
    updateFieldTypeSelector(field.type);

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

    modal.dataset.editMode = 'true';
    modal.dataset.editFieldName = fieldName;
}

/**
 * Open edit modal for system field
 */
function openSystemFieldEditModal(fieldName) {
    const config = SYSTEM_FIELD_CONFIG[fieldName];
    if (!config) return;

    const currentType = state.systemFieldSettings.typeOverrides[fieldName] || config.type;
    const fieldLabel = i18n.t(config.i18nKey) || fieldName;

    // Create modal HTML
    const modalHtml = `
        <div id="system-field-modal" class="modal modal-open">
            <div class="modal-box max-w-md">
                <h3 class="font-bold text-lg mb-4">${i18n.t('fieldManagement.editSystemField')}</h3>

                <div class="form-control mb-4">
                    <label class="label">
                        <span class="label-text">${i18n.t('fieldManagement.fieldName')}</span>
                    </label>
                    <input type="text" value="${fieldLabel}" disabled class="input input-bordered input-disabled bg-base-200">
                    <label class="label">
                        <span class="label-text-alt text-base-content/60">${i18n.t('fieldManagement.systemFieldNameHint')}</span>
                    </label>
                </div>

                <div class="form-control mb-4">
                    <label class="label">
                        <span class="label-text">${i18n.t('fieldManagement.fieldType')}</span>
                    </label>
                    ${config.allowedTypes.length > 1 ? `
                        <select id="system-field-type-select" class="select select-bordered w-full">
                            ${config.allowedTypes.map(type => `
                                <option value="${type}" ${type === currentType ? 'selected' : ''}>
                                    ${i18n.t('fieldTypes.' + type)}
                                </option>
                            `).join('')}
                        </select>
                    ` : `
                        <input type="text" value="${i18n.t('fieldTypes.' + config.type)}" disabled class="input input-bordered input-disabled bg-base-200">
                        <label class="label">
                            <span class="label-text-alt text-base-content/60">${i18n.t('fieldManagement.typeNotEditable')}</span>
                        </label>
                    `}
                </div>

                <div class="modal-action">
                    <button id="system-field-cancel-btn" class="btn">${i18n.t('form.cancel')}</button>
                    <button id="system-field-save-btn" class="btn btn-primary">${i18n.t('form.save')}</button>
                </div>
            </div>
            <div class="modal-backdrop" id="system-field-backdrop"></div>
        </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('system-field-modal');
    if (existingModal) existingModal.remove();

    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Bind events
    const modal = document.getElementById('system-field-modal');
    const cancelBtn = document.getElementById('system-field-cancel-btn');
    const saveBtn = document.getElementById('system-field-save-btn');
    const backdrop = document.getElementById('system-field-backdrop');
    const typeSelect = document.getElementById('system-field-type-select');

    const closeModal = () => modal.remove();

    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    saveBtn.addEventListener('click', () => {
        if (typeSelect) {
            const newType = typeSelect.value;
            if (newType !== currentType) {
                setSystemFieldType(fieldName, newType);
                updateGanttColumns();
                refreshLightbox();
                renderFieldList();
                showToast(i18n.t('message.saveSuccess'), 'success');
            }
        }
        closeModal();
    });
}

// 待删除的字段名称
let pendingDeleteFieldName = null;

/**
 * 显示删除确认弹窗
 */
export function showDeleteConfirmModal(fieldName) {
    const field = getCustomFieldByName(fieldName);
    if (!field) return;

    pendingDeleteFieldName = fieldName;

    const modal = document.getElementById('delete-confirm-modal');
    const message = document.getElementById('delete-confirm-message');

    // 更新确认消息
    message.textContent = i18n.t('fieldManagement.deleteMessage', { name: field.label });

    modal.showModal();
}

/**
 * 确认删除字段
 */
export function confirmDeleteField() {
    if (!pendingDeleteFieldName) return;

    removeCustomField(pendingDeleteFieldName);
    updateGanttColumns();
    refreshLightbox();
    renderFieldList();

    // 持久化字段配置到缓存
    persistCustomFields();

    showToast(i18n.t('message.deleteSuccess'), 'success');

    // 关闭弹窗并清理状态
    const modal = document.getElementById('delete-confirm-modal');
    modal.close();
    pendingDeleteFieldName = null;
}

/**
 * 取消删除
 */
export function cancelDeleteField() {
    const modal = document.getElementById('delete-confirm-modal');
    modal.close();
    pendingDeleteFieldName = null;
}

/**
 * 删除字段 (显示确认弹窗)
 */
export function deleteField(fieldName) {
    showDeleteConfirmModal(fieldName);
}

/**
 * 初始化自定义字段 UI
 */
export function initCustomFieldsUI() {
    // 注册选项变化回调，用于更新默认值下拉框
    setOnOptionsChangeCallback(updateDefaultValueOptions);

    // 编辑字段按钮 - 打开字段管理面板
    document.getElementById('add-field-btn').addEventListener('click', function () {
        openFieldManagementPanel();
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
        document.getElementById('icon-dropdown').classList.remove('open');
    });

    // 初始化图标选择器
    initIconPicker();

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
        openAddFieldModal();
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
        const fieldIcon = document.getElementById('field-icon').value || DEFAULT_FIELD_ICON;
        const modal = document.getElementById('field-config-modal');

        // 获取默认值（支持多选）
        let fieldDefaultValue = '';
        const defaultValueEl = document.getElementById('field-default-value');
        if (defaultValueEl) {
            if (fieldType === 'multiselect' && defaultValueEl.multiple) {
                fieldDefaultValue = Array.from(defaultValueEl.selectedOptions).map(o => o.value).join(',');
            } else {
                fieldDefaultValue = defaultValueEl.value.trim();
            }
        }

        if (!fieldName) {
            showToast(i18n.t('message.validationError'), 'error', 3000);
            return;
        }

        const fieldConfig = {
            name: fieldName.toLowerCase().replace(/\s+/g, '_'),
            label: fieldName,
            type: fieldType,
            icon: fieldIcon,
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
                showToast(i18n.t('message.validationError'), 'error', 3000);
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
                field.icon = fieldIcon;
                field.required = fieldRequired;

                if (fieldType === 'select' || fieldType === 'multiselect') {
                    const options = [];
                    document.querySelectorAll('#options-list input[type="text"]').forEach(input => {
                        if (input.value.trim()) {
                            options.push(input.value.trim());
                        }
                    });

                    if (options.length === 0) {
                        showToast(i18n.t('message.validationError'), 'error', 3000);
                        return;
                    }

                    field.options = options;
                }
            }

            showToast(i18n.t('message.saveSuccess'), 'success');
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

            showToast(i18n.t('message.saveSuccess'), 'success');
        }

        updateGanttColumns();
        refreshLightbox();
        renderFieldList();

        // 持久化字段配置到缓存
        persistCustomFields();

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

    // 删除确认弹窗 - 确认按钮
    document.getElementById('delete-confirm-btn').addEventListener('click', confirmDeleteField);

    // 删除确认弹窗 - 取消按钮
    document.getElementById('delete-cancel-btn').addEventListener('click', cancelDeleteField);

    // 暴露给全局 (Fix: 添加字段按钮点击报错)
    window.openFieldManagementPanel = openFieldManagementPanel;
}
