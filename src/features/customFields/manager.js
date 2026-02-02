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
    setSystemFieldType,
    getSystemFieldOptions,
    getSystemFieldDefaultValue
} from '../../core/store.js';

import { SYSTEM_FIELD_CONFIG, INTERNAL_FIELDS } from '../../data/fields.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';
import { refreshLightbox } from '../lightbox/customization.js';
import { FIELD_TYPE_CONFIG, ICON_OPTIONS } from '../../config/constants.js';
import { addOptionInput, setOnOptionsChangeCallback, escapeAttr } from '../../utils/dom.js';
import { i18n } from '../../utils/i18n.js';
import { refreshTaskDetailsPanel } from '../task-details/index.js';
import { showConfirmDialog } from '../../components/common/confirm-dialog.js';

let sortableInstance = null;
const DEFAULT_FIELD_ICON = '📝';
let fieldConfigEscHandler = null;
let fieldDrawerEscHandler = null;

function closeFieldConfigModal() {
    const modal = document.getElementById('field-config-modal');
    if (!modal) return;

    modal.classList.remove('show');

    if (fieldConfigEscHandler) {
        document.removeEventListener('keydown', fieldConfigEscHandler);
        fieldConfigEscHandler = null;
    }

    setTimeout(() => {
        modal.style.display = 'none';
        modal.style.zIndex = '';
    }, 300);
}

function attachFieldConfigEscClose() {
    if (fieldConfigEscHandler) return;

    fieldConfigEscHandler = (e) => {
        if (e.key !== 'Escape') return;
        const modal = document.getElementById('field-config-modal');
        if (!modal) return;
        if (!modal.classList.contains('show')) return;
        closeFieldConfigModal();
    };
    document.addEventListener('keydown', fieldConfigEscHandler);
}

function openFieldManagementBackdrop() {
    const backdrop = document.getElementById('field-management-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => backdrop.classList.remove('opacity-0'));
}

function closeFieldManagementBackdrop() {
    const backdrop = document.getElementById('field-management-backdrop');
    if (!backdrop) return;
    backdrop.classList.add('opacity-0');
    setTimeout(() => backdrop.classList.add('hidden'), 200);
}

function attachFieldDrawerEscClose() {
    if (fieldDrawerEscHandler) return;

    fieldDrawerEscHandler = (e) => {
        if (e.key !== 'Escape') return;
        const panel = document.getElementById('field-management-panel');
        if (!panel) return;
        if (!panel.classList.contains('open')) return;
        closeFieldManagementPanel();
    };
    document.addEventListener('keydown', fieldDrawerEscHandler);
}

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
    openFieldManagementBackdrop();
    attachFieldDrawerEscClose();
    renderFieldList();
}

/**
 * 关闭字段管理面板
 */
export function closeFieldManagementPanel() {
    const panel = document.getElementById('field-management-panel');
    panel.classList.remove('open');
    closeFieldManagementBackdrop();

    if (fieldDrawerEscHandler) {
        document.removeEventListener('keydown', fieldDrawerEscHandler);
        fieldDrawerEscHandler = null;
    }
}

/**
 * 打开新增字段弹窗
 */
export function openAddFieldModal() {
    const modal = document.getElementById('field-config-modal');
    // 如果字段管理面板 z-index 已提升，同步提升弹窗 z-index
    const panel = document.getElementById('field-management-panel');
    if (panel && parseInt(panel.style.zIndex) > 50) {
        modal.style.zIndex = '6200';
    }
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    attachFieldConfigEscClose();

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

    // 1. Get all available fields
    const allSystemFields = Object.keys(SYSTEM_FIELD_CONFIG).filter(f => !INTERNAL_FIELDS.includes(f));
    const allCustomFields = state.customFields.map(f => f.name);
    const allFields = [...new Set([...allSystemFields, ...allCustomFields])];

    // 2. Sort fields: Custom order first (enabled fields), then disabled fields
    const sortedFields = [];

    // First: fields currently in enabled order
    state.fieldOrder.forEach(f => {
        if (allFields.includes(f)) {
            sortedFields.push(f);
        }
    });

    // Second: fields not in enabled order (disabled)
    allFields.forEach(f => {
        if (!state.fieldOrder.includes(f)) {
            sortedFields.push(f);
        }
    });

    sortedFields.forEach((fieldName) => {
        const isSystem = !!SYSTEM_FIELD_CONFIG[fieldName];
        let fieldConfig;
        let fieldLabel;
        let fieldIcon;
        let fieldType;
        let canDisable = true; // Default true

        if (isSystem) {
            fieldConfig = SYSTEM_FIELD_CONFIG[fieldName];
            fieldLabel = i18n.t(fieldConfig.i18nKey) || fieldName;
            fieldIcon = getSystemFieldIcon(fieldName);
            fieldType = fieldConfig.type;
            canDisable = fieldConfig.canDisable;
        } else {
            fieldConfig = state.customFields.find(f => f.name === fieldName);
            if (!fieldConfig) return;
            fieldLabel = fieldConfig.label;
            fieldIcon = fieldConfig.icon || DEFAULT_FIELD_ICON;
            fieldType = fieldConfig.type;
            canDisable = true; // Custom fields are always togglable
        }

        const enabled = isSystem
            ? isFieldEnabled(fieldName)  // System fields use systemFieldSettings.enabled
            : state.fieldOrder.includes(fieldName);  // Custom fields use fieldOrder


        html += `
            <div class="field-item flex items-center gap-[10px] p-3 transition-all group ${!enabled ? 'opacity-60' : ''} h-16 bg-base-100 border border-base-300 rounded-xl"
                 data-field-name="${fieldName}"
                 data-field-label="${escapeAttr(fieldLabel)}"
                 role="button" tabindex="0">
                <div class="field-drag-handle cursor-move flex items-center justify-center w-4 shrink-0 text-base-300">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                </div>

                <div class="w-8 h-8 flex items-center justify-center rounded-[8px] text-lg shrink-0 bg-sky-100 text-primary ${!enabled ? 'grayscale' : ''}">
                    ${fieldIcon}
                </div>

                <div class="flex-1 min-w-0 flex flex-col gap-1">
                    <div class="text-sm font-semibold truncate leading-none text-base-content">
                        ${fieldLabel}
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="badge badge-ghost text-base-content/60 text-[10px]">
                            ${isSystem ? i18n.t('fieldManagement.systemTag') : i18n.t('fieldManagement.customTag')}
                        </span>
                        <span class="badge badge-ghost text-base-content/60 text-[10px]">
                            ${getLocalizedFieldTypeLabel(fieldType)}
                        </span>
                    </div>
                </div>

                <div class="flex gap-2 items-center opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    ${canDisable ? `
                        <label title="${enabled ? i18n.t('fieldManagement.disableField') : i18n.t('fieldManagement.enableField')}" class="inline-flex items-center">
                            <input type="checkbox" class="toggle toggle-primary toggle-field-enabled" data-field="${fieldName}" ${enabled ? 'checked' : ''}>
                        </label>
                    ` : `
                        <div class="flex items-center text-[14px] text-base-content/60" title="${i18n.t('fieldManagement.required')}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-[14px] w-[14px]" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                    `}

                    ${!isSystem ? `
                        <button class="field-action-btn w-8 h-8 inline-flex items-center justify-center rounded-[8px] bg-base-100 border border-base-300 text-error"
                            data-action="delete" data-field="${fieldName}" title="${i18n.t('form.delete')}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Click item to edit (system/custom)
    container.querySelectorAll('[data-field-name]').forEach(item => {
        item.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.field-action-btn');
            const toggle = e.target.closest('.toggle-field-enabled');
            if (actionBtn || toggle) return;
            editField(item.dataset.fieldName);
        });
        item.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            editField(item.dataset.fieldName);
        });
    });

    // Bind delete events
    container.querySelectorAll('.field-action-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const fieldName = this.dataset.field;
            deleteField(fieldName);
        });
    });

    // Bind enable/disable toggle events
    container.querySelectorAll('.toggle-field-enabled').forEach(toggle => {
        toggle.addEventListener('change', function (e) {
            e.stopPropagation();
            const fieldName = this.dataset.field;
            const enabled = this.checked;
            toggleSystemFieldEnabled(fieldName, enabled);
            // Refresh UI to reflect changes
            renderFieldList();
            updateGanttColumns();
            refreshLightbox();
            refreshTaskDetailsPanel();
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
            draggable: '[data-field-name]', // dragging only items
            onEnd: function (evt) {
                // Update fieldOrder based on new positions
                const items = container.querySelectorAll('[data-field-name]');
                const newOrderFromDOM = Array.from(items).map(item => item.dataset.fieldName);

                // Reconstruct state.fieldOrder:
                // It should contain:
                // 1. Internal fields (hidden ones that we want to keep enabled if they are) -> INTERNAL_FIELDS
                // 2. Visible enabled fields from DOM (toggles checked)
                // Wait, sortable works on the list which includes disabled items now!
                // We should NOT add ALL items to `state.fieldOrder`. Only ENABLED items should be in `state.fieldOrder`.
                // Sorting disabled items doesn't really matter for Gantt, but it might matter for user preference if they re-enable it.
                // However, `state.fieldOrder` defines columns. If we put disabled fields in it, they will show up.

                // So: we iterate the DOM order. If the item is marked as enabled (checkbox is checked), we add it to the new order.
                // For internal fields (which are not in DOM), we keep them as is?
                // INTERNAL_FIELDS are usually things like 'id', 'open', 'type' which are always needed by Gantt but maybe hidden or implicitly handled?
                // Let's check how `fieldOrder` is initialized.
                // `defaultFieldOrder` contains 'text', 'priority', ...

                // Strategy: 
                // We regenerate `state.fieldOrder` by taking the new DOM order, filtering only ENABLED ones.
                // AND we must preserve any hidden INTERNAL/System fields that were already in the order but not in the manager list?
                // Accessing `toggle-field-enabled` checkbox for checked state is reliable.

                const enabledFields = [];
                items.forEach(item => {
                    const checkbox = item.querySelector('.toggle-field-enabled');
                    // If checkbox exists and checked, OR if no checkbox (system required fields), include it.
                    // System required fields (canDisable=false) don't have checkbox in my new HTML above? 
                    // Wait, logic says `if canDisable` render checkbox. If CANNOT disable, it is enabled by default?
                    // Yes, `const enabled = state.fieldOrder.includes(fieldName);`.
                    // If canDisable is false, we should assume it stays enabled.

                    if (checkbox) {
                        if (checkbox.checked) {
                            enabledFields.push(item.dataset.fieldName);
                        }
                    } else {
                        // Not togglable, means mandatory enabled
                        enabledFields.push(item.dataset.fieldName);
                    }
                });

                // Preserve internal fields that are not in the valid "manageable" list
                const internalFieldsPreserved = state.fieldOrder.filter(f => INTERNAL_FIELDS.includes(f));

                // Combine
                const uniqueNewOrder = [...new Set([...enabledFields, ...internalFieldsPreserved])];

                // NOTE: The order of enabledFields comes from DOM order, which the user just dragged. This handles reordering correctly.

                state.fieldOrder = uniqueNewOrder;

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
    // 如果字段管理面板 z-index 已提升，同步提升弹窗 z-index
    const panel = document.getElementById('field-management-panel');
    if (panel && parseInt(panel.style.zIndex) > 50) {
        modal.style.zIndex = '6200';
    }
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('show'), 10);
    attachFieldConfigEscClose();

    modal.dataset.editMode = 'true';
    modal.dataset.editFieldName = fieldName;
}

/**
 * Open edit modal for system field
 */
function openSystemFieldEditModal(fieldName) {
    const config = SYSTEM_FIELD_CONFIG[fieldName];
    if (!config) return;

    // Get current type (handle both old string format and new object format)
    const override = state.systemFieldSettings.typeOverrides[fieldName];
    let currentType = config.type;
    let currentOptions = [];
    let currentDefaultValue = '';

    if (override) {
        if (typeof override === 'object') {
            currentType = override.type || config.type;
            currentOptions = override.options || [];
            currentDefaultValue = override.defaultValue || '';
        } else if (typeof override === 'string') {
            currentType = override;
        }
    }

    const fieldLabel = i18n.t(config.i18nKey) || fieldName;
    const isSelectType = currentType === 'select' || currentType === 'multiselect';

    // Create modal HTML with options configuration section
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

                <!-- Options configuration section (for select/multiselect) -->
                <div id="system-field-options-section" class="form-control mb-4 ${isSelectType ? '' : 'hidden'}">
                    <label class="label">
                        <span class="label-text">${i18n.t('fieldManagement.options')}</span>
                    </label>
                    <div id="system-field-options-list" class="space-y-2 mb-2">
                        ${currentOptions.map(opt => `
                            <div class="flex gap-2 items-center">
                                <input type="text" class="input input-sm input-bordered flex-1 system-field-option-input" value="${opt}">
                                <button type="button" class="btn btn-ghost btn-xs btn-circle text-error system-field-remove-option">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" id="system-field-add-option-btn" class="btn btn-sm btn-ghost btn-outline border-dashed w-full gap-2">
                        + ${i18n.t('fieldManagement.addOption')}
                    </button>
                </div>

                <!-- Default value section (for select/multiselect) -->
                <div id="system-field-default-section" class="form-control mb-4 ${isSelectType ? '' : 'hidden'}">
                    <label class="label">
                        <span class="label-text">${i18n.t('fieldManagement.defaultOneTime')}</span>
                    </label>
                    <select id="system-field-default-value" class="select select-sm select-bordered w-full">
                        <option value="">${i18n.t('form.selectPlaceholder')}</option>
                        ${currentOptions.map(opt => `
                            <option value="${opt}" ${opt === currentDefaultValue ? 'selected' : ''}>${opt}</option>
                        `).join('')}
                    </select>
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

    // 如果字段管理面板 z-index 已提升，同步提升系统字段弹窗
    const fieldPanel = document.getElementById('field-management-panel');
    if (fieldPanel && parseInt(fieldPanel.style.zIndex) > 50) {
        document.getElementById('system-field-modal').style.zIndex = '6200';
    }

    // Bind events
    const modal = document.getElementById('system-field-modal');
    const cancelBtn = document.getElementById('system-field-cancel-btn');
    const saveBtn = document.getElementById('system-field-save-btn');
    const backdrop = document.getElementById('system-field-backdrop');
    const typeSelect = document.getElementById('system-field-type-select');
    const optionsSection = document.getElementById('system-field-options-section');
    const defaultSection = document.getElementById('system-field-default-section');
    const optionsList = document.getElementById('system-field-options-list');
    const addOptionBtn = document.getElementById('system-field-add-option-btn');
    const defaultValueSelect = document.getElementById('system-field-default-value');

    const closeModal = () => modal.remove();

    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    // Function to add a new option input
    const addNewOption = (value = '') => {
        const optionHtml = `
            <div class="flex gap-2 items-center">
                <input type="text" class="input input-sm input-bordered flex-1 system-field-option-input" value="${value}">
                <button type="button" class="btn btn-ghost btn-xs btn-circle text-error system-field-remove-option">✕</button>
            </div>
        `;
        optionsList.insertAdjacentHTML('beforeend', optionHtml);
        updateDefaultValueOptions();
    };

    // Function to update default value dropdown options
    const updateDefaultValueOptions = () => {
        const options = [];
        optionsList.querySelectorAll('.system-field-option-input').forEach(input => {
            if (input.value.trim()) {
                options.push(input.value.trim());
            }
        });

        const currentDefaultVal = defaultValueSelect.value;
        defaultValueSelect.innerHTML = `<option value="">${i18n.t('form.selectPlaceholder')}</option>`;
        options.forEach(opt => {
            const selected = opt === currentDefaultVal ? 'selected' : '';
            defaultValueSelect.innerHTML += `<option value="${opt}" ${selected}>${opt}</option>`;
        });
    };

    // Add option button handler
    if (addOptionBtn) {
        addOptionBtn.addEventListener('click', () => addNewOption(''));
    }

    // Remove option button handler (delegated)
    if (optionsList) {
        optionsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('system-field-remove-option')) {
                e.target.closest('.flex').remove();
                updateDefaultValueOptions();
            }
        });

        // Update default value options when option inputs change
        optionsList.addEventListener('input', () => {
            updateDefaultValueOptions();
        });
    }

    // Type change handler - show/hide options section
    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            const newType = typeSelect.value;
            const showOptions = newType === 'select' || newType === 'multiselect';
            optionsSection.classList.toggle('hidden', !showOptions);
            defaultSection.classList.toggle('hidden', !showOptions);
        });
    }

    // Save handler
    saveBtn.addEventListener('click', () => {
        const newType = typeSelect ? typeSelect.value : currentType;
        const isNewSelectType = newType === 'select' || newType === 'multiselect';

        // Collect options if select/multiselect type
        let options = null;
        let defaultValue = null;

        if (isNewSelectType) {
            options = [];
            optionsList.querySelectorAll('.system-field-option-input').forEach(input => {
                if (input.value.trim()) {
                    options.push(input.value.trim());
                }
            });

            // Validate: must have at least one option for select types
            if (options.length === 0) {
                showToast(i18n.t('message.validationError'), 'error');
                return;
            }

            defaultValue = defaultValueSelect.value || null;
        }

        // Save changes
        setSystemFieldType(fieldName, newType, options, defaultValue);
        updateGanttColumns();
        refreshLightbox();
        renderFieldList();
        refreshTaskDetailsPanel();
        showToast(i18n.t('message.saveSuccess'), 'success');
        closeModal();
    });
}


/**
 * 显示删除确认弹窗
 */
export function showDeleteConfirmModal(fieldName) {
    const field = getCustomFieldByName(fieldName);
    if (!field) return;

    showConfirmDialog({
        icon: 'trash-2',
        variant: 'danger',
        title: i18n.t('fieldManagement.deleteTitle') || '确认删除',
        message: i18n.t('fieldManagement.deleteMessage', { name: field.label }) || '确定要删除此字段吗？此操作无法撤销。',
        confirmText: i18n.t('form.delete') || '删除',
        cancelText: i18n.t('form.cancel') || '取消',
        onConfirm: () => {
            removeCustomField(fieldName);
            updateGanttColumns();
            refreshLightbox();
            renderFieldList();
            refreshTaskDetailsPanel();

            // 持久化字段配置到缓存
            persistCustomFields();

            showToast(i18n.t('message.deleteSuccess'), 'success');
        }
    });
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
    document.getElementById('modal-close-x').addEventListener('click', closeFieldConfigModal);

    document.getElementById('add-field-from-panel-btn').addEventListener('click', function () {
        openAddFieldModal();
    });

    // 设置按钮（预留功能）
    document.getElementById('field-settings-btn')?.addEventListener('click', function () {
        showToast(i18n.t('message.comingSoon') || '功能开发中', 'info');
    });

    // 筛选按钮（预留功能）
    document.getElementById('field-filter-btn')?.addEventListener('click', function () {
        showToast(i18n.t('message.comingSoon') || '功能开发中', 'info');
    });

    // 点击遮罩关闭
    document.getElementById('field-config-modal')?.addEventListener('click', (e) => {
        if (e.target?.id === 'field-config-modal') {
            closeFieldConfigModal();
        }
    });

    // 字段管理面板
    document.getElementById('close-field-management').addEventListener('click', closeFieldManagementPanel);
    document.getElementById('field-management-backdrop')?.addEventListener('click', closeFieldManagementPanel);

    // Drawer 搜索过滤（不重渲染，直接隐藏不匹配项）
    document.getElementById('field-management-search-input')?.addEventListener('input', (e) => {
        const query = (e.target.value || '').toLowerCase().trim();
        document.querySelectorAll('#field-list-container [data-field-name]').forEach((el) => {
            const label = (el.dataset.fieldLabel || '').toLowerCase();
            const fieldName = (el.dataset.fieldName || '').toLowerCase();
            const match = !query || label.includes(query) || fieldName.includes(query);
            el.style.display = match ? '' : 'none';
        });
    });

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
        refreshTaskDetailsPanel();

        // 持久化字段配置到缓存
        persistCustomFields();

        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            modal.style.zIndex = '';
        }, 300);
    });

    // 取消字段配置
    document.getElementById('cancel-field-btn').addEventListener('click', function () {
        closeFieldConfigModal();
    });

    // 暴露给全局 (Fix: 添加字段按钮点击报错)
    window.openFieldManagementPanel = openFieldManagementPanel;
}
