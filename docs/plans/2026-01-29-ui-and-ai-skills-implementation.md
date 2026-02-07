# UI 统一化 & AI Skills 系统实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变业务逻辑的前提下，统一全站弹窗/面板/工具栏视觉规范（Block A），并实现 AI Skills 系统让聊天框支持工具调用（Block B）。

**Architecture:** Block A 重构 UI 组件为统一设计系统（Confirm Dialog / Side Drawer / Modal Card / Header / Toolbar），Block B 新增 skills + tools + router + executor 层，在 client.js 新增 runSmartChat 入口。两个 Block 的纯逻辑部分可并行，UI 部分需 Block A 先行。

**Tech Stack:** Vite, Tailwind CSS 4 + DaisyUI, Vanilla JS (ES6 modules), DHTMLX Gantt, AI SDK 6, Zod

**Design File:** `doc/design/pencil-new.pen`

**Design System Variables:**
| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#F7F8FA` | 页面底色 |
| `--surface` | `#F8FAFC` | 面板/Header 底色 |
| `--card` | `#FFFFFF` | 卡片/弹窗底色 |
| `--foreground` | `#0F172A` | 主文字色 |
| `--muted-foreground` | `#64748B` | 次要文字色 |
| `--primary` | `#0EA5E9` | 主色（蓝青） |
| `--primary-hover` | `#0284C7` | 主色 hover |
| `--primary-soft` | `#E0F2FE` | 主色浅底 |
| `--danger` | `#DC2626` | 危险色 |
| `--danger-soft` | `#FEE2E2` | 危险浅底 |
| `--border` | `#E2E8F0` | 边框色 |
| `--secondary` | `#F1F5F9` | 次要背景 |
| `--radius-m` | `12px` | 主容器圆角 |
| `--radius-pill` | `999px` | 按钮 pill 圆角 |
| `--shadow` | `0 12px 40px rgba(15,23,42,0.18)` | 弹窗阴影 |

---

## 依赖关系图

```
Batch 1 (并行)          Batch 2 (并行)         Batch 3 (并行)        Batch 4 (并行)       Batch 5
┌──────────────┐       ┌──────────────┐       ┌─────────────┐       ┌─────────────┐     ┌──────────┐
│ 1A: CSS 变量  │──────→│ 2A: Confirm  │──────→│ 3A: Field   │       │ 4A: Tool UI │     │ 5: 收尾   │
│ + Header +   │       │ Dialog 统一   │       │ Mgmt Drawer │       │ in AiDrawer │     │ + 测试    │
│ Toolbar 组件  │       │              │       │ 统一        │       │             │     │          │
├──────────────┤       ├──────────────┤       ├─────────────┤       ├─────────────┤     │          │
│ 1B: View     │──────→│ 2B: Modal    │──────→│ 3B: Gantt   │       │ 4B: Drawer  │     │          │
│ Toggle +     │       │ Card 统一     │       │ 视觉增强    │       │ 样式优化    │     │          │
│ viewMode     │       │              │       │             │       │             │     │          │
├──────────────┤       ├──────────────┤       └─────────────┘       └─────────────┘     │          │
│ 1C: AI Tools │──────→│ 2C: Skills   │──────────────────────────────→│             │     │          │
│ + Registry   │       │ Registry +   │                               └─────────────┘     └──────────┘
│ (纯逻辑)     │       │ Router       │
└──────────────┘       └──────────────┘
```

---

## Batch 1: 基础设施（3 个并行任务）

### Task 1A: CSS 变量 + Header 组件 + Toolbar 组件

> **可并行**: 是（独立，不依赖其他 Task）
> **改动范围**: `src/styles/main.css`, `index.html`（Header/Toolbar 区域）

**Files:**
- Modify: `src/styles/main.css` (添加 CSS 自定义属性)
- Modify: `index.html:1-30` (Header 区域)

**Step 1: 在 main.css 中添加设计系统 CSS 变量**

在 `@theme` 块中添加（如已有则覆盖）：

```css
@theme {
  /* Design System Tokens */
  --color-background: #F7F8FA;
  --color-surface: #F8FAFC;
  --color-surface-2: #EEF2F6;
  --color-card: #FFFFFF;
  --color-foreground: #0F172A;
  --color-muted-foreground: #64748B;
  --color-border: #E2E8F0;
  --color-secondary: #F1F5F9;
  --color-primary: #0EA5E9;
  --color-primary-hover: #0284C7;
  --color-primary-soft: #E0F2FE;
  --color-primary-strong: #0369A1;
  --color-danger: #DC2626;
  --color-danger-soft: #FEE2E2;
  --color-danger-foreground: #FFFFFF;
  --radius-m: 12px;
  --radius-pill: 999px;
  --shadow-modal: 0 12px 40px rgba(15, 23, 42, 0.18);
  --backdrop-color: #0F172A4D;
}
```

**Step 2: 更新 index.html body 背景色**

将 `<body>` 的 class 更新，确保使用 `bg-[--color-background]`。

**Step 3: 重构 Header 区域**

参照设计稿 `WHHy1`（Component / Task Header）：
- 底色: `--surface` (`#F8FAFC`)
- 高度: 64px
- 右侧: View Segmented（见 Task 1B）+ "字段管理" 按钮
- 底部: 1px `--border` 分割线
- 无渐变

当前 Header 在 `index.html` 的 `<header>` 标签中。需要：
- 移除原有渐变背景
- 改为 `bg-[--color-surface]` 浅底
- 底部加 `border-b border-[--color-border]`
- Logo/标题区精简

**Step 4: 重构 Toolbar 区域**

参照设计稿 `RL1hq`（Component / Task Toolbar）：
- 布局: flex, justify-between, items-center
- 底色: `--surface` + `--radius-m` 圆角
- 高度: 56px, padding: 10px 16px
- 左侧: 搜索框（pill 圆角，`--card` 底色，宽度自适应）
- 右侧: 今天(Primary pill) | 分隔线 | 编辑(icon) | 导出(icon) | 更多(text+chevron) | 新建任务(Primary pill)

当前 Toolbar 散布在 `<header>` 中。需要：
- 将 Toolbar 功能按钮从 header 提出，放入独立 `#task-toolbar` div
- 放置在 Header 下方、内容区上方
- 按设计稿重排按钮顺序和样式

**Step 5: 验证**

- 打开页面，Header 应为浅灰底 + 底部细线，无渐变
- Toolbar 为独立行，搜索框左侧，按钮右侧
- 所有 CSS 变量可在 DevTools 中查看

**Step 6: Commit**

```bash
git add src/styles/main.css index.html
git commit -m "feat(ui): add design system CSS tokens, refactor Header and Toolbar layout"
```

---

### Task 1B: 视图切换 Segmented Control + viewMode 状态

> **可并行**: 是（独立，不依赖其他 Task）
> **改动范围**: `src/core/store.js`, `src/core/storage.js`, `index.html`, 新建 `src/features/gantt/view-toggle.js`

**Files:**
- Modify: `src/core/store.js:26-53` (添加 viewMode 状态)
- Modify: `src/core/storage.js` (添加 viewMode 持久化)
- Create: `src/features/gantt/view-toggle.js`
- Modify: `index.html` (添加 Segmented Control HTML)

**Step 1: 在 store.js 添加 viewMode 状态**

```js
// store.js - state 对象中添加:
viewMode: 'split', // 'split' | 'table' | 'gantt'
```

添加函数：

```js
export function getViewMode() {
  return state.viewMode;
}

export function setViewMode(mode) {
  if (!['split', 'table', 'gantt'].includes(mode)) return;
  state.viewMode = mode;
  persistViewMode(mode);
}
```

**Step 2: 在 storage.js 添加 viewMode 持久化**

```js
export async function saveViewMode(mode) {
  await db.config.put({ key: 'viewMode', value: mode });
}

export async function getViewModeFromCache() {
  const record = await db.config.get('viewMode');
  return record?.value || 'split';
}
```

**Step 3: 在 index.html Header 区域添加 Segmented Control**

参照设计稿 `vOyS1`（View Segmented）：

```html
<div id="view-segmented" class="flex items-center gap-1 rounded-full bg-[--color-secondary] p-1">
  <button data-view="split" class="view-seg-btn active">分屏</button>
  <button data-view="table" class="view-seg-btn">表格</button>
  <button data-view="gantt" class="view-seg-btn">甘特</button>
</div>
```

CSS（在 main.css 中）：

```css
.view-seg-btn {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted-foreground);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.view-seg-btn.active {
  background: var(--color-card);
  color: var(--color-foreground);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
```

**Step 4: 创建 view-toggle.js**

```js
// src/features/gantt/view-toggle.js
import { getViewMode, setViewMode } from '../../core/store.js';

export function initViewToggle() {
  const segmented = document.getElementById('view-segmented');
  if (!segmented) return;

  segmented.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    const mode = btn.dataset.view;
    setViewMode(mode);
    updateViewToggleUI(mode);
    applyViewMode(mode);
  });
}

export function updateViewToggleUI(mode) {
  document.querySelectorAll('.view-seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
}

export function applyViewMode(mode) {
  const ganttContainer = document.getElementById('gantt_here');
  // 通过 CSS class 控制 grid/timeline 的显隐
  ganttContainer?.setAttribute('data-view-mode', mode);

  if (mode === 'split') {
    gantt.config.show_grid = true;
    gantt.config.show_chart = true;
  } else if (mode === 'table') {
    gantt.config.show_grid = true;
    gantt.config.show_chart = false;
  } else if (mode === 'gantt') {
    gantt.config.show_grid = true; // 保留简化版
    gantt.config.show_chart = true;
    // 后续 Task 3B 会处理 grid 列简化
  }
  gantt.render();
}
```

**Step 5: 在 main.js 中初始化**

```js
import { initViewToggle } from './features/gantt/view-toggle.js';
// 在 initGantt() 之后调用
initViewToggle();
```

**Step 6: 在 init.js 中从缓存恢复 viewMode**

在 `restoreStateFromCache()` 中添加 viewMode 恢复逻辑。

**Step 7: 验证**

- 点击"分屏"：左表格 + 右甘特（默认）
- 点击"表格"：只显示表格，甘特图隐藏
- 点击"甘特"：只显示甘特图
- 刷新后保持上次选择

**Step 8: Commit**

```bash
git add src/core/store.js src/core/storage.js src/features/gantt/view-toggle.js index.html src/main.js
git commit -m "feat(gantt): add view mode toggle (split/table/gantt) with persistence"
```

---

### Task 1C: AI Tools 定义 + Tool Registry（纯逻辑，无 UI）

> **可并行**: 是（独立，不影响 UI 层）
> **改动范围**: 全部新建文件

**Files:**
- Create: `src/features/ai/tools/taskTools.js`
- Create: `src/features/ai/tools/registry.js`

**Step 1: 安装 zod 依赖**

```bash
npm install zod
```

**Step 2: 创建 taskTools.js**

按设计文档 Section 5.1 完整实现 5 个工具：
- `get_today_tasks` — 获取今日待处理任务
- `get_tasks_by_status` — 按状态筛选
- `get_overdue_tasks` — 获取逾期任务
- `get_tasks_by_priority` — 按优先级筛选
- `get_progress_summary` — 项目整体进度概览

实现代码直接参照 `docs/plans/2026-01-28-ai-skills-system-design.md` Section 5.1 的完整代码。

**Step 3: 创建 tools/registry.js**

```js
import { taskTools } from './taskTools.js';

const allTools = {
  ...taskTools
};

export function getToolsForSkill(allowedTools) {
  if (!allowedTools || allowedTools.length === 0) return {};
  const tools = {};
  for (const name of allowedTools) {
    if (allTools[name]) tools[name] = allTools[name];
  }
  return tools;
}

export { allTools };
```

**Step 4: 验证**

- 确认 `import { tool } from 'ai'` 和 `import { z } from 'zod'` 正常导入
- 在浏览器控制台手动调用 `taskTools.get_today_tasks.execute({})` 验证返回数据结构

**Step 5: Commit**

```bash
git add src/features/ai/tools/
git commit -m "feat(ai): add task query tools with Zod schemas"
```

---

## Batch 2: 组件统一 + Skills 骨架（3 个并行任务）

> **前置**: Batch 1 全部完成

### Task 2A: 确认弹窗统一为 Confirm Dialog

> **前置**: Task 1A（CSS 变量就绪）
> **改动范围**: `index.html`, `src/features/task-details/panel.js`, `src/features/ai/components/AiDrawer.js`

**Files:**
- Create: `src/components/common/confirm-dialog.js`
- Modify: `index.html:1049-1074` (替换 delete-confirm-modal)
- Modify: `src/features/task-details/panel.js:304-380` (替换自定义删除弹窗)
- Modify: `src/features/ai/components/AiDrawer.js:158-171` (替换清空确认弹窗)

**Step 1: 创建通用 confirm-dialog.js**

参照设计稿 `W54fm`（Component / Confirm Dialog）：

```js
// src/components/common/confirm-dialog.js

/**
 * 通用确认弹窗
 *
 * 设计稿: pencil-new.pen → W54fm
 * 结构: Body(icon + title + message) + Footer(cancel + confirm)
 * 底色: --card, 圆角: --radius-m
 * 遮罩: --backdrop-color (#0F172A4D)
 */
export function showConfirmDialog({
  icon = 'trash-2',       // lucide icon name
  iconColor = 'danger',   // 'danger' | 'primary' | 'warning'
  title = '确认操作？',
  message = '',
  confirmText = '确认',
  cancelText = '取消',
  confirmStyle = 'danger', // 'danger' | 'primary'
  onConfirm = () => {},
  onCancel = () => {}
}) {
  // 移除已存在的弹窗
  closeConfirmDialog();

  const backdrop = document.createElement('div');
  backdrop.id = 'confirm-dialog-backdrop';
  backdrop.className = 'fixed inset-0 z-[7000] flex items-center justify-center';
  backdrop.style.background = 'var(--backdrop-color, #0F172A4D)';

  const colorMap = {
    danger: { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)' },
    primary: { bg: 'var(--color-primary-soft)', fg: 'var(--color-primary)' },
    warning: { bg: '#FEF3C7', fg: '#D97706' }
  };
  const colors = colorMap[iconColor] || colorMap.danger;
  const btnBg = confirmStyle === 'danger' ? 'var(--color-danger)' : 'var(--color-primary)';

  backdrop.innerHTML = `
    <div class="confirm-dialog-card" style="
      background: var(--color-card);
      border-radius: var(--radius-m);
      width: 420px;
      max-width: 90vw;
      box-shadow: var(--shadow-modal);
      overflow: hidden;
      transform: scale(0.95);
      opacity: 0;
      transition: all 0.2s ease;
    ">
      <div style="padding: 16px; display: flex; flex-direction: column; gap: 10px;">
        <div style="
          width: 44px; height: 44px; border-radius: 22px;
          background: ${colors.bg};
          display: flex; align-items: center; justify-content: center;
        ">
          <svg style="width:20px;height:20px;color:${colors.fg}" class="lucide-icon" data-icon="${icon}"></svg>
        </div>
        <div style="font-size:16px; font-weight:600; color:var(--color-foreground)">${title}</div>
        <div style="font-size:13px; color:var(--color-muted-foreground)">${message}</div>
      </div>
      <div style="
        display:flex; align-items:center; justify-content:flex-end;
        gap:10px; padding:12px 16px;
        background: var(--color-surface);
      ">
        <button id="confirm-dialog-cancel" style="
          padding:8px 12px; border-radius:var(--radius-pill);
          font-size:13px; font-weight:600;
          color:var(--color-foreground); background:transparent; cursor:pointer;
        ">${cancelText}</button>
        <button id="confirm-dialog-ok" style="
          padding:8px 14px; border-radius:var(--radius-pill);
          font-size:13px; font-weight:600;
          color:#FFF; background:${btnBg}; cursor:pointer;
        ">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  // 入场动画
  requestAnimationFrame(() => {
    const card = backdrop.querySelector('.confirm-dialog-card');
    card.style.transform = 'scale(1)';
    card.style.opacity = '1';
  });

  // 事件绑定
  backdrop.querySelector('#confirm-dialog-cancel').onclick = () => { closeConfirmDialog(); onCancel(); };
  backdrop.querySelector('#confirm-dialog-ok').onclick = () => { closeConfirmDialog(); onConfirm(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { closeConfirmDialog(); onCancel(); } });

  // ESC 关闭
  const escHandler = (e) => { if (e.key === 'Escape') { closeConfirmDialog(); onCancel(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}

export function closeConfirmDialog() {
  const existing = document.getElementById('confirm-dialog-backdrop');
  if (existing) {
    const card = existing.querySelector('.confirm-dialog-card');
    if (card) { card.style.transform = 'scale(0.95)'; card.style.opacity = '0'; }
    setTimeout(() => existing.remove(), 200);
  }
}
```

> **注意**: Lucide icon 的 SVG 插入逻辑需要对接项目中现有的 icon 方案。如果项目使用 inline SVG，则直接在模板中内联 `<svg>` 路径。

**Step 2: 替换 panel.js 中的自定义删除弹窗**

- 移除 `showDeleteConfirmModal()` 函数（Lines 304-380）
- 改为调用 `showConfirmDialog({ icon:'trash-2', iconColor:'danger', title:'确认删除？', message:'删除后无法撤销...', confirmText:'删除', confirmStyle:'danger', onConfirm: () => { /* 原删除逻辑 */ } })`

**Step 3: 替换 AiDrawer.js 中的清空确认弹窗**

- 移除 `#ai_clear_confirm_modal` 的 `<dialog>` HTML（Lines 158-171）
- 改为调用 `showConfirmDialog({ icon:'trash-2', title:'清空对话', message:'确定要清空所有对话记录吗？此操作无法撤销。', confirmText:'清空', confirmStyle:'danger', onConfirm: clearConversation })`

**Step 4: 替换 index.html 中的 delete-confirm-modal**

- 移除 `<dialog id="delete-confirm-modal">` (Lines 1049-1074)
- 在 `customFields/manager.js` 中删除字段时改用 `showConfirmDialog()`

**Step 5: 验证**

- 在任务详情面板中点击删除 → 弹出统一样式 Confirm Dialog
- 在 AI Drawer 中点击清空 → 弹出统一样式 Confirm Dialog
- 在字段管理中删除字段 → 弹出统一样式 Confirm Dialog
- 三者视觉一致：`--card` 底色、`--radius-m` 圆角、icon+title+message 布局

**Step 6: Commit**

```bash
git add src/components/common/confirm-dialog.js src/features/task-details/panel.js src/features/ai/components/AiDrawer.js src/features/customFields/manager.js index.html
git commit -m "feat(ui): unify all confirm dialogs to design system component"
```

---

### Task 2B: Modal Card 统一（字段配置弹窗 + AI 配置弹窗）

> **前置**: Task 1A（CSS 变量就绪）
> **改动范围**: `index.html`, `src/features/customFields/manager.js`, `src/features/ai/components/AiConfigModal.js`

**Files:**
- Modify: `index.html:845-1047` (field-config-modal 重写)
- Modify: `src/features/customFields/manager.js` (open/close 逻辑适配)
- Modify: `src/features/ai/components/AiConfigModal.js` (样式统一)

**Step 1: 重写 field-config-modal HTML**

参照设计稿 `ULqPO`（Component / Modal Card）：

结构：
```
Modal Card (520px, rounded-12, white, 1px border)
├── Header (64px, --surface 底色, padding 16-20)
│   ├── Left: icon + title + subtitle
│   └── Right: close icon button (32x32)
├── Body (white, gap 16, padding 16, scrollable)
│   └── Form fields...
└── Footer (--surface 底色, padding 14-20)
    ├── Left: "Esc 关闭" hint
    └── Right: Cancel(ghost) + Save(primary, pill)
```

关键样式改动：
- **移除**: `bg-gradient-to-r from-primary to-accent` 渐变 header
- **替换为**: `bg-[--color-surface]` 浅灰底
- **移除**: blur 遮罩
- **替换为**: `background: var(--backdrop-color)` 统一遮罩
- **按钮**: 统一为 pill 圆角

**Step 2: 适配 manager.js 的 open/close**

保持 `openAddFieldModal()` / `editField()` 的业务逻辑不变，仅更新 DOM 选择器和动画类名。

**Step 3: 统一 AiConfigModal.js 样式**

- 将 AI 设置弹窗也改为 Modal Card 结构
- Header: icon + "AI 设置" + subtitle
- Body: API Key / Base URL / Model 表单
- Footer: 取消 + 保存

**Step 4: 验证**

- 点击"字段管理" → "新增字段" → 弹出统一 Modal Card
- 点击 AI 设置 → 弹出统一 Modal Card
- 两者 Header 均为浅灰底、无渐变，按钮为 pill 圆角

**Step 5: Commit**

```bash
git add index.html src/features/customFields/manager.js src/features/ai/components/AiConfigModal.js
git commit -m "feat(ui): unify field config and AI config modals to Modal Card design"
```

---

### Task 2C: Skills Registry + Router（纯逻辑）

> **前置**: Task 1C（Tools 就绪）
> **改动范围**: 全部新建文件

**Files:**
- Create: `src/features/ai/skills/task-query/SKILL.md`
- Create: `src/features/ai/skills/registry.js`
- Create: `src/features/ai/agent/router.js`
- Create: `src/features/ai/prompts/routerPrompt.js`

**Step 1: 创建 task-query SKILL.md**

按设计文档 Section 4.3 的完整内容创建。

**Step 2: 创建 skills/registry.js**

```js
// src/features/ai/skills/registry.js

const skillModules = {
  'task-query': () => import('./task-query/SKILL.md?raw')
};

const skillDescriptions = [
  { name: 'task-query', description: '查询任务数据，包括今日任务、逾期任务、按状态/优先级筛选', allowedTools: ['get_today_tasks', 'get_tasks_by_status', 'get_overdue_tasks', 'get_tasks_by_priority'] }
];

export function getSkillDescriptions() {
  return skillDescriptions;
}

export async function loadSkill(skillId) {
  const desc = skillDescriptions.find(s => s.name === skillId);
  if (!desc) return null;

  const loader = skillModules[skillId];
  if (!loader) return null;

  const mod = await loader();
  return {
    ...desc,
    content: mod.default || mod
  };
}
```

**Step 3: 创建 agent/router.js**

按设计文档 Section 6.1 + 6.2 实现：
- `quickRoute(message)` — 关键词快速匹配
- `routeToSkill(message, openai, model)` — AI 路由 fallback
- `routeWithCache(message, openai, model)` — 带缓存的统一入口

**Step 4: 创建 prompts/routerPrompt.js**

```js
export function buildRouterPrompt(skills) {
  return `你是一个意图路由器。根据用户消息判断应该使用哪个 Skill。

可用 Skills:
${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}

规则:
1. 如果用户问题明确匹配某个 Skill，返回该 Skill ID
2. 如果是通用对话（闲聊、问候等），返回 null
3. 如果不确定，返回置信度较低的最佳匹配`;
}
```

**Step 5: 验证**

- `quickRoute('今天有什么任务')` 返回 `{ skill: 'task-query', method: 'keyword' }`
- `quickRoute('你好')` 返回 `null`
- `loadSkill('task-query')` 返回包含 SKILL.md 内容的对象

**Step 6: Commit**

```bash
git add src/features/ai/skills/ src/features/ai/agent/ src/features/ai/prompts/
git commit -m "feat(ai): add skill registry, router with keyword matching and AI fallback"
```

---

## Batch 3: 面板统一 + 甘特增强（2 个并行任务）

> **前置**: Batch 2 全部完成

### Task 3A: 字段管理面板统一为 Side Drawer

> **前置**: Task 2A, 2B
> **改动范围**: `index.html`, `src/features/customFields/manager.js`

**Files:**
- Modify: `index.html:797-843` (field-management-panel 重写)
- Modify: `src/features/customFields/manager.js:58-109` (open/close 适配)

**Step 1: 重写 field-management-panel HTML**

参照设计稿 `qOffL`（Component / Side Drawer）：

结构：
```
Side Drawer (440px, right-side, --card 底色, --radius-m 圆角)
├── Header (80px, --surface 底色, padding 16)
│   ├── Left: icon + "字段管理" title + "拖拽排序，点击编辑" subtitle
│   └── Right: 2 icon buttons (32x32, --card 底色, rounded-10)
├── Body (scrollable, --surface 底色, gap 16, padding 16)
│   ├── Search input (pill, --card 底色, border)
│   └── Field list (vertical, gap 8)
│       └── Each item: 64px, --card 底色, rounded-12, padding 12
└── Footer (--surface 底色, padding 16, center)
    └── "新增字段" button (Primary, full-width, pill)
```

关键改动：
- **移除**: `bg-gradient-to-r from-primary to-accent` 渐变 header
- **替换为**: `bg-[--color-surface]` 浅灰底
- **移除**: white/20 backdrop-blur icon 容器
- **替换为**: 清晰的 icon + text 标题
- 字段列表项样式统一：圆角 12、白底、间距 8

**Step 2: 更新 z-index 管理**

Side Drawer z-index 统一为 6100（与当前 AI Drawer 对齐），遮罩为 6050。

**Step 3: 更新字段列表项样式**

- 系统字段: 只读标签（tag），不显示开关/编辑/删除
- 自定义字段: 显隐开关 + 编辑/删除入口
- 标签区分: "系统"/"自定义" + 字段类型（如"文本"、"单选"）

**Step 4: 验证**

- 点击"字段管理" → 右侧滑出统一 Side Drawer
- Header 无渐变，浅灰底
- 字段列表项圆角一致
- Footer "新增字段" 按钮为 Primary pill

**Step 5: Commit**

```bash
git add index.html src/features/customFields/manager.js
git commit -m "feat(ui): unify field management panel to Side Drawer design"
```

---

### Task 3B: 甘特视觉增强

> **前置**: Task 1B（viewMode 基础就绪）
> **改动范围**: `src/features/gantt/templates.js`, `src/styles/pages/gantt.css`, `src/features/gantt/init.js`

**Files:**
- Modify: `src/features/gantt/templates.js` (任务条模板)
- Modify: `src/styles/pages/gantt.css` (甘特样式)
- Modify: `src/features/gantt/init.js` (Today 线配置)

**Step 1: 行底色斑马纹**

```css
/* gantt.css */
.gantt_row:nth-child(even) {
  background-color: var(--color-surface, #F8FAFC);
}
.gantt_row:nth-child(odd) {
  background-color: var(--color-card, #FFFFFF);
}
```

**Step 2: Today 指示线增强**

在 `init.js` 的 markers 配置中：
- 确保 Today marker 使用 `--primary` 色
- 添加 "今天" 文字小标

**Step 3: 任务条进度填充**

在 `templates.js` 中修改 task bar 模板：
- 底层: `--primary-soft` (#E0F2FE)
- 上层（进度部分）: `--primary` (#0EA5E9)
- 圆角: 6px

**Step 4: 里程碑菱形**

为 `type === 'milestone'` 的任务添加菱形样式（通过 CSS transform rotate(45deg)）。

**Step 5: Gantt Only 模式列简化**

当 `viewMode === 'gantt'` 时，grid 只保留 "任务名" 列（简化版），隐藏其他字段列。

**Step 6: 验证**

- 甘特图行背景交替浅灰/白
- Today 红线可见，带 "今天" 标签
- 任务条显示两层进度填充
- 切换到 "甘特" 模式，左侧仅显示任务名列

**Step 7: Commit**

```bash
git add src/features/gantt/templates.js src/styles/pages/gantt.css src/features/gantt/init.js
git commit -m "feat(gantt): add zebra stripes, today line, progress fill, milestone diamond"
```

---

## Batch 4: AI UI 集成 + Drawer 优化（2 个并行任务）

> **前置**: Task 2C (Skills/Router), Task 3A (Side Drawer 统一完成)

### Task 4A: Executor + runSmartChat + AiDrawer 工具调用 UI

> **前置**: Task 2C
> **改动范围**: `src/features/ai/agent/executor.js`, `src/features/ai/api/client.js`, `src/features/ai/services/aiService.js`, `src/features/ai/components/AiDrawer.js`, `src/features/ai/styles/ai-theme.css`

**Files:**
- Create: `src/features/ai/agent/executor.js`
- Modify: `src/features/ai/api/client.js` (新增 runSmartChat)
- Modify: `src/features/ai/services/aiService.js` (chat agent 切换到 runSmartChat)
- Modify: `src/features/ai/components/AiDrawer.js` (工具调用 UI)
- Modify: `src/features/ai/styles/ai-theme.css` (工具调用样式)

**Step 1: 创建 executor.js**

按设计文档 Section 6.3 完整实现：
- `executeSkill(skillId, messages, openai, model, callbacks)`
- `executeGeneralChat(messages, openai, model, callbacks)`

**Step 2: 在 client.js 新增 runSmartChat**

按设计文档 Section 8.1 完整实现：
- 路由优先级：quickRoute → AI route → general chat
- callbacks: onChunk, onFinish, onError, onToolCall, onToolResult, onSkillStart

**Step 3: 在 aiService.js 中 chat agent 切换到 runSmartChat**

找到 chat agent 的调用入口，将 `runAgentStream` 替换为 `runSmartChat`。保留 `task_refiner` 和 `wbs_breakdown` 继续使用 `runAgentStream`。

**Step 4: AiDrawer 工具调用 UI**

按设计文档 Section 9.1 在 AiDrawer 中新增：
- `showToolCall(toolCall)` — 可折叠的 `<details>` 展示工具调用
- `showToolResult(toolResult, statusEl)` — 更新工具执行结果
- `_getToolDisplayName(name)` — 中文工具名映射

**Step 5: 工具调用 CSS**

按设计文档 Section 9.2 在 `ai-theme.css` 中添加 `.ai-tool-call` 相关样式。

**Step 6: 端到端验证**

- 打开 AI Drawer
- 输入 "今天有什么任务"
- 应看到：工具调用状态（可折叠）→ 返回结果 → AI 用 Markdown 表格展示
- 输入 "你好" → 直接通用对话回复，无工具调用

**Step 7: Commit**

```bash
git add src/features/ai/agent/executor.js src/features/ai/api/client.js src/features/ai/services/aiService.js src/features/ai/components/AiDrawer.js src/features/ai/styles/ai-theme.css
git commit -m "feat(ai): implement skill executor, runSmartChat, tool call UI in drawer"
```

---

### Task 4B: AiDrawer 样式优化

> **前置**: Task 3A（Side Drawer 统一完成后，对齐视觉风格）
> **改动范围**: `src/features/ai/components/AiDrawer.js`, `src/features/ai/styles/ai-theme.css`

**Files:**
- Modify: `src/features/ai/components/AiDrawer.js` (Header/Footer 样式)
- Modify: `src/features/ai/styles/ai-theme.css` (气泡、输入框样式)

**Step 1: AiDrawer Header 统一**

- 底色: `--surface` (#F8FAFC)，非 backdrop-blur
- 高度: 与 Side Drawer 一致（~80px 或 64px）
- 标题 + icon buttons 布局对齐
- 移除 `bg-base-100/80 backdrop-blur`，改为 `bg-[--color-surface]`

**Step 2: AiDrawer Footer 统一**

- 底色: `--surface`
- 输入框: `--card` 底色, `--border` 边框, `--radius-m` 圆角
- 发送按钮: `--primary` + pill 圆角

**Step 3: 消息气泡优化**

- 用户气泡: `--primary-soft` 底色, `--radius-m` 圆角
- AI 气泡: `--card` 底色, `--border` 边框
- 字体: 13px, `--foreground` / `--muted-foreground`

**Step 4: 验证**

- AI Drawer 整体风格与字段管理 Side Drawer 一致
- Header 无 blur/渐变，浅灰底
- 消息气泡清爽统一

**Step 5: Commit**

```bash
git add src/features/ai/components/AiDrawer.js src/features/ai/styles/ai-theme.css
git commit -m "feat(ui): align AI drawer styling with unified Side Drawer design"
```

---

## Batch 5: 收尾 + 测试

> **前置**: Batch 4 全部完成

### Task 5A: 辅助组件样式收尾

**Files:**
- Modify: `index.html` (shortcuts-panel)
- Modify: `src/utils/dom.js` (popover)
- Modify: `src/utils/toast.js` (toast)

**Step 1: shortcuts-panel 样式统一**

- 移除强渐变 header (`linear-gradient(135deg, #4A90E2...)`)
- 改为 `--surface` 底色 + icon + title
- 圆角统一为 `--radius-m`

**Step 2: Popover 样式统一**

- 圆角: `--radius-m`
- 阴影: `--shadow-modal` 或更轻的阴影
- 底色: `--card`

**Step 3: Toast 样式统一**

- 圆角: `--radius-m`
- 底色: `--card`
- 文字色: `--foreground` / `--muted-foreground`

**Step 4: Commit**

```bash
git add index.html src/utils/dom.js src/utils/toast.js
git commit -m "feat(ui): unify shortcuts, popover, toast to design system tokens"
```

---

### Task 5B: 端到端验证 + 回归测试

**Checklist:**

- [ ] **视图切换**: 分屏/表格/甘特 三种模式切换正常，刷新后保持
- [ ] **甘特增强**: 斑马纹、Today 线、进度填充可见
- [ ] **Header/Toolbar**: 统一浅灰底，无渐变
- [ ] **确认弹窗**: 任务删除、AI 清空、字段删除 → 统一 Confirm Dialog
- [ ] **Modal Card**: 字段配置、AI 配置 → 统一 Header(浅灰底)/Body/Footer
- [ ] **Side Drawer**: 字段管理面板 → 统一 Side Drawer，Header 无渐变
- [ ] **AI Drawer**: Header/Footer 对齐 Side Drawer 风格
- [ ] **AI 工具调用**: 聊天框输入任务查询 → 工具调用 → 返回结果
- [ ] **AI 路由**: 任务查询走 Skill，闲聊走通用对话
- [ ] **辅助组件**: shortcuts-panel / popover / toast 样式一致
- [ ] **响应式**: 移动端不报错
- [ ] **多语言**: 切换语言后 UI 正常
- [ ] **持久化**: viewMode / AI 配置等刷新后不丢失

**Final Commit:**

```bash
git commit -m "chore: verify end-to-end UI unification and AI skills integration"
```

---

## 并行执行摘要

| Batch | Task | 内容 | 可并行 | 预估复杂度 |
|-------|------|------|--------|-----------|
| 1 | 1A | CSS 变量 + Header + Toolbar | 是 | 中 |
| 1 | 1B | View Toggle + viewMode | 是 | 中 |
| 1 | 1C | AI Tools + Registry | 是 | 低 |
| 2 | 2A | Confirm Dialog 统一 | 是 | 中 |
| 2 | 2B | Modal Card 统一 | 是 | 中 |
| 2 | 2C | Skills Registry + Router | 是 | 中 |
| 3 | 3A | Field Mgmt → Side Drawer | 是 | 中 |
| 3 | 3B | Gantt 视觉增强 | 是 | 中 |
| 4 | 4A | Executor + runSmartChat + Tool UI | 是 | 高 |
| 4 | 4B | AiDrawer 样式优化 | 是 | 低 |
| 5 | 5A | 辅助组件收尾 | - | 低 |
| 5 | 5B | 端到端验证 | - | 中 |

**总计: 12 个子任务，5 个批次，每批内的子任务完全独立可并行。**
