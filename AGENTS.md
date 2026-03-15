# AGENTS.md — gantt-task-editor

## Project Overview

Vanilla JS (ES6 modules) Gantt chart project management SPA. Vite 5 build, Tailwind 4 + DaisyUI 5, DHTMLX Gantt (CDN, global `window.gantt`), Dexie.js (IndexedDB), Vercel AI SDK. Dual deployment: Vercel (international) + Cloudflare Workers (China).

## Build / Dev / Test Commands

```bash
npm run dev            # Vite dev server → http://localhost:5273
npm run build          # Production build → dist/
npm run build:cn       # China build → dist-cn/ (vite.config.cn.js)
npm run preview        # Preview production build

npm test               # Vitest watch mode (unit tests)
npm run test:ui        # Vitest with browser UI
npm run test:coverage  # Vitest with v8 coverage → doc/testdoc/vitest-coverage/

npm run test:e2e       # Playwright E2E (Chromium, auto-starts dev server)
```

**Run a single unit test:**

```bash
npx vitest run tests/unit/time-formatter.test.js
npx vitest run --reporter=verbose tests/unit/zoom.test.js
# Tests co-located inside src/ are also valid:
npx vitest run src/features/ai/services/undoManager.test.js
```

**Run a single E2E test:**

```bash
npx playwright test tests/e2e/gantt-basic.spec.js
npx playwright test tests/e2e/gantt-basic.spec.js --headed   # with browser visible
```

**Test config notes:**

- Vitest: jsdom env, `pool: 'forks'`, `singleFork: true`, setup file `tests/setup.js`, excludes `tests/e2e/` and `.worktrees/`
- Playwright: Chromium only, `baseURL http://127.0.0.1:5273`, 60s test / 30s action timeout, auto-starts dev server
- Coverage target: 80%+. Reports: `doc/testdoc/vitest-report/`, `doc/testdoc/playwright-report/`
- No ESLint/Prettier configured — style enforced by convention

## Code Style Guidelines

### Module System

- ES Modules throughout (`"type": "module"` in package.json)
- Prefer **named exports**: `export function showToast(...)`, `export const state = {...}`
- Default export only for singleton instances: `export default undoManager`
- Import with relative paths including `.js` extension: `import { state } from '../core/store.js'`
- Group imports: CSS/styles first → feature modules → utilities → core

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Source files | `kebab-case.js` | `time-formatter.js`, `inline-edit.js` |
| AI/UI component files | `PascalCase.js` | `AiConfigModal.js`, `ProjectPicker.js` |
| Functions / variables | `camelCase` | `formatDuration`, `currentProjectId` |
| Constants | `UPPER_SNAKE_CASE` | `PRIORITY_COLORS`, `STORAGE_KEYS` |
| Classes | `PascalCase` | `AiService` |
| CSS classes | Tailwind utilities + DaisyUI | `btn btn-primary`, `modal modal-open` |
| HTML IDs | `kebab-case` | `user-profile-form`, `gantt-container` |
| Test selectors | `data-testid` attribute | `data-testid="save-btn"` |
| i18n attribute variants | `data-i18n-*` | `data-i18n-placeholder`, `data-i18n-title` |

### Formatting

- **4-space indentation** in all JS/CSS source files
- **Single quotes** for JS strings; backticks for interpolation
- Template literals: `` `Hello ${name}` ``
- Freely use optional chaining (`?.`) and nullish coalescing (`??`)
- All async code uses `async/await`; no raw `.then()` chains
- Section separators in long files: `// ========== 功能名称 ==========`

### Error Handling

Wrap with `try/catch`, log via `console.error()` / `console.warn()` with **bracketed module tags**:

```js
try {
    localStorage.setItem(key, value);
} catch (error) {
    console.warn('[Store] Failed to persist to localStorage:', error);
}
```

Standard tags: `[Storage]`, `[Store]`, `[AI]`, `[Calendar]`, `[Gantt]`, `[Projects]`, `[Share]`

- All localStorage reads/writes must be wrapped (quota / privacy errors)
- Async Dexie operations should be wrapped at the call site

### Documentation

- JSDoc on all exported functions:
  ```js
  /**
   * @param {string} key - i18n translation key
   * @returns {string} Translated string
   */
  export function t(key) { ... }
  ```
- Chinese comments are common alongside English code — both are acceptable
- Section separators for files > ~100 lines: `// ========== 样式导入 ==========`

### State & Events

- **Single source of truth**: `src/core/store.js` exports `state` object — never create parallel state
- Storage abstraction: `src/core/storage.js` — Dexie (IndexedDB) + localStorage wrapper; do not call Dexie directly from feature modules
- Custom events: `document.dispatchEvent(new CustomEvent('eventName', { detail: {...} }))`
- DHTMLX events: `gantt.attachEvent('onTaskClick', handler)`
- Global bridge: functions exposed on `window.*` for HTML `onclick` handlers (e.g., `window.exportConfig`, `window.openTaskDetailsPanel`)
- Dynamic imports for deferred panels: `import('./features/calendar/panel.js').then(m => m.openCalendarPanel())`

### I18n

- JS: `i18n.t('message.key')` — import `{ i18n }` from `'./utils/i18n.js'`
- HTML: `data-i18n="key"`, `data-i18n-placeholder="key"`, `data-i18n-title="key"`, `data-i18n-tip="key"`
- 4 locales: `zh-CN`, `en-US`, `ja-JP`, `ko-KR` in `src/locales/`
- Always provide a fallback string: `i18n.t('key') || '默认文本'`

### Styling

- Tailwind CSS 4 with `@import "tailwindcss"` and `@layer` directives in CSS files
- DaisyUI 5 component classes (`btn`, `modal`, `dropdown`, `card`, `badge`, etc.)
- CSS custom properties in `:root` for design tokens
- Component-scoped CSS: `src/styles/components/`; page-level: `src/styles/pages/`; responsive: `src/styles/responsive/`
- Never use inline `style=""` where a utility class suffices

### Testing

- Vitest unit tests: `describe` / `it` / `expect`, mock with `vi.fn()` / `vi.spyOn()` / `vi.mock()`
- `tests/setup.js` provides global mocks for `gantt`, `localStorage`, `Sortable`, and common feature modules
- When writing new tests that need the real module implementation, use `vi.mock('../path', async (importOriginal) => { const orig = await importOriginal(); return { ...orig, initFoo: vi.fn() }; })`
- Tests may live in `tests/` mirroring `src/` structure, or co-located inside `src/` (e.g., `undoManager.test.js`)
- E2E: Playwright with Chromium; prefer `data-testid` selectors over CSS class selectors

## Project Structure (key paths)

```
src/
  main.js                      # App entry: init sequence, global window bridges
  config/constants.js          # PRIORITY_COLORS, STATUS_COLORS, FIELD_TYPE_CONFIG
  core/storage.js              # Dexie + localStorage CRUD, projectScope helper
  core/store.js                # Global state object, persistence, migrations
  data/                        # defaultTasks, defaultCustomFields, fields config
  features/
    ai/
      agent/                   # executor.js, router.js
      api/client.js            # Vercel AI SDK wrapper
      components/              # AiConfigModal.js, AiDrawer.js, AiFloatingBtn.js, DiffConfirmModal.js
      manager.js               # AI module init & lightbox integration
      services/                # aiService.js, errorHandler.js, undoManager.js
      skills/, tools/, prompts/, renderers/, utils/
    calendar/                  # Work calendar, holiday fetcher, panel
    config/configIO.js         # Import/export project config + Excel
    customFields/              # Custom field CRUD UI (manager.js)
    gantt/                     # ~22 modules: init, columns, zoom, markers, scheduler, etc.
    lightbox/customization.js  # Task edit dialog (DHTMLX lightbox)
    projects/                  # ProjectPicker, ProjectModal, CreateProjectDialog, manager
    selection/                 # Multi-select, batch edit
    share/                     # Share link (Cloudflare Worker)
    task-details/              # Task detail side panel (panel.js, left/right sections)
  locales/                     # zh-CN.js, en-US.js, ja-JP.js, ko-KR.js
  styles/                      # main.css, components/, pages/, responsive/
  utils/                       # i18n.js, toast.js, time-formatter.js, dom.js, analytics.js
workers/
  share-worker.js              # Cloudflare Worker for share links
tests/
  setup.js                     # Global Vitest mocks (gantt, localStorage, Sortable, modules)
  unit/                        # Unit tests mirroring src/ structure (~70+ files)
  e2e/                         # Playwright specs (~27 files)
  features/, core/, integration/, utils/
```

## Architecture Notes

- **DHTMLX Gantt** is loaded via CDN; `window.gantt` is the global entry point — never import it as a module
- **Vite manual chunks**: `vendor` (dexie, exceljs, marked, quill, zod) and `ai` (@ai-sdk/openai, ai) are split for optimal caching
- **China build** (`vite.config.cn.js`): outputs to `dist-cn/`, deployed on Cloudflare Workers via `wrangler.jsonc`
- **Project scoping**: all Dexie operations use `projectScope(projectId)` to namespace data per project
- **Undo/redo**: `undoManager` (singleton default export) tracks AI-driven task mutations

## 注意事项 (Agent Guidelines)

### 可行性分析（防止循环问题）

在开发、设计、解决问题之前，**必须**先对用户提出的问题进行可行性分析：

1. **识别问题依赖链**：分析当前问题的解决方案是否会引入新的问题，特别要警惕 A→B→A 的循环依赖。
2. **预判副作用**：在动手之前，明确列出解决方案可能带来的副作用，并评估这些副作用是否可接受。
3. **如果发现循环风险**：必须在实施前向用户说明，提出替代方案或折中方案，而不是盲目执行后再回头修补。
4. **记录决策链**：使用 TodoWrite 记录「问题 → 方案 → 可能的副作用 → 应对措施」，确保每一步都经过审慎思考。

> 核心原则：解决问题不能制造新问题。如果方案 X 解决了问题 A 但引出问题 B，而解决 B 又会恢复问题 A，则方案 X 不可行，必须寻找其他路径。

### 文档检索（weknora MCP）

本项目已配置 weknora MCP Server 用于文档检索。所有与项目相关的文档检索都应使用 weknora：

- **知识库 ID**: `f6dd9088-2e05-4dcb-b53e-7eb43d3dda4c`
- **检索方式**: `hybrid_search` 工具，`match_count: 5`
- **新增文档**: `create_knowledge_from_url`（`kb_id` + `url` + `enable_multimodel: true`）
- **同步脚本**: `scripts/weknora-sync.js`；映射文件: `scripts/weknora-sync-map.json`
- **手动同步**: `node scripts/sync-to-weknora.js [file...]`（无参数时同步全部 `.md` 文件）
- 如果 weknora 服务不可用，hook 会静默失败（不影响 commit）
