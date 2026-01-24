# 任务新增页面优化 - 设计文档

## 版本信息
- 文档版本：v1.0
- 创建日期：2026-01-24
- 设计状态：已确认

## 1. 需求概述

### 1.1 优化目标
针对任务新增和编辑流程的四个核心优化点：

| 序号 | 优化点 | 当前问题 | 期望效果 |
|------|--------|----------|----------|
| F-1 | 新建任务确认 | 点击"新建任务"按钮立即创建空任务，容易产生脏数据 | 弹出确认对话框，输入必要信息后再创建 |
| F-2 | 任务详情面板美化 | 作为最常用功能，视觉和交互体验需要提升 | 统一样式、优化间距、增强交互反馈 |
| F-3 | 摘要字段列表显示 | 富文本HTML标签在列表中显示，影响可读性 | 列表显示纯文本，悬浮显示富文本弹窗 |
| F-4 | 行内编辑类型匹配 | 所有字段使用固定编辑器，未考虑字段类型覆盖 | 根据 `getFieldType()` 动态匹配编辑器 |

### 1.2 技术背景
- UI 框架：DaisyUI 3.x
- 富文本编辑器：Quill.js
- 日期选择器：Flatpickr
- 国际化：支持 zh-CN, en-US, ja-JP, ko-KR
- 状态管理：基于 `src/core/store.js`

## 2. 功能设计

### 2.1 新建任务模态框（F-1）

#### 2.1.1 UI 设计
**模态框结构**（DaisyUI Modal）：
```html
<dialog id="new-task-modal" class="modal">
  <div class="modal-box">
    <h3 class="font-bold text-lg mb-4" data-i18n="newTask.title">新建任务</h3>
    <form id="new-task-form" class="space-y-4">
      <!-- 任务名称（必填） -->
      <div class="form-control">
        <label class="label">
          <span class="label-text" data-i18n="newTask.nameLabel">任务名称</span>
          <span class="text-error">*</span>
        </label>
        <input type="text"
               id="new-task-name"
               class="input input-bordered w-full"
               data-i18n-placeholder="newTask.namePlaceholder"
               placeholder="请输入任务名称"
               required
               maxlength="100">
        <label class="label hidden" id="name-error">
          <span class="label-text-alt text-error" data-i18n="newTask.nameRequired">
            任务名称不能为空
          </span>
        </label>
      </div>

      <!-- 负责人（可选） -->
      <div class="form-control">
        <label class="label">
          <span class="label-text" data-i18n="newTask.assigneeLabel">负责人</span>
        </label>
        <input type="text"
               id="new-task-assignee"
               class="input input-bordered w-full"
               data-i18n-placeholder="newTask.assigneePlaceholder"
               placeholder="请选择负责人">
      </div>

      <!-- 操作按钮 -->
      <div class="modal-action">
        <button type="button"
                class="btn btn-ghost"
                data-i18n="newTask.cancel"
                onclick="document.getElementById('new-task-modal').close()">
          取消
        </button>
        <button type="submit"
                class="btn btn-primary"
                data-i18n="newTask.create">
          创建
        </button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>
```

#### 2.1.2 交互逻辑
**触发流程**：
1. 用户点击"新建任务"按钮 → 打开模态框
2. 用户输入任务名称（必填），可选输入负责人
3. 点击"创建" → 验证表单 → 调用 `gantt.addTask()` → 打开任务详情面板
4. 点击"取消" → 关闭模态框，不创建任务

**JavaScript 实现**（在 `index.html` 或独立文件中）：
```javascript
// 修改现有的新建任务按钮事件
document.getElementById('add-task-btn').addEventListener('click', function() {
    // 打开模态框而非直接创建任务
    document.getElementById('new-task-modal').showModal();
});

// 表单提交事件
document.getElementById('new-task-form').addEventListener('submit', function(e) {
    e.preventDefault();

    const taskName = document.getElementById('new-task-name').value.trim();
    const assignee = document.getElementById('new-task-assignee').value.trim();

    // 验证任务名称
    if (!taskName) {
        document.getElementById('name-error').classList.remove('hidden');
        return;
    }

    // 创建任务
    const newTask = {
        text: taskName,
        assignee: assignee || '',
        start_date: new Date(),
        duration: 1,
        progress: 0
    };

    const taskId = gantt.addTask(newTask);

    // 关闭模态框
    document.getElementById('new-task-modal').close();

    // 重置表单
    document.getElementById('new-task-form').reset();
    document.getElementById('name-error').classList.add('hidden');

    // 打开任务详情面板
    if (window.openTaskDetailsPanel) {
        window.openTaskDetailsPanel(taskId);
    }
});
```

### 2.2 任务详情面板优化（F-2）

#### 2.2.1 视觉优化

**1. 布局与间距规范**
```css
/* 统一字段间距 */
.task-details-field {
    margin-bottom: 16px; /* spacing-4 */
}

/* 左右栏分隔 */
.task-details-divider {
    width: 1px;
    background: hsl(var(--bc) / 0.1);
    margin: 0 24px;
}

/* 标签与输入框间距 */
.task-details-label {
    margin-bottom: 8px; /* spacing-2 */
}
```

**2. 组件样式统一**
- 所有文本输入框：`input input-bordered w-full`
- 所有下拉选择器：`select select-bordered w-full`
- 所有文本域：`textarea textarea-bordered w-full`
- 日期选择器：保持 Flatpickr 样式，添加日历图标

**3. 字段标识增强**
```html
<!-- 必填字段标记 -->
<label class="label">
  <span class="label-text">任务名称</span>
  <span class="text-error">*</span>
</label>

<!-- 系统字段标记 -->
<label class="label">
  <span class="label-text">状态</span>
  <span class="badge badge-sm badge-ghost ml-2">系统</span>
</label>

<!-- 禁用字段提示 -->
<input class="input input-bordered input-disabled" disabled>
<label class="label">
  <span class="label-text-alt text-base-content/60">此字段已禁用</span>
</label>
```

**4. 颜色方案**
- 必填标记：`text-error` (红色)
- 系统字段徽章：`badge-ghost` (半透明)
- 分组标题：`text-sm font-semibold text-base-content/70`
- 禁用状态：`input-disabled` + `text-base-content/40`

#### 2.2.2 交互优化

**1. 负责人字段动态渲染**
```javascript
function renderAssigneeField(task) {
    const fieldType = getFieldType('assignee');
    const fieldDef = state.customFields.find(f => f.name === 'assignee');
    const options = fieldDef?.options || [];

    if (fieldType === 'text') {
        // 文本输入框
        return `<input type="text"
                       class="input input-bordered w-full"
                       value="${task.assignee || ''}"
                       data-field="assignee">`;
    } else if (fieldType === 'select') {
        // 单选下拉
        return `<select class="select select-bordered w-full" data-field="assignee">
                    <option value="">—</option>
                    ${options.map(opt =>
                        `<option value="${opt}" ${task.assignee === opt ? 'selected' : ''}>
                            ${opt}
                         </option>`
                    ).join('')}
                </select>`;
    } else if (fieldType === 'multiselect') {
        // 多选（使用逗号分隔存储）
        const selected = (task.assignee || '').split(',').filter(Boolean);
        return `<div class="space-y-2">
                    ${options.map(opt =>
                        `<label class="label cursor-pointer justify-start gap-2">
                            <input type="checkbox"
                                   class="checkbox checkbox-sm"
                                   value="${opt}"
                                   ${selected.includes(opt) ? 'checked' : ''}
                                   data-field="assignee-multi">
                            <span class="label-text">${opt}</span>
                         </label>`
                    ).join('')}
                </div>`;
    }
}
```

**2. 日期字段增强**
```javascript
// 日期/日期时间类型切换支持
function initDatePicker(fieldName, task) {
    const fieldType = getFieldType(fieldName);
    const enableTime = fieldType === 'datetime';

    flatpickr(`#${fieldName}-input`, {
        enableTime: enableTime,
        dateFormat: enableTime ? 'Y-m-d H:i' : 'Y-m-d',
        time_24hr: true,
        locale: getCurrentLocale(),
        // 添加"今天"快捷按钮
        plugins: [new ShortcutsPlugin({
            button: [{
                label: i18n.t('taskDetails.quickDate')
            }]
        })]
    });
}

// 日期范围验证
function validateDateRange(task) {
    if (task.actual_start && task.actual_end) {
        if (new Date(task.actual_start) > new Date(task.actual_end)) {
            showWarning(i18n.t('taskDetails.dateRangeError'));
            return false;
        }
    }
    return true;
}
```

**3. 表单验证提示**
```javascript
function validateField(fieldName, value) {
    const field = SYSTEM_FIELD_CONFIG.find(f => f.name === fieldName);
    const errorLabel = document.querySelector(`#${fieldName}-error`);

    if (field?.required && !value) {
        errorLabel?.classList.remove('hidden');
        return false;
    }

    errorLabel?.classList.add('hidden');
    return true;
}
```

### 2.3 摘要字段显示优化（F-3）

#### 2.3.1 纯文本提取

**工具函数**（添加到 `src/utils/dom.js`）：
```javascript
/**
 * 从 HTML 字符串提取纯文本
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本内容
 */
export function extractPlainText(html) {
    if (!html || typeof html !== 'string') return '';

    // 创建临时 DOM 元素
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // 提取 textContent 并清理多余空格
    const text = temp.textContent || temp.innerText || '';
    return text.trim().replace(/\s+/g, ' ');
}

/**
 * 转义 HTML 属性值
 * @param {string} str - 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeAttr(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
```

#### 2.3.2 列模板修改

**修改 `src/features/gantt/columns.js`**：
```javascript
import { extractPlainText, escapeAttr, escapeHtml } from '../../utils/dom.js';

{
    name: "summary",
    label: i18n.t("fields.summary"),
    width: 200,
    min_width: 150,
    resize: true,
    template: function (task) {
        const html = task.summary || '';

        // 空值处理
        if (!html) {
            return '<span class="text-base-content/40 text-xs italic">—</span>';
        }

        // 提取纯文本
        const plainText = extractPlainText(html);

        // 截断显示
        const truncated = plainText.length > 50
            ? plainText.substring(0, 50) + '...'
            : plainText;

        return `<div class="gantt-summary-cell cursor-pointer"
                     data-full-html="${escapeAttr(html)}"
                     data-plain-text="${escapeAttr(plainText)}">
                    <span class="line-clamp-1 text-sm">${escapeHtml(truncated)}</span>
                </div>`;
    }
}
```

#### 2.3.3 富文本弹窗

**弹窗样式**（添加到样式文件）：
```css
.summary-popover {
    position: absolute;
    z-index: 1000;
    max-width: 400px;
    max-height: 300px;
    overflow-y: auto;
    background: hsl(var(--b1));
    border: 1px solid hsl(var(--bc) / 0.2);
    border-radius: var(--rounded-box);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
    padding: 16px;
}

.summary-popover .ql-editor {
    padding: 0;
    font-size: 14px;
    line-height: 1.6;
}
```

**交互逻辑**（在 `columns.js` 或 `init.js` 中）：
```javascript
let currentPopover = null;

gantt.attachEvent("onGanttReady", function() {
    const gridData = gantt.$grid_data;

    // 鼠标进入事件
    gridData.addEventListener('mouseenter', function(e) {
        const cell = e.target.closest('.gantt-summary-cell');
        if (!cell) return;

        const fullHtml = cell.getAttribute('data-full-html');
        if (!fullHtml) return;

        showSummaryPopover(cell, fullHtml);
    }, true);

    // 鼠标离开事件
    gridData.addEventListener('mouseleave', function(e) {
        const cell = e.target.closest('.gantt-summary-cell');
        if (cell) {
            hideSummaryPopover();
        }
    }, true);
});

function showSummaryPopover(cell, html) {
    // 移除已有弹窗
    hideSummaryPopover();

    // 创建弹窗
    const popover = document.createElement('div');
    popover.className = 'summary-popover';
    popover.innerHTML = `<div class="ql-editor">${html}</div>`;

    // 定位
    const rect = cell.getBoundingClientRect();
    popover.style.left = rect.left + 'px';
    popover.style.top = (rect.bottom + 8) + 'px';

    document.body.appendChild(popover);
    currentPopover = popover;

    // 调整位置避免超出视口
    const popoverRect = popover.getBoundingClientRect();
    if (popoverRect.right > window.innerWidth) {
        popover.style.left = (window.innerWidth - popoverRect.width - 16) + 'px';
    }
    if (popoverRect.bottom > window.innerHeight) {
        popover.style.top = (rect.top - popoverRect.height - 8) + 'px';
    }
}

function hideSummaryPopover() {
    if (currentPopover) {
        currentPopover.remove();
        currentPopover = null;
    }
}
```

### 2.4 行内编辑类型匹配（F-4）

#### 2.4.1 编辑器类型判断

**修改 `src/features/gantt/inline-edit.js`**：
```javascript
import { getFieldType } from '../../core/store.js';

/**
 * 根据字段名获取编辑器类型
 * @param {string} columnName - 字段名称
 * @returns {string} 编辑器类型
 */
function getEditorType(columnName) {
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
            return 'richtext'; // 暂不支持行内富文本编辑
        default:
            return 'text';
    }
}
```

#### 2.4.2 下拉编辑器实现

**单选下拉编辑器**：
```javascript
function createSelectEditor(column, task) {
    const state = getState();
    const fieldDef = state.customFields.find(f => f.name === column);
    const options = fieldDef?.options || [];

    const select = document.createElement('select');
    select.className = 'select select-sm select-bordered w-full';

    // 添加空选项
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '—';
    select.appendChild(emptyOption);

    // 添加选项列表
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (task[column] === opt) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    return select;
}
```

**多选编辑器**（简化版）：
```javascript
function createMultiSelectEditor(column, task) {
    const state = getState();
    const fieldDef = state.customFields.find(f => f.name === column);
    const options = fieldDef?.options || [];
    const selected = (task[column] || '').split(',').filter(Boolean);

    // 创建容器
    const container = document.createElement('div');
    container.className = 'dropdown dropdown-open';

    // 创建输入框显示选中项
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input input-sm input-bordered w-full';
    input.value = selected.join(', ');
    input.readOnly = true;
    container.appendChild(input);

    // 创建下拉选项列表
    const menu = document.createElement('ul');
    menu.className = 'dropdown-content menu p-2 shadow bg-base-100 rounded-box w-full';

    options.forEach(opt => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'label cursor-pointer justify-start gap-2';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'checkbox checkbox-sm';
        checkbox.value = opt;
        checkbox.checked = selected.includes(opt);

        const span = document.createElement('span');
        span.className = 'label-text';
        span.textContent = opt;

        label.appendChild(checkbox);
        label.appendChild(span);
        li.appendChild(label);
        menu.appendChild(li);

        // 复选框变化时更新输入框显示
        checkbox.addEventListener('change', () => {
            const checkedBoxes = menu.querySelectorAll('input[type="checkbox"]:checked');
            const values = Array.from(checkedBoxes).map(cb => cb.value);
            input.value = values.join(', ');
            container.dataset.value = values.join(',');
        });
    });

    container.appendChild(menu);
    container.dataset.value = selected.join(',');

    return container;
}
```

#### 2.4.3 集成到编辑器工厂

**修改编辑器创建函数**：
```javascript
function createInlineEditor(column, task) {
    const editorType = getEditorType(column);

    switch (editorType) {
        case 'text':
            return createTextEditor(column, task);
        case 'number':
            return createNumberEditor(column, task);
        case 'date':
            return createDateEditor(column, task, false);
        case 'datetime':
            return createDateEditor(column, task, true);
        case 'select':
            return createSelectEditor(column, task);
        case 'multiselect':
            return createMultiSelectEditor(column, task);
        default:
            return createTextEditor(column, task);
    }
}

// 获取编辑器值
function getEditorValue(editor, editorType) {
    if (editorType === 'multiselect') {
        return editor.dataset.value || '';
    } else if (editor.tagName === 'SELECT') {
        return editor.value;
    } else if (editor._flatpickr) {
        return editor._flatpickr.selectedDates[0] || null;
    } else {
        return editor.value;
    }
}
```

## 3. 国际化支持

### 3.1 翻译键定义

**在 `src/config/i18n.js` 中添加**：

```javascript
// zh-CN
newTask: {
    title: '新建任务',
    nameLabel: '任务名称',
    namePlaceholder: '请输入任务名称',
    assigneeLabel: '负责人',
    assigneePlaceholder: '请选择负责人',
    cancel: '取消',
    create: '创建',
    nameRequired: '任务名称不能为空'
},
taskDetails: {
    required: '必填',
    systemField: '系统',
    quickDate: '今天',
    dateRangeError: '实际开始时间不能晚于实际结束时间',
    fieldDisabled: '此字段已禁用'
},
summary: {
    viewFull: '查看完整摘要',
    empty: '无摘要'
}

// en-US
newTask: {
    title: 'New Task',
    nameLabel: 'Task Name',
    namePlaceholder: 'Enter task name',
    assigneeLabel: 'Assignee',
    assigneePlaceholder: 'Select assignee',
    cancel: 'Cancel',
    create: 'Create',
    nameRequired: 'Task name is required'
},
taskDetails: {
    required: 'Required',
    systemField: 'System',
    quickDate: 'Today',
    dateRangeError: 'Actual start date cannot be later than actual end date',
    fieldDisabled: 'This field is disabled'
},
summary: {
    viewFull: 'View full summary',
    empty: 'No summary'
}

// ja-JP
newTask: {
    title: '新しいタスク',
    nameLabel: 'タスク名',
    namePlaceholder: 'タスク名を入力',
    assigneeLabel: '担当者',
    assigneePlaceholder: '担当者を選択',
    cancel: 'キャンセル',
    create: '作成',
    nameRequired: 'タスク名は必須です'
},
taskDetails: {
    required: '必須',
    systemField: 'システム',
    quickDate: '今日',
    dateRangeError: '実際の開始日は実際の終了日より後にできません',
    fieldDisabled: 'このフィールドは無効です'
},
summary: {
    viewFull: '完全な概要を表示',
    empty: '概要なし'
}

// ko-KR
newTask: {
    title: '새 작업',
    nameLabel: '작업 이름',
    namePlaceholder: '작업 이름 입력',
    assigneeLabel: '담당자',
    assigneePlaceholder: '담당자 선택',
    cancel: '취소',
    create: '생성',
    nameRequired: '작업 이름은 필수입니다'
},
taskDetails: {
    required: '필수',
    systemField: '시스템',
    quickDate: '오늘',
    dateRangeError: '실제 시작일은 실제 종료일보다 늦을 수 없습니다',
    fieldDisabled: '이 필드는 비활성화되었습니다'
},
summary: {
    viewFull: '전체 요약 보기',
    empty: '요약 없음'
}
```

### 3.2 动态文本更新

**监听语言切换事件**：
```javascript
window.addEventListener('languageChanged', function() {
    // 更新模态框文本
    updateModalTranslations();

    // 如果任务详情面板已打开，重新渲染
    if (window.currentTaskDetailsPanelId) {
        window.openTaskDetailsPanel(window.currentTaskDetailsPanelId);
    }
});

function updateModalTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = i18n.t(key);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = i18n.t(key);
    });
}
```

## 4. 测试要点

### 4.1 功能测试

**F-1: 新建任务模态框**
- [ ] 点击"新建任务"按钮打开模态框
- [ ] 任务名称为空时提交显示错误提示
- [ ] 任务名称超过100字符时截断
- [ ] 点击"取消"关闭模态框且不创建任务
- [ ] 成功创建任务后自动打开详情面板
- [ ] 负责人字段可留空

**F-2: 任务详情面板优化**
- [ ] 所有输入框样式统一为 `input-bordered`
- [ ] 必填字段显示红色星号
- [ ] 系统字段显示徽章标识
- [ ] 禁用字段显示灰色状态
- [ ] 负责人字段根据类型配置显示文本框/单选/多选
- [ ] 日期字段支持 date/datetime 类型切换
- [ ] 日期字段显示"今天"快捷按钮
- [ ] 实际开始时间晚于实际结束时间时显示警告

**F-3: 摘要字段显示优化**
- [ ] 列表中摘要字段显示纯文本（无HTML标签）
- [ ] 纯文本超过50字符时截断并显示省略号
- [ ] 鼠标悬浮在摘要单元格上显示富文本弹窗
- [ ] 弹窗内容正确渲染富文本格式（加粗、斜体、列表等）
- [ ] 弹窗位置自动调整避免超出视口
- [ ] 鼠标离开单元格时弹窗消失

**F-4: 行内编辑类型匹配**
- [ ] 文本类型字段显示文本输入框
- [ ] 数字类型字段显示数字输入框
- [ ] 日期类型字段显示日期选择器
- [ ] 日期时间类型字段显示日期时间选择器
- [ ] 单选类型字段显示下拉选择器
- [ ] 多选类型字段显示多选复选框组
- [ ] 负责人字段类型从 text 切换到 select 后行内编辑器更新

### 4.2 国际化测试

- [ ] 切换到英文后所有新增文本显示英文
- [ ] 切换到日文后所有新增文本显示日文
- [ ] 切换到韩文后所有新增文本显示韩文
- [ ] 切换回中文后所有新增文本显示中文
- [ ] 模态框标题、按钮、提示文本正确翻译
- [ ] 任务详情面板中的"必填"、"系统"、"今天"等标签正确翻译

### 4.3 兼容性测试

- [ ] Chrome 最新版本正常运行
- [ ] Firefox 最新版本正常运行
- [ ] Edge 最新版本正常运行
- [ ] Safari 最新版本正常运行（如适用）
- [ ] 移动端浏览器响应式布局正常

### 4.4 回归测试

- [ ] 现有任务创建流程未受影响（通过工具栏、快捷键等）
- [ ] 任务详情面板现有功能正常（保存、删除、添加子任务等）
- [ ] 摘要字段富文本编辑器正常工作
- [ ] 行内编辑保存后正确更新任务数据

## 5. 技术约束

### 5.1 依赖项
- DaisyUI 3.x（模态框、表单组件）
- Quill.js（富文本渲染）
- Flatpickr（日期选择器）
- DHTMLX Gantt（甘特图核心）

### 5.2 性能考虑
- 摘要文本提取使用 DOM 解析，避免正则表达式误伤合法内容
- 富文本弹窗按需创建和销毁，避免内存泄漏
- 行内编辑器缓存字段配置，减少重复查询

### 5.3 浏览器兼容性
- 目标浏览器：Chrome 90+, Firefox 88+, Edge 90+
- Polyfill 需求：无（现代浏览器原生支持 DOM API）

## 6. 未来扩展

### 6.1 短期优化
- 新建任务模态框支持更多字段（优先级、状态等）
- 富文本弹窗支持复制内容
- 多选编辑器使用更成熟的组件库（如 Choices.js）

### 6.2 长期规划
- 任务详情面板支持自定义布局
- 行内编辑支持富文本（技术难度较高）
- 摘要字段支持 Markdown 格式

## 7. 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-01-24 | v1.0 | 初始版本，完成四个优化点设计 | AI Assistant |

---

**设计批准**: ✅ 用户已确认
**下一步**: 创建实施计划
