# 多项目管理 + 链接分享 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为甘特图工具增加多项目管理（单库 project_id 隔离）和无登录链接分享（Cloudflare KV 中转）功能。

**Architecture:** IndexedDB 升级至 version(4)，新增 projects 表，所有数据表加 project_id 字段，通过 projectScope() 工厂函数收拢读写注入点。云端用 Cloudflare Worker（约 80 行）暴露 POST/GET /api/share 接口，KV 存储整个项目 JSON 快照，前端通过 URL 参数 ?share=key 触发导入弹窗。

**Tech Stack:** Dexie 4 (IndexedDB)、Cloudflare Workers + KV、Vanilla JS ES Modules、DaisyUI 5 Modal/Dropdown、Vitest（单元测试）

**设计文档:** `docs/plans/2026-03-09-multi-project-share-design.md`

---

## 实现分阶段概览

- **Phase 1（Task 1-4）**：Storage 层升级，projects CRUD，数据迁移
- **Phase 2（Task 5-6）**：State 层 + 项目切换 UI
- **Phase 3（Task 7-8）**：分享序列化 + Cloudflare Worker
- **Phase 4（Task 9-10）**：分享 Dialog + 接收导入 + URL 参数处理
- **Phase 5（Task 11）**：i18n、收尾、整合测试

---

## Task 1：IndexedDB Schema 升级 + 数据迁移

**Files:**
- Modify: `src/core/storage.js`

### Step 1: 阅读现有 version(3) 结构，确认升级点

阅读 `src/core/storage.js:18-36`，记录所有现有表名和索引。

### Step 2: 在 `db.version(4)` 中重定义所有表

在 `storage.js` 已有 `db.version(3).stores(...)` 之后添加：

```javascript
db.version(4).stores({
    projects:          'id, name, createdAt, updatedAt',
    tasks:             '++id, project_id, priority, status, start_date, parent',
    links:             '++id, project_id, source, target, type',
    history:           '++id, project_id, timestamp, action',
    baselines:         'id, project_id',
    calendar_settings: '++id, project_id',
    calendar_holidays: '[date+countryCode], year, countryCode',
    calendar_custom:   'id, date, project_id',
    person_leaves:     'id, project_id, assignee, startDate, endDate',
    calendar_meta:     '[year+project_id]',
}).upgrade(async tx => {
    const DEFAULT_ID = 'prj_default';
    const now = new Date().toISOString();

    // 1. 新建默认项目记录
    await tx.table('projects').add({
        id: DEFAULT_ID,
        name: '默认项目',
        color: '#4f46e5',
        description: '',
        createdAt: now,
        updatedAt: now,
    });

    // 2. 给已有数据补写 project_id
    await tx.table('tasks').toCollection().modify({ project_id: DEFAULT_ID });
    await tx.table('links').toCollection().modify({ project_id: DEFAULT_ID });
    await tx.table('baselines').toCollection().modify({ project_id: DEFAULT_ID });
    await tx.table('calendar_settings').toCollection().modify({ project_id: DEFAULT_ID });
    await tx.table('calendar_custom').toCollection().modify({ project_id: DEFAULT_ID });
    await tx.table('person_leaves').toCollection().modify({ project_id: DEFAULT_ID });
    await tx.table('history').toCollection().modify({ project_id: DEFAULT_ID });
});
```

### Step 3: 写单元测试（fake-indexeddb）

新建 `tests/unit/storage-migration.test.js`：

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
// 注意：storage.js 使用真实 Dexie，测试需 fake-indexeddb
// tests/setup.js 已配置 fake-indexeddb

describe('Storage migration v4', () => {
    it('should create default project during upgrade', async () => {
        const { db } = await import('../../src/core/storage.js');
        await db.open();
        const projects = await db.projects.toArray();
        expect(projects.length).toBeGreaterThanOrEqual(1);
        expect(projects[0].id).toBe('prj_default');
    });
});
```

### Step 4: 运行测试

```bash
npx vitest run tests/unit/storage-migration.test.js
```

期望: PASS

### Step 5: Commit

```bash
git add src/core/storage.js tests/unit/storage-migration.test.js
git commit -m "feat(storage): upgrade IndexedDB to v4 with project_id isolation and migration"
```

---

## Task 2：projectScope 工厂函数 + 重构现有读写

**Files:**
- Modify: `src/core/storage.js`

### Step 1: 在 storage.js 末尾新增 projectScope 函数

```javascript
/**
 * 返回指定项目的数据读写作用域
 * @param {string} projectId
 * @returns {Object} 包含该项目所有数据表操作方法
 */
export function projectScope(projectId) {
    return {
        // ── Tasks ──────────────────────────────────
        async getTasks() {
            return db.tasks.where('project_id').equals(projectId).toArray();
        },
        async saveTasks(tasks) {
            await db.transaction('rw', db.tasks, async () => {
                await db.tasks.where('project_id').equals(projectId).delete();
                await db.tasks.bulkAdd(tasks.map(t => ({ ...t, project_id: projectId })));
            });
        },

        // ── Links ──────────────────────────────────
        async getLinks() {
            return db.links.where('project_id').equals(projectId).toArray();
        },
        async saveLinks(links) {
            await db.transaction('rw', db.links, async () => {
                await db.links.where('project_id').equals(projectId).delete();
                await db.links.bulkAdd(links.map(l => ({ ...l, project_id: projectId })));
            });
        },

        // ── GanttData（兼容现有 saveGanttData/getGanttData 调用）──
        async getGanttData() {
            const [tasks, links] = await Promise.all([this.getTasks(), this.getLinks()]);
            return { data: tasks, links };
        },
        async saveGanttData(ganttData) {
            const tasks = (ganttData.data || []).map(task => {
                const t = { ...task };
                if (t.start_date instanceof Date) t.start_date = t.start_date.toISOString().split('T')[0];
                if (t.end_date instanceof Date) t.end_date = t.end_date.toISOString().split('T')[0];
                return t;
            });
            await Promise.all([this.saveTasks(tasks), this.saveLinks(ganttData.links || [])]);
        },
        async hasCachedData() {
            const count = await db.tasks.where('project_id').equals(projectId).count();
            return count > 0;
        },

        // ── Baselines ──────────────────────────────
        async getBaseline() {
            const rows = await db.baselines.where('project_id').equals(projectId).toArray();
            return rows.length > 0 ? rows[0] : null;
        },
        async saveBaseline(snapshot) {
            await db.baselines.where('project_id').equals(projectId).delete();
            await db.baselines.add({
                id: `baseline_${projectId}_${new Date().toISOString().slice(0, 10)}`,
                project_id: projectId,
                savedAt: new Date().toISOString(),
                snapshot,
            });
        },
        async hasBaseline() {
            const count = await db.baselines.where('project_id').equals(projectId).count();
            return count > 0;
        },
    };
}
```

### Step 2: 重构现有顶层函数调用 projectScope

将原有 `saveGanttData`、`getGanttData`、`hasCachedData` 标记为 `@deprecated`，内部改为调用 `projectScope('prj_default')` 的对应方法（向后兼容，不删除）：

```javascript
/** @deprecated 请使用 projectScope(projectId).getGanttData() */
export async function getGanttData() {
    return projectScope('prj_default').getGanttData();
}
// saveGanttData / hasCachedData 同理
```

### Step 3: 写单元测试

新建 `tests/unit/project-scope.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { projectScope } from '../../src/core/storage.js';

describe('projectScope', () => {
    it('getTasks returns only tasks for given project', async () => {
        const scope = projectScope('prj_test');
        await scope.saveTasks([{ id: 1, text: 'T1' }]);
        const tasks = await scope.getTasks();
        expect(tasks[0].project_id).toBe('prj_test');
    });

    it('different project scopes are isolated', async () => {
        const a = projectScope('prj_a');
        const b = projectScope('prj_b');
        await a.saveTasks([{ id: 1, text: 'A' }]);
        await b.saveTasks([{ id: 2, text: 'B' }]);
        expect((await a.getTasks()).length).toBe(1);
        expect((await b.getTasks()).length).toBe(1);
        expect((await a.getTasks())[0].text).toBe('A');
    });
});
```

### Step 4: 运行测试

```bash
npx vitest run tests/unit/project-scope.test.js
```

期望: PASS

### Step 5: Commit

```bash
git add src/core/storage.js tests/unit/project-scope.test.js
git commit -m "feat(storage): add projectScope factory for project-isolated data access"
```

---

## Task 3：Projects CRUD 模块

**Files:**
- Create: `src/features/projects/manager.js`

### Step 1: 创建项目管理模块

```javascript
/**
 * 项目管理 CRUD
 * @module src/features/projects/manager.js
 */
import { db } from '../../core/storage.js';

function genProjectId() {
    return 'prj_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 获取所有项目（按创建时间升序）
 * @returns {Promise<Project[]>}
 */
export async function getAllProjects() {
    return db.projects.orderBy('createdAt').toArray();
}

/**
 * 新建项目
 * @param {{ name: string, color?: string, description?: string }} opts
 * @returns {Promise<Project>}
 */
export async function createProject({ name, color = '#4f46e5', description = '' } = {}) {
    const now = new Date().toISOString();
    const project = { id: genProjectId(), name, color, description, createdAt: now, updatedAt: now };
    await db.projects.add(project);
    return project;
}

/**
 * 更新项目元数据
 * @param {string} id
 * @param {{ name?: string, color?: string, description?: string }} updates
 */
export async function updateProject(id, updates) {
    await db.projects.update(id, { ...updates, updatedAt: new Date().toISOString() });
}

/**
 * 删除项目及其所有数据
 * @param {string} id
 */
export async function deleteProject(id) {
    const tables = ['tasks', 'links', 'baselines', 'calendar_settings',
                    'calendar_custom', 'person_leaves', 'history'];
    await db.transaction('rw',
        [db.projects, ...tables.map(t => db[t])],
        async () => {
            for (const t of tables) {
                await db[t].where('project_id').equals(id).delete();
            }
            await db.projects.delete(id);
        }
    );
}

/**
 * 获取项目任务数
 * @param {string} id
 * @returns {Promise<number>}
 */
export async function getProjectTaskCount(id) {
    return db.tasks.where('project_id').equals(id).count();
}
```

### Step 2: 写单元测试

新建 `tests/unit/projects-manager.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { createProject, getAllProjects, updateProject, deleteProject } from '../../src/features/projects/manager.js';

describe('projects manager', () => {
    it('creates a project with id', async () => {
        const p = await createProject({ name: 'Test' });
        expect(p.id).toMatch(/^prj_/);
        expect(p.name).toBe('Test');
    });

    it('getAllProjects returns created projects', async () => {
        await createProject({ name: 'P1' });
        await createProject({ name: 'P2' });
        const all = await getAllProjects();
        expect(all.some(p => p.name === 'P1')).toBe(true);
    });

    it('updateProject changes name', async () => {
        const p = await createProject({ name: 'Old' });
        await updateProject(p.id, { name: 'New' });
        const all = await getAllProjects();
        expect(all.find(x => x.id === p.id).name).toBe('New');
    });

    it('deleteProject removes project', async () => {
        const p = await createProject({ name: 'Del' });
        await deleteProject(p.id);
        const all = await getAllProjects();
        expect(all.find(x => x.id === p.id)).toBeUndefined();
    });
});
```

### Step 3: 运行测试

```bash
npx vitest run tests/unit/projects-manager.test.js
```

### Step 4: Commit

```bash
git add src/features/projects/manager.js tests/unit/projects-manager.test.js
git commit -m "feat(projects): add project CRUD module with cascade delete"
```

---

## Task 4：Store 层集成项目切换

**Files:**
- Modify: `src/core/store.js`

### Step 1: 在 state 中新增项目相关字段

在 `state` 对象里追加（`src/core/store.js:29` 附近）：

```javascript
// 项目管理
currentProjectId: null,  // null 代表尚未初始化
projects: [],            // Project[] 元数据缓存
```

### Step 2: 新增 initProjects 函数

在 store.js 中新增：

```javascript
import { getAllProjects, createProject } from '../features/projects/manager.js';
import { projectScope } from './storage.js';

const DEFAULT_PROJECT_ID_KEY = 'gantt_current_project_id';

/**
 * 初始化项目状态：加载所有项目，设定 currentProjectId
 * 若无项目，创建默认项目
 */
export async function initProjects() {
    let projects = await getAllProjects();
    if (projects.length === 0) {
        const defaultProj = await createProject({ name: '默认项目' });
        projects = [defaultProj];
    }
    state.projects = projects;

    // 从 localStorage 恢复上次选中的项目
    const saved = localStorage.getItem(DEFAULT_PROJECT_ID_KEY);
    const validId = projects.find(p => p.id === saved)?.id;
    state.currentProjectId = validId || projects[0].id;
    localStorage.setItem(DEFAULT_PROJECT_ID_KEY, state.currentProjectId);
}

/**
 * 切换当前项目
 * @param {string} projectId
 */
export async function switchProject(projectId) {
    // 1. 保存当前项目甘特数据
    if (typeof gantt !== 'undefined') {
        const scope = projectScope(state.currentProjectId);
        await scope.saveGanttData(gantt.serialize());
    }

    // 2. 切换
    state.currentProjectId = projectId;
    localStorage.setItem(DEFAULT_PROJECT_ID_KEY, projectId);

    // 3. 触发重新加载事件（由 main.js 监听并调用 gantt.clearAll + gantt.parse）
    document.dispatchEvent(new CustomEvent('projectSwitched', { detail: { projectId } }));
}

/**
 * 刷新项目列表缓存
 */
export async function refreshProjects() {
    state.projects = await getAllProjects();
}
```

### Step 3: 重构 restoreGanttDataFromCache 使用当前项目 scope

```javascript
export async function restoreGanttDataFromCache() {
    try {
        const scope = projectScope(state.currentProjectId);
        const hasData = await scope.hasCachedData();
        if (!hasData) return null;
        const ganttData = await scope.getGanttData();
        return ganttData.data.length > 0 ? ganttData : null;
    } catch (e) {
        console.error('[Store] Failed to restore gantt data:', e);
        return null;
    }
}
```

### Step 4: 写单元测试

新建 `tests/unit/store-projects.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import { state, initProjects, switchProject } from '../../src/core/store.js';

describe('store project management', () => {
    it('initProjects sets currentProjectId', async () => {
        await initProjects();
        expect(state.currentProjectId).toBeTruthy();
    });

    it('switchProject updates currentProjectId', async () => {
        await initProjects();
        const second = state.projects[1] || state.projects[0];
        await switchProject(second.id);
        expect(state.currentProjectId).toBe(second.id);
    });
});
```

### Step 5: 运行测试

```bash
npx vitest run tests/unit/store-projects.test.js
```

### Step 6: Commit

```bash
git add src/core/store.js tests/unit/store-projects.test.js
git commit -m "feat(store): integrate project state, initProjects, switchProject"
```

---

## Task 5：ProjectPicker UI 组件（顶部切换器）

**Files:**
- Create: `src/features/projects/ProjectPicker.js`
- Modify: `index.html`（toolbar 区域加挂载点）

### Step 1: 创建 ProjectPicker.js

```javascript
/**
 * 顶部项目切换下拉组件
 * 使用 DaisyUI 5 dropdown
 */
import { state, switchProject, refreshProjects } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

/**
 * 渲染项目切换器到指定容器
 * @param {HTMLElement} container
 */
export function renderProjectPicker(container) {
    updateProjectPicker(container);

    // 监听项目切换完成事件，刷新 UI
    document.addEventListener('projectSwitched', () => updateProjectPicker(container));
    document.addEventListener('projectsUpdated', () => updateProjectPicker(container));
}

function updateProjectPicker(container) {
    const current = state.projects.find(p => p.id === state.currentProjectId);
    container.innerHTML = `
        <div class="dropdown">
            <div tabindex="0" role="button" class="btn btn-ghost btn-sm gap-1 max-w-48">
                <span class="w-3 h-3 rounded-full flex-shrink-0" 
                      style="background:${current?.color || '#4f46e5'}"></span>
                <span class="truncate font-medium text-sm">${current?.name || i18n.t('project.unnamed')}</span>
                <svg class="w-3 h-3 opacity-60" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>
                </svg>
            </div>
            <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-50 w-56 p-1 shadow-lg border border-base-200">
                ${state.projects.map(p => `
                    <li>
                        <a class="gap-2 ${p.id === state.currentProjectId ? 'active' : ''}"
                           data-project-id="${p.id}">
                            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                  style="background:${p.color}"></span>
                            <span class="truncate">${p.name}</span>
                        </a>
                    </li>
                `).join('')}
                <li><hr class="my-1 border-base-200"></li>
                <li>
                    <a id="project-create-btn" class="gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"/>
                        </svg>
                        ${i18n.t('project.create')}
                    </a>
                </li>
                <li>
                    <a id="project-manage-btn" class="gap-2">
                        <svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"/>
                        </svg>
                        ${i18n.t('project.manage')}
                    </a>
                </li>
            </ul>
        </div>
    `;

    // 事件绑定：切换项目
    container.querySelectorAll('[data-project-id]').forEach(el => {
        el.addEventListener('click', async () => {
            const id = el.dataset.projectId;
            if (id !== state.currentProjectId) {
                await switchProject(id);
            }
            // 关闭下拉
            document.activeElement?.blur();
        });
    });

    // 新建项目
    container.querySelector('#project-create-btn')?.addEventListener('click', async () => {
        document.activeElement?.blur();
        const name = prompt(i18n.t('project.createPrompt') || '请输入项目名称');
        if (!name?.trim()) return;
        const { createProject } = await import('./manager.js');
        const proj = await createProject({ name: name.trim() });
        await refreshProjects();
        document.dispatchEvent(new CustomEvent('projectsUpdated'));
        await switchProject(proj.id);
        showToast(i18n.t('project.created') || `项目"${proj.name}"已创建`, 'success');
    });

    // 管理项目
    container.querySelector('#project-manage-btn')?.addEventListener('click', () => {
        document.activeElement?.blur();
        import('./ProjectModal.js').then(m => m.openProjectModal());
    });
}
```

### Step 2: 在 index.html toolbar 中加挂载点

在 toolbar 区域（`<div id="toolbar">` 或对应容器）靠左位置加入：

```html
<div id="project-picker-mount"></div>
```

位置：logo 图标右侧，现有工具栏按钮左侧。

### Step 3: 在 main.js 初始化时渲染

在 `src/main.js` DOMContentLoaded 回调内，`initProjects()` 调用之后加：

```javascript
import { renderProjectPicker } from './features/projects/ProjectPicker.js';

// 初始化项目
await initProjects();
// 渲染项目切换器
const pickerMount = document.getElementById('project-picker-mount');
if (pickerMount) renderProjectPicker(pickerMount);
```

同时监听 `projectSwitched` 事件，重新加载 gantt：

```javascript
document.addEventListener('projectSwitched', async ({ detail }) => {
    await restoreStateFromCache();     // 恢复该项目的字段配置
    await initGanttWithCache();        // 重新加载甘特数据
    updateGanttColumns();
});
```

### Step 4: Commit

```bash
git add src/features/projects/ProjectPicker.js src/main.js index.html
git commit -m "feat(projects): add ProjectPicker toolbar dropdown with create/switch support"
```

---

## Task 6：ProjectModal（项目管理弹窗）

**Files:**
- Create: `src/features/projects/ProjectModal.js`

### Step 1: 创建管理弹窗

```javascript
/**
 * 项目管理弹窗（DaisyUI modal）
 * 支持重命名、修改颜色、删除
 */
import { state, refreshProjects, switchProject } from '../../core/store.js';
import { updateProject, deleteProject, getProjectTaskCount } from './manager.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

const MODAL_ID = 'project-manage-modal';
const COLORS = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#db2777'];

export function openProjectModal() {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    renderModal(modal);
    modal.showModal();
}

async function renderModal(modal) {
    // 获取所有项目及其任务数
    const counts = await Promise.all(state.projects.map(p => getProjectTaskCount(p.id)));
    const rows = state.projects.map((p, i) => `
        <tr data-id="${p.id}">
            <td>
                <div class="flex items-center gap-2">
                    <div class="color-picker flex gap-1">
                        ${COLORS.map(c => `
                            <span class="w-4 h-4 rounded-full cursor-pointer ring-2 ${c === p.color ? 'ring-offset-1 ring-gray-600' : 'ring-transparent'}"
                                  style="background:${c}" data-color="${c}" data-pid="${p.id}"></span>
                        `).join('')}
                    </div>
                    <input class="input input-sm w-36" value="${p.name}" data-name="${p.id}" />
                </div>
            </td>
            <td class="text-sm text-base-content/60">${counts[i]}</td>
            <td class="text-sm text-base-content/60">${new Date(p.createdAt).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-ghost btn-xs text-error" data-delete="${p.id}"
                        ${state.projects.length <= 1 ? 'disabled' : ''}>
                    ${i18n.t('common.delete') || '删除'}
                </button>
            </td>
        </tr>
    `).join('');

    modal.innerHTML = `
        <div class="modal-box max-w-2xl">
            <h3 class="font-bold text-lg mb-4">${i18n.t('project.manage') || '管理项目'}</h3>
            <table class="table table-sm">
                <thead><tr>
                    <th>${i18n.t('project.name') || '项目名称'}</th>
                    <th>${i18n.t('project.taskCount') || '任务数'}</th>
                    <th>${i18n.t('project.createdAt') || '创建时间'}</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="modal-action">
                <form method="dialog"><button class="btn">${i18n.t('common.close') || '关闭'}</button></form>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    // 颜色选择
    modal.querySelectorAll('[data-color]').forEach(el => {
        el.addEventListener('click', async () => {
            await updateProject(el.dataset.pid, { color: el.dataset.color });
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
            renderModal(modal);
        });
    });

    // 重命名（失焦保存）
    modal.querySelectorAll('[data-name]').forEach(input => {
        input.addEventListener('blur', async () => {
            const name = input.value.trim();
            if (!name) return;
            await updateProject(input.dataset.name, { name });
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
        });
    });

    // 删除
    modal.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.delete;
            const proj = state.projects.find(p => p.id === id);
            const taskCount = await getProjectTaskCount(id);
            if (!confirm(`确认删除项目"${proj?.name}"？该项目包含 ${taskCount} 个任务，删除后无法恢复。`)) return;
            await deleteProject(id);
            await refreshProjects();
            document.dispatchEvent(new CustomEvent('projectsUpdated'));
            // 若删除的是当前项目，切换到第一个项目
            if (id === state.currentProjectId && state.projects.length > 0) {
                await switchProject(state.projects[0].id);
            }
            renderModal(modal);
            showToast(i18n.t('project.deleted') || `项目已删除`, 'success');
        });
    });
}
```

### Step 2: Commit

```bash
git add src/features/projects/ProjectModal.js
git commit -m "feat(projects): add ProjectModal for rename/color/delete management"
```

---

## Task 7：分享序列化与 Share Service

**Files:**
- Create: `src/features/share/shareService.js`

### Step 1: 创建 shareService.js

```javascript
/**
 * 云端分享服务
 * POST /api/share  → 上传项目快照，返回分享 key
 * GET  /api/share/:key → 下载项目快照
 */
import { state } from '../../core/store.js';
import { projectScope, db } from '../../core/storage.js';

// Worker 域名：国际版用 Vercel 边缘函数 URL 或 Cloudflare Worker URL
// 通过 Vite 环境变量注入，dev 时可指向本地 wrangler dev 地址
const SHARE_API_BASE = import.meta.env.VITE_SHARE_API_URL || 'https://gantt-share.your-worker.workers.dev';

/**
 * 将当前项目序列化为 ProjectSnapshot
 * @param {string} projectId
 * @returns {Promise<Object>} ProjectSnapshot
 */
export async function serializeProject(projectId) {
    const project = state.projects.find(p => p.id === projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const scope = projectScope(projectId);
    const [ganttData, baseline] = await Promise.all([
        scope.getGanttData(),
        scope.getBaseline(),
    ]);

    // 日历数据
    const [calSettings, calCustom, calLeaves] = await Promise.all([
        db.calendar_settings.where('project_id').equals(projectId).first(),
        db.calendar_custom.where('project_id').equals(projectId).toArray(),
        db.person_leaves.where('project_id').equals(projectId).toArray(),
    ]);

    return {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        project: {
            name: project.name,
            color: project.color,
            description: project.description,
        },
        tasks: ganttData.data,
        links: ganttData.links,
        customFields: state.customFields,
        fieldOrder: state.fieldOrder,
        systemFieldSettings: state.systemFieldSettings,
        baseline: baseline?.snapshot ?? null,
        calendar: {
            settings: calSettings ?? null,
            customDays: calCustom,
            leaves: calLeaves,
        },
    };
}

/**
 * 上传项目快照到 KV，返回分享 key
 * @param {string} projectId
 * @param {string} [existingKey] - 若提供则覆盖该 key
 * @returns {Promise<{ key: string, url: string, expiresAt: string }>}
 */
export async function uploadShare(projectId, existingKey = '') {
    const snapshot = await serializeProject(projectId);
    const body = JSON.stringify({ key: existingKey || undefined, data: snapshot });

    const res = await fetch(`${SHARE_API_BASE}/api/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Share upload failed: ${res.status} ${err}`);
    }

    return res.json();
}

/**
 * 从 KV 下载项目快照
 * @param {string} key
 * @returns {Promise<Object>} ProjectSnapshot
 */
export async function downloadShare(key) {
    const res = await fetch(`${SHARE_API_BASE}/api/share/${encodeURIComponent(key)}`);
    if (res.status === 404) throw new Error('SHARE_NOT_FOUND');
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return res.json();
}
```

### Step 2: 写单元测试（mock fetch）

新建 `tests/unit/share-service.test.js`：

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('shareService serialization', () => {
    it('serializeProject includes required fields', async () => {
        // mock state + projectScope
        vi.mock('../../src/core/store.js', () => ({
            state: { projects: [{ id: 'p1', name: 'Test', color: '#fff', description: '' }],
                     customFields: [], fieldOrder: [], systemFieldSettings: {} }
        }));
        vi.mock('../../src/core/storage.js', () => ({
            projectScope: () => ({
                getGanttData: async () => ({ data: [], links: [] }),
                getBaseline: async () => null,
            }),
            db: {
                calendar_settings: { where: () => ({ first: async () => null }) },
                calendar_custom: { where: () => ({ toArray: async () => [] }) },
                person_leaves: { where: () => ({ toArray: async () => [] }) },
            }
        }));

        const { serializeProject } = await import('../../src/features/share/shareService.js');
        const snap = await serializeProject('p1');
        expect(snap.schemaVersion).toBe(1);
        expect(snap.project.name).toBe('Test');
        expect(Array.isArray(snap.tasks)).toBe(true);
    });
});
```

### Step 3: 运行测试

```bash
npx vitest run tests/unit/share-service.test.js
```

### Step 4: Commit

```bash
git add src/features/share/shareService.js tests/unit/share-service.test.js
git commit -m "feat(share): add shareService for project snapshot serialization and KV upload/download"
```

---

## Task 8：Cloudflare Worker（云端中转服务）

**Files:**
- Create: `workers/share-worker.js`
- Create: `wrangler.toml`

### Step 1: 创建 workers/share-worker.js

```javascript
/**
 * Cloudflare Worker: 分享数据 KV 中转
 * KV namespace binding: SHARE_KV
 * TTL: 30 days
 */

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function genKey(len = 8) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr).map(b => KEY_CHARS[b % KEY_CHARS.length]).join('');
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const headers = corsHeaders(request.headers.get('Origin'));

        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        // POST /api/share — 上传快照
        if (request.method === 'POST' && url.pathname === '/api/share') {
            try {
                const body = await request.json();
                const key = (body.key && /^[a-z0-9]{4,16}$/.test(body.key))
                    ? body.key
                    : genKey();
                const data = body.data;
                if (!data || !data.tasks) {
                    return new Response('Invalid payload', { status: 400, headers });
                }
                await env.SHARE_KV.put(key, JSON.stringify(data), {
                    expirationTtl: TTL_SECONDS,
                });
                const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
                return Response.json({ key, expiresAt }, { headers });
            } catch (e) {
                return new Response('Server Error: ' + e.message, { status: 500, headers });
            }
        }

        // GET /api/share/:key — 下载快照
        if (request.method === 'GET' && url.pathname.startsWith('/api/share/')) {
            const key = url.pathname.split('/api/share/')[1];
            if (!key) return new Response('Missing key', { status: 400, headers });
            const value = await env.SHARE_KV.get(key);
            if (!value) return new Response('Not found or expired', { status: 404, headers });
            return new Response(value, {
                headers: { ...headers, 'Content-Type': 'application/json' },
            });
        }

        return new Response('Not Found', { status: 404, headers });
    },
};
```

### Step 2: 创建 wrangler.toml

```toml
name = "gantt-share"
main = "workers/share-worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "SHARE_KV"
id = "YOUR_KV_NAMESPACE_ID"        # 替换为真实 KV namespace ID
preview_id = "YOUR_PREVIEW_KV_ID"  # dev 环境 KV namespace ID
```

### Step 3: 本地验证 Worker

```bash
npx wrangler dev workers/share-worker.js
# 期望：启动在 http://localhost:8787
# 手动 curl 测试：
# curl -X POST http://localhost:8787/api/share -H "Content-Type: application/json" \
#   -d '{"data":{"schemaVersion":1,"tasks":[],"links":[]}}'
# 期望返回：{"key":"...","expiresAt":"..."}
```

### Step 4: Commit

```bash
git add workers/share-worker.js wrangler.toml
git commit -m "feat(worker): add Cloudflare Worker for share KV relay (POST/GET /api/share)"
```

---

## Task 9：ShareDialog（分享弹窗）

**Files:**
- Create: `src/features/share/ShareDialog.js`

### Step 1: 创建 ShareDialog.js

```javascript
/**
 * 分享弹窗：生成分享链接
 */
import { uploadShare } from './shareService.js';
import { state } from '../../core/store.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';

const MODAL_ID = 'share-dialog-modal';
const LAST_KEY_STORAGE_PREFIX = 'gantt_share_last_key_';

export function openShareDialog(projectId = state.currentProjectId) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }
    renderShareDialog(modal, projectId);
    modal.showModal();
}

function renderShareDialog(modal, projectId) {
    const project = state.projects.find(p => p.id === projectId);
    const lastKey = localStorage.getItem(LAST_KEY_STORAGE_PREFIX + projectId) || '';

    modal.innerHTML = `
        <div class="modal-box max-w-md">
            <h3 class="font-bold text-lg mb-4">
                ${i18n.t('share.title') || '分享项目'}：${project?.name || ''}
            </h3>
            <div class="form-control mb-4">
                <label class="label">
                    <span class="label-text">${i18n.t('share.keyLabel') || '分享 Key（留空自动生成）'}</span>
                </label>
                <input id="share-key-input" type="text" maxlength="16"
                       class="input input-bordered" placeholder="abc12345"
                       value="${lastKey}" />
                <label class="label">
                    <span class="label-text-alt text-base-content/50">
                        ${i18n.t('share.keyHint') || '填入上次的 Key 可覆盖更新云端数据'}
                    </span>
                </label>
            </div>
            <div id="share-result" class="hidden mb-4">
                <div class="alert alert-success">
                    <div>
                        <p class="text-sm font-medium mb-1">${i18n.t('share.linkGenerated') || '链接已生成（30天有效）'}</p>
                        <div class="flex gap-2 items-center">
                            <input id="share-url-display" type="text" readonly
                                   class="input input-sm flex-1 bg-base-200 text-xs" />
                            <button id="share-copy-btn" class="btn btn-sm btn-ghost">
                                ${i18n.t('share.copy') || '复制'}
                            </button>
                        </div>
                        <p class="text-xs mt-2 opacity-70" id="share-expires-hint"></p>
                    </div>
                </div>
            </div>
            <div class="modal-action">
                <form method="dialog"><button class="btn btn-ghost">${i18n.t('common.cancel') || '取消'}</button></form>
                <button id="share-generate-btn" class="btn btn-primary">
                    ${i18n.t('share.generate') || '生成分享链接'}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    modal.querySelector('#share-generate-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const keyInput = modal.querySelector('#share-key-input');
        const key = keyInput.value.trim();

        btn.disabled = true;
        btn.textContent = i18n.t('share.uploading') || '上传中...';

        try {
            const result = await uploadShare(projectId, key);
            const shareUrl = `${location.origin}${location.pathname}?share=${result.key}`;

            // 保存本次 key 供下次使用
            localStorage.setItem(LAST_KEY_STORAGE_PREFIX + projectId, result.key);

            // 显示结果
            modal.querySelector('#share-result').classList.remove('hidden');
            modal.querySelector('#share-url-display').value = shareUrl;
            modal.querySelector('#share-expires-hint').textContent =
                `${i18n.t('share.expiresAt') || '有效期至'}: ${new Date(result.expiresAt).toLocaleDateString()}`;

            // 复制按钮
            modal.querySelector('#share-copy-btn').addEventListener('click', () => {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    showToast(i18n.t('share.copied') || '链接已复制', 'success');
                });
            });

            btn.textContent = i18n.t('share.regenerate') || '重新生成';
        } catch (e) {
            console.error('[Share] Upload failed:', e);
            showToast(i18n.t('share.uploadFailed') || '上传失败，请检查网络或使用文件导出', 'error');
        } finally {
            btn.disabled = false;
        }
    });
}
```

### Step 2: 在 toolbar 中添加分享按钮

在 `index.html` 工具栏区域增加分享按钮，并在 `main.js` 中绑定事件：

```javascript
// main.js 中
document.getElementById('share-btn')?.addEventListener('click', () => {
    import('./features/share/ShareDialog.js').then(m => m.openShareDialog());
});
```

### Step 3: Commit

```bash
git add src/features/share/ShareDialog.js src/main.js index.html
git commit -m "feat(share): add ShareDialog for generating and copying share links"
```

---

## Task 10：ImportDialog（接收方导入）+ URL 参数处理

**Files:**
- Create: `src/features/share/ImportDialog.js`
- Modify: `src/main.js`

### Step 1: 创建 ImportDialog.js

```javascript
/**
 * 分享链接导入弹窗（接收方）
 */
import { downloadShare } from './shareService.js';
import { state, switchProject, refreshProjects } from '../../core/store.js';
import { projectScope } from '../../core/storage.js';
import { createProject } from '../projects/manager.js';
import { i18n } from '../../utils/i18n.js';
import { showToast } from '../../utils/toast.js';
import { updateGanttColumns } from '../gantt/columns.js';

const MODAL_ID = 'import-share-modal';

/**
 * 检测 URL 中是否有 ?share= 参数，有则自动触发导入弹窗
 */
export async function checkShareParam() {
    const params = new URLSearchParams(location.search);
    const key = params.get('share');
    if (!key) return;

    // 清除 URL 参数，避免刷新重复触发
    const newUrl = location.pathname + location.hash;
    history.replaceState(null, '', newUrl);

    try {
        const snapshot = await downloadShare(key);
        openImportDialog(snapshot);
    } catch (e) {
        if (e.message === 'SHARE_NOT_FOUND') {
            showToast(i18n.t('share.notFound') || '分享链接已过期或不存在', 'warning', 5000);
        } else {
            showToast(i18n.t('share.loadFailed') || '加载分享数据失败', 'error');
        }
    }
}

export function openImportDialog(snapshot) {
    let modal = document.getElementById(MODAL_ID);
    if (!modal) {
        modal = document.createElement('dialog');
        modal.id = MODAL_ID;
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    const { project, tasks, exportedAt } = snapshot;
    const taskCount = tasks?.length || 0;

    modal.innerHTML = `
        <div class="modal-box max-w-md">
            <h3 class="font-bold text-lg mb-2">${i18n.t('share.importTitle') || '检测到分享链接'}</h3>
            <div class="bg-base-200 rounded-lg p-3 mb-4 text-sm">
                <p><span class="font-medium">${i18n.t('project.name') || '项目'}：</span>${project?.name || ''}</p>
                <p><span class="font-medium">${i18n.t('share.taskCount') || '任务数'}：</span>${taskCount}</p>
                <p><span class="font-medium">${i18n.t('share.exportedAt') || '分享时间'}：</span>
                    ${exportedAt ? new Date(exportedAt).toLocaleString() : ''}</p>
            </div>
            <p class="text-sm mb-3">${i18n.t('share.importMode') || '请选择导入方式：'}</p>
            <div class="form-control gap-2">
                <label class="label cursor-pointer justify-start gap-3">
                    <input type="radio" name="import-mode" value="new" class="radio radio-primary" checked />
                    <div>
                        <p class="font-medium">${i18n.t('share.importNew') || '新建项目导入（推荐）'}</p>
                        <p class="text-xs text-base-content/60">${i18n.t('share.importNewHint') || '在本地新建项目，不影响现有数据'}</p>
                    </div>
                </label>
                <label class="label cursor-pointer justify-start gap-3">
                    <input type="radio" name="import-mode" value="replace" class="radio radio-primary" />
                    <div>
                        <p class="font-medium">${i18n.t('share.importReplace') || '覆盖当前项目'}</p>
                        <p class="text-xs text-base-content/60">${i18n.t('share.importReplaceHint') || '替换当前项目数据，无法撤销'}</p>
                    </div>
                </label>
            </div>
            <div class="modal-action">
                <form method="dialog"><button class="btn btn-ghost">${i18n.t('common.cancel') || '取消'}</button></form>
                <button id="import-confirm-btn" class="btn btn-primary">
                    ${i18n.t('share.confirmImport') || '确认导入'}
                </button>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button></button></form>
    `;

    modal.querySelector('#import-confirm-btn').addEventListener('click', async () => {
        const mode = modal.querySelector('input[name="import-mode"]:checked')?.value || 'new';
        modal.close();
        await applySnapshot(snapshot, mode);
    });

    modal.showModal();
}

async function applySnapshot(snapshot, mode) {
    let targetProjectId = state.currentProjectId;

    if (mode === 'new') {
        const proj = await createProject({
            name: snapshot.project?.name || i18n.t('share.importedProject') || '导入的项目',
            color: snapshot.project?.color || '#4f46e5',
        });
        await refreshProjects();
        targetProjectId = proj.id;
    }

    // 写入 gantt 数据
    const scope = projectScope(targetProjectId);
    await scope.saveGanttData({ data: snapshot.tasks || [], links: snapshot.links || [] });

    // 写入字段配置（注意：字段配置目前是全局 localStorage，按项目隔离需后续迭代）
    if (snapshot.customFields) state.customFields = snapshot.customFields;
    if (snapshot.fieldOrder) state.fieldOrder = snapshot.fieldOrder;
    if (snapshot.systemFieldSettings) state.systemFieldSettings = snapshot.systemFieldSettings;

    // 写入基线
    if (snapshot.baseline) {
        await scope.saveBaseline(snapshot.baseline);
    }

    // 切换到目标项目并刷新 UI
    await switchProject(targetProjectId);
    updateGanttColumns();

    showToast(
        i18n.t('share.importSuccess', { count: snapshot.tasks?.length || 0 }) ||
        `导入成功：${snapshot.tasks?.length || 0} 个任务`,
        'success',
        3000
    );
}
```

### Step 2: 在 main.js 中调用 checkShareParam

在 DOMContentLoaded 初始化流程末尾加入（gantt 初始化完成后）：

```javascript
import { checkShareParam } from './features/share/ImportDialog.js';

// 在 gantt 初始化完成后检测分享参数
await initGanttWithCache();
// ... 其他初始化 ...
await checkShareParam();  // 放在最后，确保 gantt 和项目都已就绪
```

### Step 3: Commit

```bash
git add src/features/share/ImportDialog.js src/main.js
git commit -m "feat(share): add ImportDialog and URL ?share= param handling for share reception"
```

---

## Task 11：i18n 补充 + 收尾

**Files:**
- Modify: `src/locales/zh-CN.json`
- Modify: `src/locales/en-US.json`
- Modify: `src/locales/ja-JP.json`
- Modify: `src/locales/ko-KR.json`

### Step 1: 在各语言包中增加 project.* 和 share.* keys

以 `zh-CN.json` 为例，在末尾追加：

```json
"project": {
    "default": "默认项目",
    "unnamed": "未命名项目",
    "create": "新建项目",
    "createPrompt": "请输入项目名称",
    "created": "项目已创建",
    "manage": "管理项目",
    "name": "项目名称",
    "taskCount": "任务数",
    "createdAt": "创建时间",
    "deleted": "项目已删除"
},
"share": {
    "title": "分享项目",
    "keyLabel": "分享 Key（留空自动生成）",
    "keyHint": "填入上次的 Key 可覆盖更新云端数据",
    "generate": "生成分享链接",
    "regenerate": "重新生成",
    "uploading": "上传中...",
    "linkGenerated": "链接已生成（30天有效）",
    "copy": "复制",
    "copied": "链接已复制",
    "expiresAt": "有效期至",
    "uploadFailed": "上传失败，请检查网络或使用文件导出",
    "notFound": "分享链接已过期或不存在，请联系分享人重新分享",
    "loadFailed": "加载分享数据失败",
    "importTitle": "检测到分享链接",
    "taskCount": "任务数",
    "exportedAt": "分享时间",
    "importMode": "请选择导入方式：",
    "importNew": "新建项目导入（推荐）",
    "importNewHint": "在本地新建项目，不影响现有数据",
    "importReplace": "覆盖当前项目",
    "importReplaceHint": "替换当前项目的所有数据，无法撤销",
    "confirmImport": "确认导入",
    "importSuccess": "导入成功：{{count}} 个任务",
    "importedProject": "导入的项目"
}
```

en-US / ja-JP / ko-KR 各自翻译。

### Step 2: 运行完整测试套件

```bash
npm test
```

期望: 所有单元测试 PASS，无新增失败。

### Step 3: 构建验证

```bash
npm run build
```

期望: 无 ERROR，dist/ 输出正常。

### Step 4: 最终 Commit

```bash
git add src/locales/
git commit -m "feat(i18n): add project and share translation keys for all 4 locales"

git add .
git commit -m "chore: final cleanup and build verification for multi-project + share feature"
```

---

## 测试矩阵

| 场景 | 验证方式 |
|------|---------|
| 首次启动：自动创建默认项目 | 单元测试 store-projects.test.js |
| IndexedDB 迁移：旧数据归入默认项目 | 单元测试 storage-migration.test.js |
| 新建项目后切换，任务数据隔离 | 单元测试 project-scope.test.js |
| 删除项目：级联清除所有数据 | 单元测试 projects-manager.test.js |
| 分享序列化：snapshot 字段完整 | 单元测试 share-service.test.js |
| Worker：POST 返回 key；GET 返回数据；过期后 404 | 手动 wrangler dev curl 测试 |
| 接收方：?share=key 触发 ImportDialog | 手动 E2E 测试 |
| 接收方：新建项目导入不影响现有数据 | 手动 E2E 测试 |
| 重新分享：同一 key 覆盖更新 | 手动 E2E 测试 |

---

## 注意事项

1. **字段配置（customFields / fieldOrder）** 当前存 localStorage（全局）。本期实现中，导入分享数据会覆盖全局字段配置——这是有意为之的简化（字段配置与项目绑定的完整实现可作为后续迭代）。
2. **Worker 部署**：需在 Cloudflare 控制台创建 KV namespace，将 ID 填入 `wrangler.toml`，然后 `npx wrangler deploy`。
3. **VITE_SHARE_API_URL**：在 `.env.production` 和 `.env.development.local` 中配置 Worker 地址；开发时可指向 `http://localhost:8787`。
4. **日历数据（holidays）**：`calendar_holidays` 表是全局公共缓存（节假日与项目无关），本期不做 project_id 隔离。
