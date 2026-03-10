# 三功能实现计划：项目管理内联新建 + 任务定位 + 父任务断续 Summary Bar

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现三个独立功能：①项目管理弹窗内联新建项目行；②点击任务列表行甘特图自动定位；③父任务渲染为"断续 Summary Bar"（有子任务处实心段 + 空白期细线）。

**Architecture:** 功能一仅修改 `ProjectModal.js`，复用已有 `createProject()`；功能二在 `init.js` 的 `onTaskClick` 追加 3 行；功能三新建 `summary-bar.js`，复用 `baseline.js` 的 `addTaskLayer` 模式，通过 CSS 隐藏原生父任务条。

**Tech Stack:** Vanilla JS ES Modules, DHTMLX Gantt, DaisyUI 5, Vitest

---

## Task 1：项目管理弹窗内联新建行

**Files:**
- Modify: `src/features/projects/ProjectModal.js`
- Create: `tests/unit/projects/project-modal-create.test.js`

### Step 1：写失败测试

```js
// tests/unit/projects/project-modal-create.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖
vi.mock('../../../src/core/store.js', () => ({
    state: { projects: [], currentProjectId: 'prj_default' },
    refreshProjects: vi.fn(),
}));
vi.mock('../../../src/features/projects/manager.js', () => ({
    createProject: vi.fn(async ({ name, color }) => ({
        id: 'prj_new',
        name,
        color,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    })),
    getProjectTaskCount: vi.fn(async () => 0),
}));
vi.mock('../../../src/utils/i18n.js', () => ({
    i18n: { t: (k) => k },
}));
vi.mock('../../../src/utils/toast.js', () => ({
    showToast: vi.fn(),
}));
vi.mock('../../../src/components/common/confirm-dialog.js', () => ({
    showConfirmDialog: vi.fn(),
}));

describe('ProjectModal inline create row', () => {
    it('renderModal 后应包含内联新建行和 + 按钮', async () => {
        const { openProjectModal } = await import('../../../src/features/projects/ProjectModal.js');
        const modal = document.createElement('dialog');
        modal.id = 'project-manage-modal';
        document.body.appendChild(modal);

        openProjectModal();
        await new Promise(r => setTimeout(r, 50));

        expect(modal.innerHTML).toContain('project-inline-create-input');
        expect(modal.innerHTML).toContain('project-inline-create-btn');
    });

    it('名称为空时点击 + 按钮不调用 createProject', async () => {
        const { createProject } = await import('../../../src/features/projects/manager.js');
        createProject.mockClear();

        const btn = document.querySelector('[data-testid="project-inline-create-btn"]');
        if (btn) btn.click();
        await new Promise(r => setTimeout(r, 20));

        expect(createProject).not.toHaveBeenCalled();
    });
});
```

### Step 2：运行测试确认失败

```bash
npx vitest run tests/unit/projects/project-modal-create.test.js
```

Expected: FAIL（`project-inline-create-input` 不存在）

### Step 3：在 `renderModal` 函数末尾的 `<tbody>` 后追加内联新建行

在 `ProjectModal.js` 的 `renderModal()` 函数中，找到 `<tbody>${rows}</tbody>` 这行，替换为：

```js
<tbody>
    ${rows}
    <tr id="project-inline-create-row">
        <td>
            <div class="flex items-center gap-3">
                <div class="color-picker flex gap-1" id="inline-create-color-picker">
                    ${COLORS.map((color, i) => `
                        <button
                            type="button"
                            class="w-2 h-2 rounded-full cursor-pointer transition-transform hover:scale-125 ${i === 0 ? 'ring-1 ring-offset-1 ring-gray-400' : ''}"
                            style="background:${color}"
                            data-inline-color="${color}"
                        ></button>
                    `).join('')}
                </div>
                <input
                    id="project-inline-create-input"
                    class="input input-sm w-40 bg-transparent border-0 border-b border-base-300 focus:border-primary focus:outline-none focus:bg-base-200/50 rounded-none px-1"
                    placeholder="${i18n.t('project.newProjectPlaceholder') || '新项目名称'}"
                    maxlength="50"
                />
            </div>
        </td>
        <td></td>
        <td></td>
        <td class="w-16">
            <button
                type="button"
                id="project-inline-create-btn"
                data-testid="project-inline-create-btn"
                class="btn btn-ghost btn-xs text-primary"
                title="${i18n.t('project.create') || '新建项目'}"
            >
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14"/>
                </svg>
            </button>
        </td>
    </tr>
</tbody>
```

然后在 `bindModalEvents()` 末尾追加调用：

```js
bindCreateRow(modal);
```

新增 `bindCreateRow(modal)` 函数（放在 `bindModalEvents` 之后）：

```js
function bindCreateRow(modal) {
    let selectedColor = COLORS[0];

    // 颜色选择
    modal.querySelectorAll('[data-inline-color]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedColor = btn.dataset.inlineColor;
            // 更新 ring 状态
            modal.querySelectorAll('[data-inline-color]').forEach(b => {
                b.classList.toggle('ring-1', b.dataset.inlineColor === selectedColor);
                b.classList.toggle('ring-offset-1', b.dataset.inlineColor === selectedColor);
                b.classList.toggle('ring-gray-400', b.dataset.inlineColor === selectedColor);
            });
        });
    });

    const input = modal.querySelector('#project-inline-create-input');
    const btn = modal.querySelector('#project-inline-create-btn');
    if (!input || !btn) return;

    const doCreate = async () => {
        const name = input.value.trim();
        if (!name) {
            input.classList.add('input-error');
            input.focus();
            setTimeout(() => input.classList.remove('input-error'), 1000);
            return;
        }

        btn.disabled = true;
        try {
            await createProject({ name, color: selectedColor });
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
            await renderModal(modal);
            openModalDialog(modal);
        } catch (error) {
            console.error('[Projects] Failed to create project inline:', error);
            showToast(i18n.t('common.operationFailed') || '操作失败', 'error');
            btn.disabled = false;
        }
    };

    btn.addEventListener('click', doCreate);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doCreate();
    });
}
```

同时在文件顶部 import 中补充 `createProject`：

```js
import { updateProject, deleteProject, getProjectTaskCount, createProject } from './manager.js';
```

### Step 4：运行测试确认通过

```bash
npx vitest run tests/unit/projects/project-modal-create.test.js
```

Expected: PASS

### Step 5：Commit

```bash
git add src/features/projects/ProjectModal.js tests/unit/projects/project-modal-create.test.js
git commit -m "feat(projects): add inline create row to project manage modal"
```

---

## Task 2：点击任务行时甘特图自动定位

**Files:**
- Modify: `src/features/gantt/init.js:718-736`
- Create: `tests/unit/gantt/task-click-locate.test.js`

### Step 1：写失败测试

```js
// tests/unit/gantt/task-click-locate.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTask = { id: 1, text: 'Task A', start_date: new Date('2026-03-10'), duration: 3 };

describe('onTaskClick → gantt.showDate', () => {
    beforeEach(() => {
        global.gantt = {
            attachEvent: vi.fn((event, handler) => {
                if (event === 'onTaskClick') global._onTaskClick = handler;
            }),
            selectTask: vi.fn(),
            getTask: vi.fn(() => mockTask),
            showDate: vi.fn(),
        };
        global.state = { viewMode: 'split', selectedTasks: new Set() };
    });

    it('split 模式下点击任务应调用 gantt.showDate 传入任务 start_date', () => {
        global.state.viewMode = 'split';
        // 模拟 onTaskClick 调用
        if (global._onTaskClick) {
            global._onTaskClick(1, { target: null });
        }
        expect(global.gantt.showDate).toHaveBeenCalledWith(mockTask.start_date);
    });

    it('table 模式下点击任务不应调用 gantt.showDate', () => {
        global.state.viewMode = 'table';
        if (global._onTaskClick) {
            global._onTaskClick(1, { target: null });
        }
        expect(global.gantt.showDate).not.toHaveBeenCalled();
    });

    it('gantt 模式下点击任务应调用 gantt.showDate', () => {
        global.state.viewMode = 'gantt';
        if (global._onTaskClick) {
            global._onTaskClick(1, { target: null });
        }
        expect(global.gantt.showDate).toHaveBeenCalledWith(mockTask.start_date);
    });
});
```

### Step 2：运行测试确认失败

```bash
npx vitest run tests/unit/gantt/task-click-locate.test.js
```

Expected: FAIL（`showDate` 未被调用）

### Step 3：修改 `init.js` 的 `onTaskClick` 事件

找到 `src/features/gantt/init.js` 约第 718 行的 `onTaskClick` 事件：

**当前代码：**
```js
gantt.attachEvent("onTaskClick", function (id, e) {
    if (e.target) {
        if (e.target.classList && e.target.classList.contains('gantt-checkbox-selection')) {
            return true;
        }
        const cell = e.target.closest('.gantt_cell');
        if (cell) {
            const checkbox = cell.querySelector('.gantt-checkbox-selection');
            if (checkbox) {
                return true;
            }
        }
    }

    if (typeof gantt.selectTask === 'function') {
        gantt.selectTask(id);
    }
    return true;
});
```

**替换为：**
```js
gantt.attachEvent("onTaskClick", function (id, e) {
    if (e.target) {
        if (e.target.classList && e.target.classList.contains('gantt-checkbox-selection')) {
            return true;
        }
        const cell = e.target.closest('.gantt_cell');
        if (cell) {
            const checkbox = cell.querySelector('.gantt-checkbox-selection');
            if (checkbox) {
                return true;
            }
        }
    }

    if (typeof gantt.selectTask === 'function') {
        gantt.selectTask(id);
    }

    // 定位时间轴到任务起始日期（仅 split / gantt 模式有时间轴）
    if (state.viewMode !== 'table') {
        try {
            const task = gantt.getTask(id);
            if (task && typeof gantt.showDate === 'function') {
                gantt.showDate(task.start_date);
            }
        } catch (err) {
            console.warn('[Gantt] Failed to locate task on timeline:', err);
        }
    }

    return true;
});
```

### Step 4：运行测试确认通过

```bash
npx vitest run tests/unit/gantt/task-click-locate.test.js
```

Expected: PASS（3 个测试全部通过）

### Step 5：Commit

```bash
git add src/features/gantt/init.js tests/unit/gantt/task-click-locate.test.js
git commit -m "feat(gantt): scroll timeline to task start_date on task row click"
```

---

## Task 3：父任务断续 Summary Bar — CSS 隐藏默认父任务条

**Files:**
- Modify: `src/styles/pages/gantt.css`
- Modify: `src/features/gantt/init.js:503-528`（`task_class` 模板）

### Step 1：在 `task_class` 模板中为父任务追加 `summary-parent` 类

找到 `init.js` 约第 503 行的 `gantt.templates.task_class`：

**当前代码结尾：**
```js
    // if (task.progress < 1 && new Date() > end) {
    //    classes.push("task_overdue");
    // }
    if (task.progress >= 1) {
        classes.push("task_completed");
    }
    return classes.join(" ");
};
```

**替换为：**
```js
    // if (task.progress < 1 && new Date() > end) {
    //    classes.push("task_overdue");
    // }
    if (task.progress >= 1) {
        classes.push("task_completed");
    }

    // 有子任务的父任务：隐藏默认实心条，由 summary-bar layer 接管
    if (typeof gantt.hasChild === 'function' && gantt.hasChild(task.id)) {
        classes.push('summary-parent');
    }

    return classes.join(" ");
};
```

### Step 2：在 `gantt.css` 末尾追加 summary-parent 及 summary bar 样式

在 `src/styles/pages/gantt.css` 文件末尾追加：

```css
/* ========================================
   Summary Bar — 父任务断续样式
   有子任务的父任务默认条被隐藏，由 addTaskLayer 自定义渲染接管
   ======================================== */

/* 隐藏有子任务的父任务默认实心条 */
.gantt_task_line.summary-parent {
    opacity: 0 !important;
    pointer-events: none !important;
}

/* summary-bar layer 容器 */
.summary-bar-host {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    overflow: visible;
    pointer-events: none;
}

/* 贯穿全宽的细横线（连接线） */
.summary-connector {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 2px;
    transform: translateY(-50%);
    background: var(--design-primary, #0EA5E9);
    opacity: 0.45;
    border-radius: 1px;
}

/* 每段实心矩形（对应有子任务覆盖的时间段） */
.summary-segment {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: 12px;
    background: var(--design-primary, #0EA5E9);
    border-radius: 4px;
    opacity: 0.85;
}
```

### Step 3：手动验证（无需单元测试，纯 CSS + class）

启动开发服务器，展开含子任务的父任务，确认：
- 父任务条消失（`opacity:0`）
- 尚未有 summary-bar layer，下一个 Task 会处理

```bash
npm run dev
```

### Step 4：Commit

```bash
git add src/features/gantt/init.js src/styles/pages/gantt.css
git commit -m "feat(gantt): hide default parent task bar for summary-bar layer"
```

---

## Task 4：父任务断续 Summary Bar — 实现 addTaskLayer 渲染

**Files:**
- Create: `src/features/gantt/summary-bar.js`
- Modify: `src/features/gantt/init.js`（import + 调用）
- Create: `tests/unit/gantt/summary-bar.test.js`

### Step 1：写失败测试

```js
// tests/unit/gantt/summary-bar.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('summary-bar renderSummaryBar', () => {
    beforeEach(() => {
        global.gantt = {
            addTaskLayer: vi.fn(),
            hasChild: vi.fn(() => true),
            eachTask: vi.fn((cb, parentId) => {
                // 模拟两个子任务
                cb({ id: 2, start_date: new Date('2026-03-01'), end_date: new Date('2026-03-05') });
                cb({ id: 3, start_date: new Date('2026-03-10'), end_date: new Date('2026-03-15') });
            }),
            getTaskPosition: vi.fn((task, start, end) => ({
                left: start.getDate() * 10,
                width: (end - start) / 86400000 * 10,
                top: 4,
                height: 24,
            })),
        };
    });

    it('initSummaryBar 应调用 gantt.addTaskLayer', async () => {
        const { initSummaryBar } = await import('../../../src/features/gantt/summary-bar.js');
        initSummaryBar();
        expect(global.gantt.addTaskLayer).toHaveBeenCalledOnce();
    });

    it('有子任务的父任务应渲染 summary-connector 和多个 summary-segment', async () => {
        let renderFn;
        global.gantt.addTaskLayer = vi.fn(({ renderer }) => {
            renderFn = renderer.render;
        });

        const { initSummaryBar } = await import('../../../src/features/gantt/summary-bar.js?v=test');
        initSummaryBar();

        const parentTask = {
            id: 1,
            start_date: new Date('2026-03-01'),
            end_date: new Date('2026-03-15'),
        };
        const el = renderFn(parentTask);

        expect(el).not.toBe(false);
        expect(el.querySelector('.summary-connector')).not.toBeNull();
        expect(el.querySelectorAll('.summary-segment').length).toBe(2);
    });

    it('无子任务的任务应 return false', async () => {
        global.gantt.hasChild = vi.fn(() => false);
        let renderFn;
        global.gantt.addTaskLayer = vi.fn(({ renderer }) => {
            renderFn = renderer.render;
        });

        const { initSummaryBar } = await import('../../../src/features/gantt/summary-bar.js?v=noChild');
        initSummaryBar();

        const result = renderFn({ id: 99, start_date: new Date(), end_date: new Date() });
        expect(result).toBe(false);
    });
});
```

### Step 2：运行测试确认失败

```bash
npx vitest run tests/unit/gantt/summary-bar.test.js
```

Expected: FAIL（`summary-bar.js` 不存在）

### Step 3：创建 `src/features/gantt/summary-bar.js`

```js
/**
 * summary-bar.js
 *
 * 父任务断续 Summary Bar 渲染
 * 有子任务处渲染实心矩形段，空白期只显示细横连接线
 * 复用 baseline.js 的 addTaskLayer 模式
 */

/**
 * 初始化 Summary Bar 自定义渲染层
 * 在 gantt.init() 之前调用
 */
export function initSummaryBar() {
    if (typeof gantt === 'undefined' || typeof gantt.addTaskLayer !== 'function') {
        console.warn('[SummaryBar] gantt.addTaskLayer not available');
        return;
    }

    gantt.addTaskLayer({
        renderer: {
            render(task) {
                // 仅处理有子任务的父任务
                if (typeof gantt.hasChild !== 'function' || !gantt.hasChild(task.id)) {
                    return false;
                }

                // 收集直接子任务的时间段
                const segments = [];
                try {
                    gantt.eachTask((child) => {
                        if (child.start_date && child.end_date) {
                            segments.push({
                                start: child.start_date instanceof Date
                                    ? child.start_date
                                    : new Date(child.start_date),
                                end: child.end_date instanceof Date
                                    ? child.end_date
                                    : new Date(child.end_date),
                            });
                        }
                    }, task.id);
                } catch (err) {
                    console.warn('[SummaryBar] Failed to collect child segments:', err);
                    return false;
                }

                if (segments.length === 0) return false;

                // 计算父任务整体位置（用于外层容器尺寸）
                const parentPos = gantt.getTaskPosition(task, task.start_date, task.end_date);
                if (!parentPos || !parentPos.width) return false;

                // 外层容器
                const host = document.createElement('div');
                host.className = 'summary-bar-host';
                host.style.left = parentPos.left + 'px';
                host.style.width = parentPos.width + 'px';
                host.style.top = parentPos.top + 'px';
                host.style.height = parentPos.height + 'px';

                // 连接线（全宽细横线）
                const connector = document.createElement('div');
                connector.className = 'summary-connector';
                host.appendChild(connector);

                // 每个子任务段渲染实心矩形
                segments.forEach((seg) => {
                    try {
                        const segPos = gantt.getTaskPosition(task, seg.start, seg.end);
                        if (!segPos || segPos.width <= 0) return;

                        const segEl = document.createElement('div');
                        segEl.className = 'summary-segment';
                        // 相对于 host 的偏移
                        segEl.style.left = (segPos.left - parentPos.left) + 'px';
                        segEl.style.width = segPos.width + 'px';
                        host.appendChild(segEl);
                    } catch (e) {
                        // 单段计算失败不影响整体渲染
                    }
                });

                return host;
            },

            getRectangle(task) {
                if (typeof gantt.hasChild !== 'function' || !gantt.hasChild(task.id)) {
                    return null;
                }
                try {
                    return gantt.getTaskPosition(task, task.start_date, task.end_date);
                } catch (e) {
                    return null;
                }
            },
        },
    });
}
```

### Step 4：在 `init.js` 中 import 并调用 `initSummaryBar()`

在 `src/features/gantt/init.js` 的 import 区域（约第 25 行 `initBaseline` 那行之后）追加：

```js
import { initSummaryBar } from './summary-bar.js';
```

找到 `init.js` 中调用 `initBaseline()` 的位置，在其**之前**追加（确保 summary-bar layer 先于 baseline layer 注册，baseline 显示在上层）：

```js
initSummaryBar();
initBaseline();
```

### Step 5：运行测试确认通过

```bash
npx vitest run tests/unit/gantt/summary-bar.test.js
```

Expected: PASS（3 个测试全部通过）

### Step 6：Commit

```bash
git add src/features/gantt/summary-bar.js src/features/gantt/init.js tests/unit/gantt/summary-bar.test.js
git commit -m "feat(gantt): add summary-bar layer for parent tasks with gap segments"
```

---

## Task 5：回归验证 + 构建

**Files:** 无改动（仅验证）

### Step 1：运行所有新增测试

```bash
npx vitest run tests/unit/projects/project-modal-create.test.js tests/unit/gantt/task-click-locate.test.js tests/unit/gantt/summary-bar.test.js
```

Expected: 全部 PASS

### Step 2：运行全量单元测试

```bash
npm test -- --run
```

Expected: 无非预期失败（允许已有 skip/todo）

### Step 3：生产构建

```bash
npm run build
```

Expected: 构建成功，无 error

### Step 4：Commit（仅测试产物，如有）

```bash
git add doc/testdoc/ || true
git commit -m "test: verify three-features regression" || true
```

---

## 注意事项

- Task 3/4 的 summary-bar 在 `gantt.init()` 之前注册 `addTaskLayer`（与 `baseline.js` 一致）
- `initSummaryBar()` 必须在 `initBaseline()` 之前调用，确保 baseline 层覆盖在 summary-bar 层之上
- 调试时可在浏览器 devtools 中找 `.summary-bar-host` 元素确认渲染是否触发
- `table` 视图模式下甘特图不显示，summary-bar layer 不会被调用，无需特殊处理
