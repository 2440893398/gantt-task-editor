# 系统字段管理功能设计

## 概述

扩展字段管理功能，使系统字段与自定义字段一样可以在字段管理界面中展示和配置，但有特定的限制规则。

## 需求总结

### 系统字段清单

| 字段 | 中文名 | 可禁用 | 可调类型 | 关联组 |
|------|--------|--------|----------|--------|
| text | 任务名称 | ❌ | ❌ | - |
| description | 任务描述 | ❌ | ❌ | - |
| priority | 优先级 | ❌ | ❌ | - |
| assignee | 负责人 | ❌ | select/multiselect | - |
| start_date | 计划开始 | ❌ | date/datetime | - |
| end_date | 计划结束 | ❌ | date/datetime | - |
| status | 状态 | ✅ | ❌ | - |
| progress | 进度 | ✅ | ❌ | - |
| duration | 工期 | ✅ | ❌ | - |
| actual_start | 实际开始 | ✅ | date/datetime | actual |
| actual_end | 实际结束 | ✅ | date/datetime | actual |
| actual_hours | 实际工时 | ✅ | ❌ | actual |

### 核心规则

1. **排序**: 系统字段和自定义字段可自由混排
2. **视觉区分**: 系统字段显示"系统"标签，自定义字段显示"自定义"标签
3. **删除限制**: 系统字段不可删除
4. **关联禁用**: actual 组字段（actual_start, actual_end, actual_hours）禁用任一个，三个都禁用
5. **内部字段**: summary, parent, id, open, type, render, $level, $open, $virtual, estimated_hours 不在管理界面显示

---

## 设计方案

### 第一部分：数据结构

**文件**: `src/data/fields.js`

新增系统字段配置：

```javascript
export const SYSTEM_FIELD_CONFIG = {
  text: {
    label: '任务名称',
    i18nKey: 'fields.text',
    type: 'text',
    canDisable: false,
    allowedTypes: ['text'],
    linkedGroup: null
  },
  description: {
    label: '任务描述',
    i18nKey: 'fields.description',
    type: 'text',
    canDisable: false,
    allowedTypes: ['text'],
    linkedGroup: null
  },
  priority: {
    label: '优先级',
    i18nKey: 'fields.priority',
    type: 'select',
    canDisable: false,
    allowedTypes: ['select'],
    linkedGroup: null
  },
  assignee: {
    label: '负责人',
    i18nKey: 'fields.assignee',
    type: 'select',
    canDisable: false,
    allowedTypes: ['text', 'select', 'multiselect'],
    linkedGroup: null
  },
  start_date: {
    label: '计划开始',
    i18nKey: 'fields.start_date',
    type: 'date',
    canDisable: false,
    allowedTypes: ['date', 'datetime'],
    linkedGroup: null
  },
  end_date: {
    label: '计划结束',
    i18nKey: 'fields.end_date',
    type: 'date',
    canDisable: false,
    allowedTypes: ['date', 'datetime'],
    linkedGroup: null
  },
  status: {
    label: '状态',
    i18nKey: 'fields.status',
    type: 'select',
    canDisable: true,
    allowedTypes: ['select'],
    linkedGroup: null
  },
  progress: {
    label: '进度',
    i18nKey: 'fields.progress',
    type: 'number',
    canDisable: true,
    allowedTypes: ['number'],
    linkedGroup: null
  },
  duration: {
    label: '工期',
    i18nKey: 'fields.duration',
    type: 'number',
    canDisable: true,
    allowedTypes: ['number'],
    linkedGroup: null
  },
  actual_start: {
    label: '实际开始',
    i18nKey: 'fields.actual_start',
    type: 'date',
    canDisable: true,
    allowedTypes: ['date', 'datetime'],
    linkedGroup: 'actual'
  },
  actual_end: {
    label: '实际结束',
    i18nKey: 'fields.actual_end',
    type: 'date',
    canDisable: true,
    allowedTypes: ['date', 'datetime'],
    linkedGroup: 'actual'
  },
  actual_hours: {
    label: '实际工时',
    i18nKey: 'fields.actual_hours',
    type: 'number',
    canDisable: true,
    allowedTypes: ['number'],
    linkedGroup: 'actual'
  }
};
```

---

### 第二部分：状态管理

**文件**: `src/core/store.js`

扩展状态结构：

```javascript
// 新增系统字段状态
state.systemFieldSettings = {
  // 字段启用状态（仅对 canDisable: true 的字段有效）
  enabled: {
    status: true,
    progress: true,
    duration: true,
    actual_start: true,
    actual_end: true,
    actual_hours: true
  },
  // 字段类型覆盖（用户自定义的类型）
  typeOverrides: {
    // assignee: 'multiselect',
    // start_date: 'datetime'
  }
};
```

新增方法：

```javascript
// 切换字段启用状态（处理关联组逻辑）
toggleSystemFieldEnabled(fieldName, enabled) {
  const config = SYSTEM_FIELD_CONFIG[fieldName];
  if (!config || !config.canDisable) return;

  // 如果有关联组，同组字段一起禁用
  if (config.linkedGroup) {
    Object.keys(SYSTEM_FIELD_CONFIG)
      .filter(f => SYSTEM_FIELD_CONFIG[f].linkedGroup === config.linkedGroup)
      .forEach(f => {
        state.systemFieldSettings.enabled[f] = enabled;
      });
  } else {
    state.systemFieldSettings.enabled[fieldName] = enabled;
  }
  persistSystemFieldSettings();
}

// 修改系统字段类型
setSystemFieldType(fieldName, newType) {
  const config = SYSTEM_FIELD_CONFIG[fieldName];
  if (!config || !config.allowedTypes.includes(newType)) return;

  state.systemFieldSettings.typeOverrides[fieldName] = newType;
  persistSystemFieldSettings();
}

// 获取字段的实际类型（考虑覆盖）
getFieldType(fieldName) {
  return state.systemFieldSettings.typeOverrides[fieldName]
    || SYSTEM_FIELD_CONFIG[fieldName]?.type;
}
```

工具函数：

```javascript
export function isSystemField(fieldName) {
  return !!SYSTEM_FIELD_CONFIG[fieldName];
}

export function isFieldEnabled(fieldName) {
  if (!SYSTEM_FIELD_CONFIG[fieldName]) return true;
  return state.systemFieldSettings.enabled[fieldName] ?? true;
}

export function getVisibleFields() {
  return state.fieldOrder.filter(fieldName => {
    if (INTERNAL_FIELDS.includes(fieldName)) return false;
    return isFieldEnabled(fieldName);
  });
}
```

---

### 第三部分：字段管理界面

**文件**: `src/features/customFields/manager.js`

修改 renderFieldList()：

```javascript
function renderFieldList() {
  const container = document.getElementById('field-list');
  container.innerHTML = '';

  state.fieldOrder.forEach((fieldName, index) => {
    const isSystem = !!SYSTEM_FIELD_CONFIG[fieldName];
    const config = isSystem
      ? SYSTEM_FIELD_CONFIG[fieldName]
      : state.customFields.find(f => f.name === fieldName);

    if (!config) return;

    const enabled = isSystem
      ? (state.systemFieldSettings.enabled[fieldName] ?? true)
      : true;

    const item = document.createElement('div');
    item.className = `field-item ${!enabled ? 'disabled' : ''}`;
    item.dataset.fieldName = fieldName;

    item.innerHTML = `
      <span class="drag-handle">⋮⋮</span>
      <span class="field-label">${t(config.i18nKey) || config.label}</span>
      <span class="field-tag ${isSystem ? 'system' : 'custom'}">
        ${isSystem ? t('fieldManagement.systemTag') : t('fieldManagement.customTag')}
      </span>
      <div class="field-actions">
        ${renderFieldActions(fieldName, isSystem, config)}
      </div>
    `;

    container.appendChild(item);
  });

  initSortable(container);
}

function renderFieldActions(fieldName, isSystem, config) {
  const actions = [];

  // 编辑按钮（所有字段都有）
  actions.push(`<button class="edit-btn" data-field="${fieldName}">${t('common.edit')}</button>`);

  if (isSystem) {
    // 系统字段：启用/禁用开关（仅 canDisable 为 true 的字段）
    if (config.canDisable) {
      const enabled = state.systemFieldSettings.enabled[fieldName] ?? true;
      actions.push(`
        <label class="toggle-switch">
          <input type="checkbox" ${enabled ? 'checked' : ''}
                 data-field="${fieldName}" class="toggle-enabled">
          <span class="slider"></span>
        </label>
      `);
    }
    // 系统字段无删除按钮
  } else {
    // 自定义字段：删除按钮
    actions.push(`<button class="delete-btn" data-field="${fieldName}">${t('common.delete')}</button>`);
  }

  return actions.join('');
}
```

---

### 第四部分：系统字段编辑弹窗

**文件**: `src/features/customFields/manager.js`

```javascript
function openEditFieldModal(fieldName) {
  const isSystem = !!SYSTEM_FIELD_CONFIG[fieldName];

  if (isSystem) {
    openSystemFieldEditModal(fieldName);
  } else {
    openCustomFieldEditModal(fieldName); // 现有逻辑
  }
}

function openSystemFieldEditModal(fieldName) {
  const config = SYSTEM_FIELD_CONFIG[fieldName];
  const currentType = getFieldType(fieldName);
  const t = window.i18n.t;

  const modal = document.createElement('div');
  modal.className = 'modal field-edit-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>${t('fieldManagement.editSystemField')}</h3>

      <div class="form-group">
        <label>${t('fieldManagement.fieldName')}</label>
        <input type="text" value="${t(config.i18nKey) || config.label}" disabled
               class="disabled-input">
        <span class="hint">${t('fieldManagement.systemFieldNameHint')}</span>
      </div>

      ${config.allowedTypes.length > 1 ? `
        <div class="form-group">
          <label>${t('fieldManagement.fieldType')}</label>
          <select id="system-field-type">
            ${config.allowedTypes.map(type => `
              <option value="${type}" ${type === currentType ? 'selected' : ''}>
                ${t('fieldTypes.' + type)}
              </option>
            `).join('')}
          </select>
        </div>
      ` : `
        <div class="form-group">
          <label>${t('fieldManagement.fieldType')}</label>
          <input type="text" value="${t('fieldTypes.' + config.type)}" disabled
                 class="disabled-input">
          <span class="hint">${t('fieldManagement.typeNotEditable')}</span>
        </div>
      `}

      <div class="modal-actions">
        <button class="btn-cancel">${t('common.cancel')}</button>
        <button class="btn-save">${t('common.save')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  bindSystemFieldEditEvents(modal, fieldName);
}
```

---

### 第五部分：联动更新

**1. 甘特图列渲染** (`src/features/gantt/columns.js`)

```javascript
function updateGanttColumns() {
  const columns = [];

  state.fieldOrder.forEach(fieldName => {
    if (SYSTEM_FIELD_CONFIG[fieldName]) {
      const enabled = state.systemFieldSettings.enabled[fieldName] ?? true;
      if (!enabled) return;
    }

    const fieldType = getFieldType(fieldName);
    columns.push(createColumnConfig(fieldName, fieldType));
  });

  gantt.config.columns = columns;
  gantt.render();
}
```

**2. 任务详情面板** (`src/features/task-details/right-section.js`)

```javascript
function renderRightSection(task) {
  const fields = state.fieldOrder.filter(fieldName => {
    if (INTERNAL_FIELDS.includes(fieldName)) return false;

    if (SYSTEM_FIELD_CONFIG[fieldName]) {
      return state.systemFieldSettings.enabled[fieldName] ?? true;
    }

    return true;
  });
}
```

**3. Lightbox 表单** (`src/features/lightbox/customization.js`)

```javascript
function renderLightboxFields() {
  const visibleFields = state.fieldOrder.filter(fieldName => {
    if (SYSTEM_FIELD_CONFIG[fieldName]) {
      return state.systemFieldSettings.enabled[fieldName] ?? true;
    }
    return true;
  });
}
```

**4. 内联编辑** (`src/features/gantt/inline-edit.js`)

```javascript
function getEditorType(fieldName) {
  const fieldType = getFieldType(fieldName);

  switch (fieldType) {
    case 'datetime':
      return { type: 'datetime-local' };
    case 'multiselect':
      return { type: 'multiselect', options: getFieldOptions(fieldName) };
    // ...
  }
}
```

**5. Excel 导出** (`src/features/config/configIO.js`)

```javascript
function exportToExcel(tasks) {
  const exportFields = state.fieldOrder.filter(fieldName => {
    if (INTERNAL_FIELDS.includes(fieldName)) return false;

    if (SYSTEM_FIELD_CONFIG[fieldName]) {
      return state.systemFieldSettings.enabled[fieldName] ?? true;
    }

    return true;
  });

  // 根据 getFieldType() 格式化值
}
```

**6. Excel 导入** (`src/features/config/configIO.js`)

```javascript
function importFromExcel(data) {
  const importFields = state.fieldOrder.filter(fieldName => {
    if (INTERNAL_FIELDS.includes(fieldName)) return false;

    if (SYSTEM_FIELD_CONFIG[fieldName]) {
      return state.systemFieldSettings.enabled[fieldName] ?? true;
    }

    return true;
  });
}

function parseFieldValue(fieldName, rawValue) {
  const fieldType = getFieldType(fieldName);

  switch (fieldType) {
    case 'datetime':
      return parseDateTime(rawValue);
    case 'date':
      return parseDate(rawValue);
    case 'multiselect':
      return rawValue.split(',').map(v => v.trim());
    case 'number':
      return parseFloat(rawValue) || 0;
    default:
      return rawValue;
  }
}
```

---

### 第六部分：本地化

**新增 key（所有语言文件）**

```javascript
// zh-CN
fieldManagement: {
  editSystemField: '编辑系统字段',
  fieldName: '字段名称',
  fieldType: '字段类型',
  systemFieldNameHint: '系统字段名称不可修改',
  typeNotEditable: '此字段类型不可修改',
  systemTag: '系统',
  customTag: '自定义'
},
fieldTypes: {
  text: '文本',
  number: '数字',
  date: '日期',
  datetime: '日期时间',
  select: '单选',
  multiselect: '多选'
}

// en-US
fieldManagement: {
  editSystemField: 'Edit System Field',
  fieldName: 'Field Name',
  fieldType: 'Field Type',
  systemFieldNameHint: 'System field name cannot be modified',
  typeNotEditable: 'This field type cannot be modified',
  systemTag: 'System',
  customTag: 'Custom'
},
fieldTypes: {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  datetime: 'Date Time',
  select: 'Select',
  multiselect: 'Multi-select'
}

// ja-JP
fieldManagement: {
  editSystemField: 'システムフィールドを編集',
  fieldName: 'フィールド名',
  fieldType: 'フィールドタイプ',
  systemFieldNameHint: 'システムフィールド名は変更できません',
  typeNotEditable: 'このフィールドタイプは変更できません',
  systemTag: 'システム',
  customTag: 'カスタム'
},
fieldTypes: {
  text: 'テキスト',
  number: '数値',
  date: '日付',
  datetime: '日時',
  select: '単一選択',
  multiselect: '複数選択'
}

// ko-KR
fieldManagement: {
  editSystemField: '시스템 필드 편집',
  fieldName: '필드 이름',
  fieldType: '필드 유형',
  systemFieldNameHint: '시스템 필드 이름은 수정할 수 없습니다',
  typeNotEditable: '이 필드 유형은 수정할 수 없습니다',
  systemTag: '시스템',
  customTag: '사용자 정의'
},
fieldTypes: {
  text: '텍스트',
  number: '숫자',
  date: '날짜',
  datetime: '날짜 시간',
  select: '단일 선택',
  multiselect: '다중 선택'
}
```

---

## 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/data/fields.js` | 新增 `SYSTEM_FIELD_CONFIG` 配置 |
| `src/core/store.js` | 新增 `systemFieldSettings` 状态和相关方法 |
| `src/features/customFields/manager.js` | 重构字段列表渲染，支持系统字段显示、编辑、启用/禁用 |
| `src/features/gantt/columns.js` | 过滤禁用字段，使用 `getFieldType()` |
| `src/features/gantt/inline-edit.js` | 使用 `getFieldType()` 获取编辑器类型 |
| `src/features/task-details/right-section.js` | 过滤禁用字段，调整渲染逻辑 |
| `src/features/lightbox/customization.js` | 过滤禁用字段，使用实际类型渲染 |
| `src/features/config/configIO.js` | 导入导出过滤禁用字段，按实际类型处理 |
| `src/locales/zh-CN.js` | 新增本地化 key |
| `src/locales/en-US.js` | 新增本地化 key |
| `src/locales/ja-JP.js` | 新增本地化 key |
| `src/locales/ko-KR.js` | 新增本地化 key |
