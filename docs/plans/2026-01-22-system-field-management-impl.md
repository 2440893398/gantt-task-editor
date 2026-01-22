# System Field Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend field management to display and configure system fields with limited editing capabilities.

**Architecture:** Add `SYSTEM_FIELD_CONFIG` for system field metadata, extend store with `systemFieldSettings` state, modify manager UI to show both system and custom fields with appropriate controls.

**Tech Stack:** Vanilla JS, Sortable.js, localStorage, i18n

---

## Task 1: Add SYSTEM_FIELD_CONFIG to fields.js

**Files:**
- Modify: `src/data/fields.js`

**Step 1: Add SYSTEM_FIELD_CONFIG constant**

```javascript
// Add after defaultFieldOrder (line 15)

/**
 * System field configuration
 * Defines which system fields are manageable and their constraints
 */
export const SYSTEM_FIELD_CONFIG = {
    text: {
        i18nKey: 'columns.text',
        type: 'text',
        canDisable: false,
        allowedTypes: ['text'],
        linkedGroup: null
    },
    description: {
        i18nKey: 'task.description',
        type: 'text',
        canDisable: false,
        allowedTypes: ['text'],
        linkedGroup: null
    },
    priority: {
        i18nKey: 'columns.priority',
        type: 'select',
        canDisable: false,
        allowedTypes: ['select'],
        linkedGroup: null
    },
    assignee: {
        i18nKey: 'columns.assignee',
        type: 'select',
        canDisable: false,
        allowedTypes: ['text', 'select', 'multiselect'],
        linkedGroup: null
    },
    start_date: {
        i18nKey: 'columns.start_date',
        type: 'date',
        canDisable: false,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: null
    },
    end_date: {
        i18nKey: 'taskDetails.planEnd',
        type: 'date',
        canDisable: false,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: null
    },
    status: {
        i18nKey: 'columns.status',
        type: 'select',
        canDisable: true,
        allowedTypes: ['select'],
        linkedGroup: null
    },
    progress: {
        i18nKey: 'columns.progress',
        type: 'number',
        canDisable: true,
        allowedTypes: ['number'],
        linkedGroup: null
    },
    duration: {
        i18nKey: 'columns.duration',
        type: 'number',
        canDisable: true,
        allowedTypes: ['number'],
        linkedGroup: null
    },
    actual_start: {
        i18nKey: 'taskDetails.actualStart',
        type: 'date',
        canDisable: true,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: 'actual'
    },
    actual_end: {
        i18nKey: 'taskDetails.actualEnd',
        type: 'date',
        canDisable: true,
        allowedTypes: ['date', 'datetime'],
        linkedGroup: 'actual'
    },
    actual_hours: {
        i18nKey: 'taskDetails.actualHours',
        type: 'number',
        canDisable: true,
        allowedTypes: ['number'],
        linkedGroup: 'actual'
    }
};

/**
 * Internal fields that should never be shown in field management
 */
export const INTERNAL_FIELDS = [
    'summary', 'parent', 'id', 'open', 'type', 'render',
    '$level', '$open', '$virtual', 'estimated_hours'
];
```

**Step 2: Verify file syntax**

Run: `node --check src/data/fields.js`
Expected: No output (syntax OK)

**Step 3: Commit**

```bash
git add src/data/fields.js
git commit -m "feat(fields): add SYSTEM_FIELD_CONFIG and INTERNAL_FIELDS constants"
```

---

## Task 2: Add storage functions for system field settings

**Files:**
- Modify: `src/core/storage.js`

**Step 1: Add storage key constant**

In `STORAGE_KEYS` object (around line 28), add:

```javascript
SYSTEM_FIELD_SETTINGS: 'gantt_system_field_settings'
```

**Step 2: Add save/get functions**

Add after `getFieldOrder` function (around line 154):

```javascript
/**
 * Save system field settings
 * @param {Object} settings - { enabled: {}, typeOverrides: {} }
 */
export function saveSystemFieldSettings(settings) {
    setLocalStorage(STORAGE_KEYS.SYSTEM_FIELD_SETTINGS, settings);
}

/**
 * Get system field settings
 * @returns {Object|null}
 */
export function getSystemFieldSettings() {
    return getLocalStorage(STORAGE_KEYS.SYSTEM_FIELD_SETTINGS);
}
```

**Step 3: Verify file syntax**

Run: `node --check src/core/storage.js`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add src/core/storage.js
git commit -m "feat(storage): add system field settings persistence"
```

---

## Task 3: Add systemFieldSettings state and methods to store.js

**Files:**
- Modify: `src/core/store.js`

**Step 1: Update imports**

At the top of file, update import to include new functions:

```javascript
import { defaultCustomFields, defaultFieldOrder, SYSTEM_FIELD_CONFIG } from '../data/fields.js';
import {
    saveCustomFieldsDef,
    getCustomFieldsDef,
    saveFieldOrder,
    getFieldOrder as getStoredFieldOrder,
    saveGanttData,
    getGanttData,
    hasCachedData,
    clearAllCache,
    getStorageStatus,
    saveLocale,
    getLocale,
    saveAiConfig,
    getAiConfig,
    isAiConfigured,
    saveSystemFieldSettings,
    getSystemFieldSettings
} from './storage.js';
```

**Step 2: Add systemFieldSettings to state**

In the `state` object (around line 25), add after `aiStatus`:

```javascript
// System field settings
systemFieldSettings: {
    enabled: {
        status: true,
        progress: true,
        duration: true,
        actual_start: true,
        actual_end: true,
        actual_hours: true
    },
    typeOverrides: {}
}
```

**Step 3: Add restoreSystemFieldSettings in restoreStateFromCache**

In `restoreStateFromCache` function, add after restoring fieldOrder (around line 74):

```javascript
// Restore system field settings
const cachedSystemFieldSettings = getSystemFieldSettings();
if (cachedSystemFieldSettings) {
    state.systemFieldSettings = {
        ...state.systemFieldSettings,
        ...cachedSystemFieldSettings
    };
    console.log('[Store] Restored system field settings from cache');
}
```

**Step 4: Add system field management functions**

Add after `getAiStatus` function (at end of file):

```javascript
// ========================================
// System Field Management
// ========================================

/**
 * Persist system field settings to storage
 */
export function persistSystemFieldSettings() {
    saveSystemFieldSettings(state.systemFieldSettings);
    console.log('[Store] Persisted system field settings');
}

/**
 * Check if a field is a system field
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isSystemField(fieldName) {
    return !!SYSTEM_FIELD_CONFIG[fieldName];
}

/**
 * Check if a field is enabled
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isFieldEnabled(fieldName) {
    if (!SYSTEM_FIELD_CONFIG[fieldName]) return true;
    if (!SYSTEM_FIELD_CONFIG[fieldName].canDisable) return true;
    return state.systemFieldSettings.enabled[fieldName] ?? true;
}

/**
 * Get the actual type of a field (considering overrides)
 * @param {string} fieldName
 * @returns {string}
 */
export function getFieldType(fieldName) {
    if (state.systemFieldSettings.typeOverrides[fieldName]) {
        return state.systemFieldSettings.typeOverrides[fieldName];
    }
    if (SYSTEM_FIELD_CONFIG[fieldName]) {
        return SYSTEM_FIELD_CONFIG[fieldName].type;
    }
    const customField = state.customFields.find(f => f.name === fieldName);
    return customField?.type || 'text';
}

/**
 * Toggle system field enabled state (handles linked groups)
 * @param {string} fieldName
 * @param {boolean} enabled
 */
export function toggleSystemFieldEnabled(fieldName, enabled) {
    const config = SYSTEM_FIELD_CONFIG[fieldName];
    if (!config || !config.canDisable) return;

    // If field has a linked group, toggle all fields in the group
    if (config.linkedGroup) {
        Object.keys(SYSTEM_FIELD_CONFIG).forEach(f => {
            if (SYSTEM_FIELD_CONFIG[f].linkedGroup === config.linkedGroup) {
                state.systemFieldSettings.enabled[f] = enabled;
            }
        });
    } else {
        state.systemFieldSettings.enabled[fieldName] = enabled;
    }

    persistSystemFieldSettings();
}

/**
 * Set system field type override
 * @param {string} fieldName
 * @param {string} newType
 */
export function setSystemFieldType(fieldName, newType) {
    const config = SYSTEM_FIELD_CONFIG[fieldName];
    if (!config || !config.allowedTypes.includes(newType)) return;

    if (newType === config.type) {
        // Remove override if setting back to default
        delete state.systemFieldSettings.typeOverrides[fieldName];
    } else {
        state.systemFieldSettings.typeOverrides[fieldName] = newType;
    }

    persistSystemFieldSettings();
}

/**
 * Get visible fields (excluding disabled and internal fields)
 * @returns {string[]}
 */
export function getVisibleFields() {
    const { INTERNAL_FIELDS } = require('../data/fields.js');
    return state.fieldOrder.filter(fieldName => {
        if (INTERNAL_FIELDS.includes(fieldName)) return false;
        return isFieldEnabled(fieldName);
    });
}
```

**Step 5: Verify file syntax**

Run: `node --check src/core/store.js`
Expected: No output (syntax OK)

**Step 6: Commit**

```bash
git add src/core/store.js
git commit -m "feat(store): add systemFieldSettings state and management functions"
```

---

## Task 4: Add localization keys for all languages

**Files:**
- Modify: `src/locales/zh-CN.js`
- Modify: `src/locales/en-US.js`
- Modify: `src/locales/ja-JP.js`
- Modify: `src/locales/ko-KR.js`

**Step 1: Add keys to zh-CN.js**

In `fieldManagement` section (around line 183), add:

```javascript
// After deleteMessage line
editSystemField: '编辑系统字段',
systemFieldNameHint: '系统字段名称不可修改',
typeNotEditable: '此字段类型不可修改',
systemTag: '系统',
customTag: '自定义',
enableField: '启用',
disableField: '禁用',
linkedFieldsHint: '关联字段将一起{{action}}'
```

Add new `fieldTypes` section after `fieldManagement`:

```javascript
// Field types
fieldTypes: {
    text: '文本',
    number: '数字',
    date: '日期',
    datetime: '日期时间',
    select: '单选',
    multiselect: '多选'
},
```

**Step 2: Add keys to en-US.js**

Add same structure with English translations:

```javascript
// In fieldManagement section
editSystemField: 'Edit System Field',
systemFieldNameHint: 'System field name cannot be modified',
typeNotEditable: 'This field type cannot be modified',
systemTag: 'System',
customTag: 'Custom',
enableField: 'Enable',
disableField: 'Disable',
linkedFieldsHint: 'Linked fields will be {{action}} together'

// Add fieldTypes section
fieldTypes: {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    datetime: 'Date Time',
    select: 'Select',
    multiselect: 'Multi-select'
},
```

**Step 3: Add keys to ja-JP.js**

Add same structure with Japanese translations:

```javascript
// In fieldManagement section
editSystemField: 'システムフィールドを編集',
systemFieldNameHint: 'システムフィールド名は変更できません',
typeNotEditable: 'このフィールドタイプは変更できません',
systemTag: 'システム',
customTag: 'カスタム',
enableField: '有効',
disableField: '無効',
linkedFieldsHint: '関連フィールドも一緒に{{action}}されます'

// Add fieldTypes section
fieldTypes: {
    text: 'テキスト',
    number: '数値',
    date: '日付',
    datetime: '日時',
    select: '単一選択',
    multiselect: '複数選択'
},
```

**Step 4: Add keys to ko-KR.js**

Add same structure with Korean translations:

```javascript
// In fieldManagement section
editSystemField: '시스템 필드 편집',
systemFieldNameHint: '시스템 필드 이름은 수정할 수 없습니다',
typeNotEditable: '이 필드 유형은 수정할 수 없습니다',
systemTag: '시스템',
customTag: '사용자 정의',
enableField: '활성화',
disableField: '비활성화',
linkedFieldsHint: '연결된 필드도 함께 {{action}}됩니다'

// Add fieldTypes section
fieldTypes: {
    text: '텍스트',
    number: '숫자',
    date: '날짜',
    datetime: '날짜 시간',
    select: '단일 선택',
    multiselect: '다중 선택'
},
```

**Step 5: Commit**

```bash
git add src/locales/
git commit -m "feat(i18n): add system field management localization keys"
```

---

## Task 5: Update renderFieldList to show system fields

**Files:**
- Modify: `src/features/customFields/manager.js`

**Step 1: Update imports**

Add to imports at top of file:

```javascript
import { SYSTEM_FIELD_CONFIG, INTERNAL_FIELDS } from '../../data/fields.js';
import {
    state,
    reorderFields,
    removeCustomField,
    getCustomFieldByName,
    persistCustomFields,
    isSystemField,
    isFieldEnabled,
    toggleSystemFieldEnabled,
    persistSystemFieldSettings
} from '../../core/store.js';
```

**Step 2: Replace renderFieldList function**

Replace the entire `renderFieldList` function (lines 136-201) with:

```javascript
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
```

**Step 3: Verify file syntax**

Run: `node --check src/features/customFields/manager.js`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add src/features/customFields/manager.js
git commit -m "feat(manager): update renderFieldList to show system fields"
```

---

## Task 6: Add system field edit modal

**Files:**
- Modify: `src/features/customFields/manager.js`

**Step 1: Update editField function**

Replace the `editField` function with:

```javascript
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
                import('../../core/store.js').then(({ setSystemFieldType }) => {
                    setSystemFieldType(fieldName, newType);
                    updateGanttColumns();
                    refreshLightbox();
                    renderFieldList();
                    showToast(i18n.t('message.saveSuccess'), 'success');
                });
            }
        }
        closeModal();
    });
}
```

**Step 2: Verify file syntax**

Run: `node --check src/features/customFields/manager.js`
Expected: No output (syntax OK)

**Step 3: Commit**

```bash
git add src/features/customFields/manager.js
git commit -m "feat(manager): add system field edit modal"
```

---

## Task 7: Update Gantt columns to respect system field settings

**Files:**
- Modify: `src/features/gantt/columns.js`

**Step 1: Update imports**

Add to imports:

```javascript
import { isFieldEnabled, getFieldType } from '../../core/store.js';
import { INTERNAL_FIELDS } from '../../data/fields.js';
```

**Step 2: Update column generation logic**

In the `updateGanttColumns` function, add filtering for disabled fields. Find where columns are generated from fieldOrder and add:

```javascript
// Filter out disabled system fields and internal fields
const visibleFields = state.fieldOrder.filter(fieldName => {
    if (INTERNAL_FIELDS.includes(fieldName)) return false;
    return isFieldEnabled(fieldName);
});
```

Then use `visibleFields` instead of `state.fieldOrder` when generating columns.

**Step 3: Verify file syntax**

Run: `node --check src/features/gantt/columns.js`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add src/features/gantt/columns.js
git commit -m "feat(gantt): filter disabled system fields from columns"
```

---

## Task 8: Update task details panel to respect system field settings

**Files:**
- Modify: `src/features/task-details/right-section.js`

**Step 1: Update imports**

Add to imports:

```javascript
import { isFieldEnabled, getFieldType } from '../../core/store.js';
```

**Step 2: Update field rendering**

In the section where fields are rendered, add filtering:

```javascript
// Filter visible fields
const visibleFields = fields.filter(fieldName => isFieldEnabled(fieldName));
```

**Step 3: Verify file syntax**

Run: `node --check src/features/task-details/right-section.js`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add src/features/task-details/right-section.js
git commit -m "feat(task-details): filter disabled system fields"
```

---

## Task 9: Update lightbox to respect system field settings

**Files:**
- Modify: `src/features/lightbox/customization.js`

**Step 1: Update imports**

Add to imports:

```javascript
import { isFieldEnabled, getFieldType } from '../../core/store.js';
```

**Step 2: Update field rendering**

In the lightbox field rendering logic, add filtering for disabled fields.

**Step 3: Verify file syntax**

Run: `node --check src/features/lightbox/customization.js`
Expected: No output (syntax OK)

**Step 4: Commit**

```bash
git add src/features/lightbox/customization.js
git commit -m "feat(lightbox): filter disabled system fields"
```

---

## Task 10: Update Excel export/import to respect system field settings

**Files:**
- Modify: `src/features/config/configIO.js`

**Step 1: Update imports**

Add to imports:

```javascript
import { isFieldEnabled, getFieldType } from '../../core/store.js';
import { INTERNAL_FIELDS } from '../../data/fields.js';
```

**Step 2: Update export logic**

In the export function, filter out disabled fields:

```javascript
const exportFields = state.fieldOrder.filter(fieldName => {
    if (INTERNAL_FIELDS.includes(fieldName)) return false;
    return isFieldEnabled(fieldName);
});
```

**Step 3: Update import logic**

In the import function, use similar filtering when mapping columns.

**Step 4: Verify file syntax**

Run: `node --check src/features/config/configIO.js`
Expected: No output (syntax OK)

**Step 5: Commit**

```bash
git add src/features/config/configIO.js
git commit -m "feat(configIO): filter disabled fields in Excel export/import"
```

---

## Task 11: Manual testing and final verification

**Step 1: Start development server**

Run: `npm run dev`

**Step 2: Test system field management**

1. Open field management panel
2. Verify system fields display with "System" tag
3. Verify custom fields display with "Custom" tag
4. Test drag-and-drop reordering works for both types
5. Test disabling a system field (status, progress, duration)
6. Verify linked fields (actual_start, actual_end, actual_hours) disable together
7. Test type switching for assignee (text → select → multiselect)
8. Test type switching for date fields (date ↔ datetime)
9. Verify disabled fields don't appear in Gantt columns
10. Verify disabled fields don't appear in task details panel
11. Verify disabled fields don't appear in lightbox
12. Test Excel export excludes disabled fields
13. Test Excel import respects disabled fields

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete system field management feature

- Add SYSTEM_FIELD_CONFIG for system field metadata
- Add systemFieldSettings state for enable/disable and type overrides
- Update field management UI to show both system and custom fields
- Add system/custom tags for visual distinction
- Implement linked group disable logic (actual_* fields)
- Add system field edit modal with limited type switching
- Filter disabled fields from Gantt, task details, lightbox, Excel
- Add i18n support for all 4 languages"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add SYSTEM_FIELD_CONFIG | fields.js |
| 2 | Add storage functions | storage.js |
| 3 | Add state and methods | store.js |
| 4 | Add i18n keys | locales/*.js |
| 5 | Update renderFieldList | manager.js |
| 6 | Add system field modal | manager.js |
| 7 | Update Gantt columns | columns.js |
| 8 | Update task details | right-section.js |
| 9 | Update lightbox | customization.js |
| 10 | Update Excel export/import | configIO.js |
| 11 | Manual testing | - |
