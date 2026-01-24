# 任务新增页面优化 - 实施计划

## 版本信息
- 计划版本：v1.0
- 创建日期：2026-01-24
- 预计工时：12小时
- 优先级：高

## 1. 实施概览

### 1.1 任务分解

| 任务ID | 任务名称 | 预计工时 | 依赖项 | 优先级 |
|--------|----------|----------|--------|--------|
| T-1 | 创建工具函数 | 1h | - | P0 |
| T-2 | 新建任务模态框 | 2h | T-1 | P0 |
| T-3 | 任务详情面板样式优化 | 2h | T-1 | P1 |
| T-4 | 负责人字段动态渲染 | 1.5h | T-3 | P1 |
| T-5 | 摘要字段列表显示优化 | 2h | T-1 | P0 |
| T-6 | 行内编辑类型匹配 | 2h | T-1 | P0 |
| T-7 | 国际化文本补充 | 1h | - | P1 |
| T-8 | 测试与调试 | 2h | T-2, T-3, T-4, T-5, T-6, T-7 | P0 |

### 1.2 实施顺序

**第一阶段**（独立任务，可并行）：
- T-1: 创建工具函数
- T-7: 国际化文本补充

**第二阶段**（核心功能）：
- T-2: 新建任务模态框
- T-5: 摘要字段列表显示优化
- T-6: 行内编辑类型匹配

**第三阶段**（UI优化）：
- T-3: 任务详情面板样式优化
- T-4: 负责人字段动态渲染

**第四阶段**（验证）：
- T-8: 测试与调试

## 2. 详细实施步骤

### T-1: 创建工具函数

**目标**: 添加通用工具函数供其他模块使用

**涉及文件**:
- `src/utils/dom.js`

**实施步骤**:

1. 在 `src/utils/dom.js` 末尾添加以下函数：

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

/**
 * 显示摘要富文本弹窗
 * @param {HTMLElement} cell - 触发单元格元素
 * @param {string} html - 富文本HTML内容
 * @returns {HTMLElement} 弹窗元素
 */
export function showSummaryPopover(cell, html) {
    // 移除已有弹窗
    hideSummaryPopover();

    // 创建弹窗
    const popover = document.createElement('div');
    popover.className = 'summary-popover';
    popover.id = 'summary-popover';
    popover.innerHTML = `<div class="ql-editor">${html}</div>`;

    // 定位
    const rect = cell.getBoundingClientRect();
    popover.style.position = 'absolute';
    popover.style.left = rect.left + 'px';
    popover.style.top = (rect.bottom + 8) + 'px';
    popover.style.zIndex = '1000';

    document.body.appendChild(popover);

    // 调整位置避免超出视口
    const popoverRect = popover.getBoundingClientRect();
    if (popoverRect.right > window.innerWidth) {
        popover.style.left = (window.innerWidth - popoverRect.width - 16) + 'px';
    }
    if (popoverRect.bottom > window.innerHeight) {
        popover.style.top = (rect.top - popoverRect.height - 8) + 'px';
    }

    return popover;
}

/**
 * 隐藏摘要富文本弹窗
 */
export function hideSummaryPopover() {
    const popover = document.getElementById('summary-popover');
    if (popover) {
        popover.remove();
    }
}
```

2. 在文件顶部添加 CSS 样式（如果项目使用独立CSS文件，添加到对应位置）：

```javascript
// 在 dom.js 文件顶部或 index.html 的 <style> 标签中添加
/*
.summary-popover {
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
*/
```

**验证点**:
- [ ] 所有函数导出成功
- [ ] `extractPlainText` 能正确提取纯文本并清理HTML标签
- [ ] `escapeAttr` 能正确转义特殊字符
- [ ] 弹窗样式在浏览器中渲染正确

---

### T-2: 新建任务模态框

**目标**: 实现新建任务确认对话框，避免直接创建空任务

**涉及文件**:
- `index.html`
- `src/config/i18n.js`（依赖 T-7）

**实施步骤**:

1. 在 `index.html` 的 `<body>` 标签末尾，关闭 `</body>` 标签之前添加模态框HTML：

```html
<!-- 新建任务模态框 -->
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

2. 找到现有的新建任务按钮事件（约在 `index.html` 的 259-269 行），修改为打开模态框：

```javascript
// 原代码（删除或注释掉）：
// document.getElementById('add-task-btn').addEventListener('click', function() {
//     const newTask = {
//         text: i18n.t('gantt.newTask'),
//         start_date: new Date(),
//         duration: 1,
//         progress: 0
//     };
//     const taskId = gantt.addTask(newTask);
//     if (window.openTaskDetailsPanel) {
//         window.openTaskDetailsPanel(taskId);
//     }
// });

// 新代码：
document.getElementById('add-task-btn').addEventListener('click', function() {
    // 打开模态框而非直接创建任务
    document.getElementById('new-task-modal').showModal();
    // 聚焦到任务名称输入框
    setTimeout(() => {
        document.getElementById('new-task-name').focus();
    }, 100);
});
```

3. 在 `index.html` 的 `<script>` 标签中添加表单提交逻辑：

```javascript
// 新建任务表单提交事件
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

// 任务名称输入时隐藏错误提示
document.getElementById('new-task-name').addEventListener('input', function() {
    if (this.value.trim()) {
        document.getElementById('name-error').classList.add('hidden');
    }
});
```

**验证点**:
- [ ] 点击"新建任务"按钮打开模态框
- [ ] 模态框样式正确（DaisyUI 样式）
- [ ] 任务名称为空时提交显示错误提示
- [ ] 输入任务名称后错误提示自动消失
- [ ] 点击"取消"关闭模态框
- [ ] 点击背景关闭模态框
- [ ] 提交表单后创建任务并打开详情面板
- [ ] 表单提交后自动重置

---

### T-3: 任务详情面板样式优化

**目标**: 统一任务详情面板样式，改进视觉体验

**涉及文件**:
- `src/features/task-details/panel.js`
- `src/features/task-details/left-section.js`
- `src/features/task-details/right-section.js`

**实施步骤**:

1. 修改 `src/features/task-details/panel.js`，优化整体布局：

```javascript
// 找到创建面板容器的代码（约 40-60 行）
// 修改 CSS 类以增加间距和分隔线

export function createTaskDetailsPanel(taskId) {
    // ... 现有代码 ...

    // 修改容器样式
    const content = document.createElement('div');
    content.className = 'flex gap-6'; // 增加间距从 gap-4 到 gap-6

    // 添加分隔线
    const leftSection = createLeftSection(task);
    leftSection.className = 'flex-1 pr-6 border-r border-base-content/10'; // 添加右边框

    const rightSection = createRightSection(task);
    rightSection.className = 'w-80'; // 保持固定宽度

    content.appendChild(leftSection);
    content.appendChild(rightSection);

    // ... 其余代码 ...
}
```

2. 修改 `src/features/task-details/right-section.js`，统一字段样式：

```javascript
// 找到字段渲染函数（约在创建字段 HTML 的地方）
// 为每个字段添加统一的间距和样式

function renderField(fieldName, fieldLabel, fieldValue, fieldType, isSystemField = false) {
    const isRequired = ['text', 'description', 'priority', 'assignee', 'start_date', 'end_date'].includes(fieldName);
    const isDisabled = !isFieldEnabled(fieldName);

    return `
        <div class="form-control mb-4"> <!-- 统一间距 mb-4 -->
            <label class="label">
                <span class="label-text">${fieldLabel}</span>
                <span class="flex gap-2 items-center">
                    ${isRequired ? '<span class="text-error text-xs">*</span>' : ''}
                    ${isSystemField ? '<span class="badge badge-sm badge-ghost" data-i18n="taskDetails.systemField">系统</span>' : ''}
                </span>
            </label>
            ${renderFieldInput(fieldName, fieldValue, fieldType, isDisabled)}
            ${isDisabled ? '<label class="label"><span class="label-text-alt text-base-content/60" data-i18n="taskDetails.fieldDisabled">此字段已禁用</span></label>' : ''}
        </div>
    `;
}

function renderFieldInput(fieldName, fieldValue, fieldType, isDisabled) {
    const baseClass = isDisabled ? 'input input-bordered input-disabled w-full' : 'input input-bordered w-full';

    switch (fieldType) {
        case 'text':
            return `<input type="text"
                           class="${baseClass}"
                           value="${escapeHtml(fieldValue || '')}"
                           data-field="${fieldName}"
                           ${isDisabled ? 'disabled' : ''}>`;
        case 'number':
            return `<input type="number"
                           class="${baseClass}"
                           value="${fieldValue || 0}"
                           data-field="${fieldName}"
                           ${isDisabled ? 'disabled' : ''}>`;
        case 'select':
            return renderSelectField(fieldName, fieldValue, isDisabled);
        // ... 其他类型
        default:
            return `<input type="text"
                           class="${baseClass}"
                           value="${escapeHtml(fieldValue || '')}"
                           data-field="${fieldName}"
                           ${isDisabled ? 'disabled' : ''}>`;
    }
}

function renderSelectField(fieldName, fieldValue, isDisabled) {
    const fieldDef = state.customFields.find(f => f.name === fieldName);
    const options = fieldDef?.options || [];

    return `
        <select class="select select-bordered w-full"
                data-field="${fieldName}"
                ${isDisabled ? 'disabled' : ''}>
            <option value="">—</option>
            ${options.map(opt =>
                `<option value="${escapeAttr(opt)}" ${fieldValue === opt ? 'selected' : ''}>
                    ${escapeHtml(opt)}
                 </option>`
            ).join('')}
        </select>
    `;
}
```

3. 为日期字段添加"今天"快捷按钮（在初始化 Flatpickr 的地方）：

```javascript
import flatpickr from 'flatpickr';
import { Chinese } from 'flatpickr/dist/l10n/zh.js';
import { english } from 'flatpickr/dist/l10n/default.js';
import { Japanese } from 'flatpickr/dist/l10n/ja.js';
import { Korean } from 'flatpickr/dist/l10n/ko.js';

function initDatePicker(fieldName, task) {
    const fieldType = getFieldType(fieldName);
    const enableTime = fieldType === 'datetime';
    const currentLang = i18n.getCurrentLanguage();

    const localeMap = {
        'zh-CN': Chinese,
        'en-US': english,
        'ja-JP': Japanese,
        'ko-KR': Korean
    };

    const fp = flatpickr(`[data-field="${fieldName}"]`, {
        enableTime: enableTime,
        dateFormat: enableTime ? 'Y-m-d H:i' : 'Y-m-d',
        time_24hr: true,
        locale: localeMap[currentLang] || Chinese,
        // 添加"今天"快捷按钮
        onReady: function(dateObj, dateStr, instance) {
            const todayBtn = document.createElement('button');
            todayBtn.type = 'button';
            todayBtn.className = 'btn btn-sm btn-ghost';
            todayBtn.textContent = i18n.t('taskDetails.quickDate');
            todayBtn.addEventListener('click', () => {
                instance.setDate(new Date(), true);
            });

            instance.calendarContainer.appendChild(todayBtn);
        }
    });

    return fp;
}
```

4. 添加日期范围验证：

```javascript
function validateDateRange(task) {
    if (task.actual_start && task.actual_end) {
        const startDate = new Date(task.actual_start);
        const endDate = new Date(task.actual_end);

        if (startDate > endDate) {
            // 显示警告提示
            showNotification(i18n.t('taskDetails.dateRangeError'), 'warning');
            return false;
        }
    }
    return true;
}

// 在保存任务时调用验证
function saveTask() {
    const task = getCurrentTask();

    if (!validateDateRange(task)) {
        return; // 阻止保存
    }

    // 继续保存逻辑...
}
```

**验证点**:
- [ ] 左右栏之间有明显分隔线
- [ ] 所有字段间距统一为 16px
- [ ] 输入框样式统一为 `input-bordered`
- [ ] 必填字段显示红色星号
- [ ] 系统字段显示徽章
- [ ] 禁用字段显示灰色状态和提示文本
- [ ] 日期选择器显示"今天"按钮
- [ ] 日期范围错误时显示警告

---

### T-4: 负责人字段动态渲染

**目标**: 根据字段类型配置动态渲染负责人字段（文本/单选/多选）

**涉及文件**:
- `src/features/task-details/right-section.js`

**实施步骤**:

1. 在 `right-section.js` 中添加负责人字段专用渲染函数：

```javascript
import { getFieldType, getState } from '../../core/store.js';

function renderAssigneeField(task) {
    const fieldType = getFieldType('assignee');
    const state = getState();
    const fieldDef = state.customFields.find(f => f.name === 'assignee');
    const options = fieldDef?.options || [];
    const isDisabled = !isFieldEnabled('assignee'); // 负责人字段通常不能禁用

    if (fieldType === 'text') {
        // 文本输入框
        return `
            <div class="form-control mb-4">
                <label class="label">
                    <span class="label-text" data-i18n="fields.assignee">负责人</span>
                    <span class="text-error text-xs">*</span>
                </label>
                <input type="text"
                       class="input input-bordered w-full"
                       value="${escapeHtml(task.assignee || '')}"
                       data-field="assignee">
            </div>
        `;
    } else if (fieldType === 'select') {
        // 单选下拉
        return `
            <div class="form-control mb-4">
                <label class="label">
                    <span class="label-text" data-i18n="fields.assignee">负责人</span>
                    <span class="text-error text-xs">*</span>
                </label>
                <select class="select select-bordered w-full" data-field="assignee">
                    <option value="">—</option>
                    ${options.map(opt =>
                        `<option value="${escapeAttr(opt)}" ${task.assignee === opt ? 'selected' : ''}>
                            ${escapeHtml(opt)}
                         </option>`
                    ).join('')}
                </select>
            </div>
        `;
    } else if (fieldType === 'multiselect') {
        // 多选复选框组
        const selected = (task.assignee || '').split(',').filter(Boolean);

        return `
            <div class="form-control mb-4">
                <label class="label">
                    <span class="label-text" data-i18n="fields.assignee">负责人</span>
                </label>
                <div class="space-y-2" data-field="assignee" data-type="multiselect">
                    ${options.map(opt => `
                        <label class="label cursor-pointer justify-start gap-2">
                            <input type="checkbox"
                                   class="checkbox checkbox-sm"
                                   value="${escapeAttr(opt)}"
                                   ${selected.includes(opt) ? 'checked' : ''}
                                   data-multiselect-option>
                            <span class="label-text">${escapeHtml(opt)}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `;
    }
}
```

2. 在保存任务时处理多选值：

```javascript
function collectFormData() {
    const formData = {};

    // 处理普通字段
    document.querySelectorAll('[data-field]:not([data-type="multiselect"])').forEach(input => {
        const fieldName = input.getAttribute('data-field');
        formData[fieldName] = input.value;
    });

    // 处理多选字段
    document.querySelectorAll('[data-field][data-type="multiselect"]').forEach(container => {
        const fieldName = container.getAttribute('data-field');
        const checkedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
        const values = Array.from(checkedBoxes).map(cb => cb.value);
        formData[fieldName] = values.join(',');
    });

    return formData;
}
```

3. 在 `createRightSection` 函数中使用专用渲染函数：

```javascript
export function createRightSection(task) {
    const container = document.createElement('div');
    container.className = 'w-80';

    // 渲染系统字段
    let html = '<div class="space-y-4">';

    // 负责人字段使用专用渲染函数
    html += renderAssigneeField(task);

    // 其他系统字段
    html += renderField('priority', i18n.t('fields.priority'), task.priority, getFieldType('priority'), true);
    html += renderField('status', i18n.t('fields.status'), task.status, getFieldType('status'), true);
    // ...

    html += '</div>';
    container.innerHTML = html;

    return container;
}
```

**验证点**:
- [ ] 负责人字段类型为 text 时显示文本输入框
- [ ] 负责人字段类型为 select 时显示下拉选择器
- [ ] 负责人字段类型为 multiselect 时显示复选框组
- [ ] 单选模式保存正确
- [ ] 多选模式保存为逗号分隔字符串
- [ ] 多选模式读取时正确回显选中状态

---

### T-5: 摘要字段列表显示优化

**目标**: 列表中显示纯文本，悬浮显示富文本弹窗

**涉及文件**:
- `src/features/gantt/columns.js`
- `src/features/gantt/init.js`

**实施步骤**:

1. 修改 `src/features/gantt/columns.js` 中的 summary 列模板（约 85-104 行）：

```javascript
import { extractPlainText, escapeAttr, escapeHtml } from '../../utils/dom.js';

// 找到 summary 列定义
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

        // 截断显示（最多50字符）
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

2. 在 `src/features/gantt/init.js` 中添加弹窗事件监听：

```javascript
import { showSummaryPopover, hideSummaryPopover } from '../../utils/dom.js';

// 在 gantt.init() 之后添加
gantt.attachEvent("onGanttReady", function() {
    const gridData = gantt.$grid_data;

    // 鼠标进入事件（使用事件委托）
    gridData.addEventListener('mouseenter', function(e) {
        const cell = e.target.closest('.gantt-summary-cell');
        if (!cell) return;

        const fullHtml = cell.getAttribute('data-full-html');
        if (!fullHtml) return;

        showSummaryPopover(cell, fullHtml);
    }, true); // 使用捕获阶段确保事件正确触发

    // 鼠标离开事件
    gridData.addEventListener('mouseleave', function(e) {
        const cell = e.target.closest('.gantt-summary-cell');
        if (cell) {
            hideSummaryPopover();
        }
    }, true);
});
```

3. 在 `index.html` 或相应的 CSS 文件中添加弹窗样式：

```html
<style>
.summary-popover {
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

.summary-popover .ql-editor p {
    margin-bottom: 8px;
}

.summary-popover .ql-editor ul,
.summary-popover .ql-editor ol {
    padding-left: 20px;
    margin-bottom: 8px;
}

.summary-popover .ql-editor strong {
    font-weight: 600;
}

.summary-popover .ql-editor em {
    font-style: italic;
}
</style>
```

**验证点**:
- [ ] 列表中摘要列显示纯文本（无 HTML 标签）
- [ ] 超过 50 字符的文本显示省略号
- [ ] 鼠标悬浮在单元格上显示弹窗
- [ ] 弹窗内容正确渲染富文本格式（加粗、斜体、列表等）
- [ ] 弹窗位置自动调整避免超出视口右侧
- [ ] 弹窗位置自动调整避免超出视口底部
- [ ] 鼠标离开单元格时弹窗消失
- [ ] 空摘要字段显示"—"占位符

---

### T-6: 行内编辑类型匹配

**目标**: 根据 `getFieldType()` 动态匹配编辑器类型

**涉及文件**:
- `src/features/gantt/inline-edit.js`

**实施步骤**:

1. 修改 `getEditorType()` 函数（约 39-59 行）：

```javascript
import { getFieldType, getState } from '../../core/store.js';

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
            // 富文本暂不支持行内编辑，使用文本框
            return 'text';
        default:
            return 'text';
    }
}
```

2. 添加单选下拉编辑器创建函数：

```javascript
/**
 * 创建单选下拉编辑器
 * @param {string} column - 字段名
 * @param {object} task - 任务对象
 * @returns {HTMLElement} 下拉编辑器元素
 */
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

3. 添加多选编辑器创建函数：

```javascript
/**
 * 创建多选编辑器（简化版，使用文本输入+下拉提示）
 * @param {string} column - 字段名
 * @param {object} task - 任务对象
 * @returns {HTMLElement} 多选编辑器元素
 */
function createMultiSelectEditor(column, task) {
    const state = getState();
    const fieldDef = state.customFields.find(f => f.name === column);
    const options = fieldDef?.options || [];
    const selected = (task[column] || '').split(',').filter(Boolean);

    // 创建容器
    const container = document.createElement('div');
    container.className = 'dropdown dropdown-open w-full';
    container.style.position = 'relative';

    // 创建输入框显示选中项
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input input-sm input-bordered w-full';
    input.value = selected.join(', ');
    input.readOnly = true;
    container.appendChild(input);

    // 创建下拉选项列表
    const menu = document.createElement('ul');
    menu.className = 'dropdown-content menu p-2 shadow bg-base-100 rounded-box w-full mt-1';
    menu.style.position = 'absolute';
    menu.style.top = '100%';
    menu.style.left = '0';
    menu.style.zIndex = '1000';
    menu.style.maxHeight = '200px';
    menu.style.overflowY = 'auto';

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

4. 修改 `createInlineEditor()` 函数集成新编辑器：

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
```

5. 修改 `getEditorValue()` 函数处理新编辑器：

```javascript
function getEditorValue(editor, column) {
    const editorType = getEditorType(column);

    if (editorType === 'multiselect') {
        // 多选编辑器从 dataset 读取
        return editor.dataset.value || '';
    } else if (editor.tagName === 'SELECT') {
        // 下拉选择器
        return editor.value;
    } else if (editor._flatpickr) {
        // 日期选择器
        const date = editor._flatpickr.selectedDates[0];
        return date ? gantt.date.date_to_str(gantt.config.date_format)(date) : null;
    } else {
        // 文本/数字输入框
        return editor.value;
    }
}
```

**验证点**:
- [ ] 文本类型字段双击显示文本输入框
- [ ] 数字类型字段双击显示数字输入框
- [ ] 日期类型字段双击显示日期选择器
- [ ] 日期时间类型字段双击显示日期时间选择器
- [ ] 单选类型字段双击显示下拉选择器
- [ ] 多选类型字段双击显示多选框
- [ ] 负责人字段从 text 切换到 select 后行内编辑器正确更新
- [ ] 编辑器失焦后正确保存值
- [ ] 多选字段保存为逗号分隔字符串

---

### T-7: 国际化文本补充

**目标**: 添加所有新增功能的多语言翻译

**涉及文件**:
- `src/config/i18n.js`

**实施步骤**:

1. 在 `src/config/i18n.js` 中找到各语言对象，添加新翻译键：

```javascript
// zh-CN
const zhCN = {
    // ... 现有翻译 ...

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
};

// en-US
const enUS = {
    // ... 现有翻译 ...

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
};

// ja-JP
const jaJP = {
    // ... 现有翻译 ...

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
};

// ko-KR
const koKR = {
    // ... 现有翻译 ...

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
};
```

2. 确保 `i18n.t()` 函数支持嵌套键访问（通常已实现）：

```javascript
function t(key) {
    const keys = key.split('.');
    let value = translations[currentLanguage];

    for (const k of keys) {
        value = value?.[k];
        if (value === undefined) {
            console.warn(`Translation key not found: ${key}`);
            return key;
        }
    }

    return value;
}
```

3. 添加动态翻译更新函数（如果尚未实现）：

```javascript
export function updateTranslations() {
    // 更新所有带 data-i18n 属性的元素
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });

    // 更新所有带 data-i18n-placeholder 属性的元素
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });

    // 触发自定义事件通知其他模块
    window.dispatchEvent(new CustomEvent('languageChanged'));
}

// 在切换语言时调用
export function setLanguage(lang) {
    currentLanguage = lang;
    updateTranslations();

    // 保存到 localStorage
    localStorage.setItem('language', lang);
}
```

**验证点**:
- [ ] 所有4种语言的翻译键已添加
- [ ] 切换到英文后所有新增文本显示英文
- [ ] 切换到日文后所有新增文本显示日文
- [ ] 切换到韩文后所有新增文本显示韩文
- [ ] 切换回中文后所有新增文本显示中文
- [ ] 模态框动态更新语言
- [ ] 任务详情面板动态更新语言

---

### T-8: 测试与调试

**目标**: 全面测试所有新功能，修复发现的问题

**测试用例**:

#### 8.1 新建任务模态框测试

| 测试项 | 操作步骤 | 期望结果 | 实际结果 | 状态 |
|--------|----------|----------|----------|------|
| TC-1 | 点击"新建任务"按钮 | 打开模态框 | | |
| TC-2 | 不输入任务名称直接提交 | 显示错误提示 | | |
| TC-3 | 输入任务名称后提交 | 创建任务并打开详情面板 | | |
| TC-4 | 点击"取消"按钮 | 关闭模态框，不创建任务 | | |
| TC-5 | 点击模态框背景 | 关闭模态框，不创建任务 | | |
| TC-6 | 输入超过100字符的任务名称 | 自动截断到100字符 | | |
| TC-7 | 输入负责人并提交 | 任务的负责人字段正确保存 | | |

#### 8.2 任务详情面板测试

| 测试项 | 操作步骤 | 期望结果 | 实际结果 | 状态 |
|--------|----------|----------|----------|------|
| TC-8 | 打开任务详情面板 | 左右栏有明显分隔线 | | |
| TC-9 | 检查所有字段间距 | 统一为16px（mb-4） | | |
| TC-10 | 检查必填字段 | 显示红色星号 | | |
| TC-11 | 检查系统字段 | 显示"系统"徽章 | | |
| TC-12 | 检查禁用字段 | 显示灰色状态和提示 | | |
| TC-13 | 点击日期字段 | 显示日期选择器和"今天"按钮 | | |
| TC-14 | 设置实际开始>实际结束 | 显示警告提示 | | |

#### 8.3 负责人字段测试

| 测试项 | 操作步骤 | 期望结果 | 实际结果 | 状态 |
|--------|----------|----------|----------|------|
| TC-15 | 负责人类型为text | 显示文本输入框 | | |
| TC-16 | 负责人类型为select | 显示下拉选择器 | | |
| TC-17 | 负责人类型为multiselect | 显示复选框组 | | |
| TC-18 | 单选模式选择值后保存 | 正确保存选中值 | | |
| TC-19 | 多选模式选择多个值后保存 | 保存为逗号分隔字符串 | | |
| TC-20 | 修改负责人字段类型 | 任务详情面板动态更新 | | |

#### 8.4 摘要字段显示测试

| 测试项 | 操作步骤 | 期望结果 | 实际结果 | 状态 |
|--------|----------|----------|----------|------|
| TC-21 | 列表中查看富文本摘要 | 显示纯文本，无HTML标签 | | |
| TC-22 | 查看超过50字符的摘要 | 截断并显示省略号 | | |
| TC-23 | 鼠标悬浮在摘要单元格 | 显示富文本弹窗 | | |
| TC-24 | 检查弹窗内容 | 正确渲染加粗、斜体、列表 | | |
| TC-25 | 弹窗位置超出右侧视口 | 自动调整到视口内 | | |
| TC-26 | 弹窗位置超出底部视口 | 显示在单元格上方 | | |
| TC-27 | 鼠标离开单元格 | 弹窗消失 | | |

#### 8.5 行内编辑测试

| 测试项 | 操作步骤 | 期望结果 | 实际结果 | 状态 |
|--------|----------|----------|----------|------|
| TC-28 | 双击文本类型字段 | 显示文本输入框 | | |
| TC-29 | 双击数字类型字段 | 显示数字输入框 | | |
| TC-30 | 双击日期类型字段 | 显示日期选择器 | | |
| TC-31 | 双击单选类型字段 | 显示下拉选择器 | | |
| TC-32 | 双击多选类型字段 | 显示多选框 | | |
| TC-33 | 负责人从text切换到select | 行内编辑器变为下拉 | | |
| TC-34 | 编辑后失焦 | 正确保存值 | | |

#### 8.6 国际化测试

| 测试项 | 操作步骤 | 期望结果 | 实际结果 | 状态 |
|--------|----------|----------|----------|------|
| TC-35 | 切换到英文 | 所有新增文本显示英文 | | |
| TC-36 | 切换到日文 | 所有新增文本显示日文 | | |
| TC-37 | 切换到韩文 | 所有新增文本显示韩文 | | |
| TC-38 | 切换回中文 | 所有新增文本显示中文 | | |

**调试清单**:
- [ ] 所有测试用例通过
- [ ] 控制台无错误或警告
- [ ] 性能正常（无明显卡顿）
- [ ] 内存无泄漏（长时间使用后检查）
- [ ] 跨浏览器兼容性测试（Chrome, Firefox, Edge）

---

## 3. 验收标准

### 3.1 功能完整性
- [ ] 所有4个优化点（F-1至F-4）全部实现
- [ ] 所有测试用例通过
- [ ] 国际化支持4种语言

### 3.2 代码质量
- [ ] 代码符合项目编码规范
- [ ] 无 ESLint 错误
- [ ] 关键函数添加注释
- [ ] 无重复代码

### 3.3 用户体验
- [ ] UI样式统一，符合DaisyUI设计规范
- [ ] 交互流畅，无卡顿
- [ ] 错误提示清晰友好
- [ ] 响应式布局正常

### 3.4 性能指标
- [ ] 模态框打开时间 < 100ms
- [ ] 摘要弹窗显示时间 < 50ms
- [ ] 行内编辑器创建时间 < 100ms
- [ ] 任务详情面板渲染时间 < 300ms

## 4. 风险与应对

| 风险项 | 风险等级 | 影响范围 | 应对措施 |
|--------|----------|----------|----------|
| 富文本弹窗性能问题 | 中 | 大量任务时可能卡顿 | 使用虚拟滚动或按需渲染 |
| 多选编辑器UI复杂度 | 中 | 开发工时增加 | 使用第三方组件库（Choices.js） |
| 日期范围验证逻辑 | 低 | 边界情况处理 | 充分测试各种日期组合 |
| 国际化文本遗漏 | 低 | 部分文本未翻译 | 代码审查+测试验证 |

## 5. 后续优化建议

### 5.1 短期（1-2周）
- 新建任务模态框支持更多字段（优先级、状态、开始日期）
- 富文本弹窗支持复制内容功能
- 多选编辑器使用更成熟的组件库

### 5.2 中期（1-2个月）
- 任务详情面板支持自定义字段排序
- 摘要字段支持 Markdown 格式
- 行内编辑支持撤销/重做

### 5.3 长期（3个月+）
- 任务详情面板支持自定义布局（用户可拖拽调整）
- 行内编辑支持富文本（技术难度较高）
- 批量编辑功能

## 6. 文档更新

完成实施后需更新以下文档：
- [ ] README.md（添加新功能说明）
- [ ] 用户手册（新建任务流程）
- [ ] API文档（新增函数说明）
- [ ] 测试报告（测试结果记录）

---

**实施负责人**: 待分配
**审核人**: 待分配
**预计完成日期**: 2026-01-26
