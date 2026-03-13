# AGENTS.md — gantt-task-editor

## Project Overview

Vanilla JS (ES6 modules) Gantt chart project management SPA. Vite 5 build, Tailwind 4 + DaisyUI 5, DHTMLX Gantt (CDN), Dexie.js (IndexedDB), Vercel AI SDK. Dual deployment: Vercel (international) + Cloudflare Workers (China).

## Build / Dev / Test Commands

```bash
npm run dev            # Vite dev server on http://localhost:5273
npm run build          # Production build -> dist/
npm run build:cn       # China build -> dist-cn/ (vite.config.cn.js)
npm run preview        # Preview production build

npm test               # Vitest watch mode (unit tests)
npm run test:ui        # Vitest with browser UI
npm run test:coverage  # Vitest with v8 coverage

npm run test:e2e       # Playwright E2E tests (Chromium, auto-starts dev server)
```

**Run a single unit test:**

```bash
npx vitest run tests/unit/time-formatter.test.js
npx vitest run --reporter=verbose tests/utils/some-test.test.js
```

**Run a single E2E test:**

```bash
npx playwright test tests/e2e/some-spec.spec.js
```

**Test config notes:**

- Vitest: jsdom env, `pool: 'forks'`, setup at `tests/setup.js`, excludes `tests/e2e/`
- Playwright: Chromium only, baseURL `http://127.0.0.1:5273`, 60s test / 30s action timeout
- Coverage target: 80%+. Reports: `doc/testdoc/vitest-report/`, `doc/testdoc/playwright-report/`
- No ESLint/Prettier configured — style enforced by convention

## Code Style Guidelines

### Module System

- ES Modules throughout (`"type": "module"` in package.json)
- Prefer **named exports**: `export function showToast(...)`, `export const state = {...}`
- Import with relative paths from `src/`: `import { state } from '../core/store.js'`
- Group imports by category: styles first, then features, utils, core

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case.js` | `time-formatter.js`, `rich-text-editor.js` |
| AI component files | `PascalCase.js` | `AiConfigModal.js`, `AiDrawer.js` |
| Functions/variables | `camelCase` | `formatDuration`, `currentLanguage` |
| Constants | `UPPER_SNAKE_CASE` | `PRIORITY_COLORS`, `STORAGE_KEYS` |
| Classes | `PascalCase` | `AiService` |
| CSS classes | Tailwind utilities + DaisyUI components | `btn btn-primary` |
| HTML IDs | `kebab-case` | `user-profile-form` |
| Test IDs | `data-testid` attribute | `data-testid="save-btn"` |

### Formatting

- **4-space indentation** in JS source files
- **Single quotes** for strings
- Template literals for interpolation: `` `Hello ${name}` ``
- Use optional chaining (`?.`) and nullish coalescing (`??`) freely
- All async code uses `async/await` (no raw Promise chains)

### Error Handling

- Wrap with `try/catch`, log via `console.error()` / `console.warn()` with **tagged prefixes**:

  ```js
  try { ... } catch (error) {
      console.error('[Storage] Failed to save:', error);
  }
  ```

- Tags follow module name: `[Storage]`, `[Store]`, `[AI]`, `[Calendar]`, etc.
- localStorage operations always wrapped in try/catch (quota/privacy errors)

### Documentation

- JSDoc on exported functions with `@param` and `@returns`
- Chinese comments are common alongside English code — both acceptable
- Section separators for long files: `// ========== 样式导入 ==========`

### State & Events

- Centralized state in `src/core/store.js` — import `state` object, don't create parallel state
- Storage abstraction in `src/core/storage.js` — Dexie (IndexedDB) + localStorage wrapper
- Events via `CustomEvent` + `document.dispatchEvent()` and `gantt.attachEvent()`
- Global bridge: some functions exposed on `window.*` for HTML onclick handlers

### I18n

- Use `i18n.t('key')` in JS, `data-i18n="key"` in HTML
- Also `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-tip` for HTML attributes
- 4 locales: `zh-CN`, `en-US`, `ja-JP`, `ko-KR` in `src/locales/`

### Styling

- Tailwind CSS 4 with `@import "tailwindcss"` and `@layer` directives
- DaisyUI 5 component classes (`btn`, `modal`, `dropdown`, `card`, etc.)
- CSS custom properties in `:root` for design tokens
- Component CSS in `src/styles/components/`, page CSS in `src/styles/pages/`

### Testing

- Vitest: `describe`/`it`/`expect`, mock with `vi.fn()` / `vi.spyOn()`
- Global mocks in `tests/setup.js` for gantt, localStorage, DOM-dependent modules
- Tests mirror source structure: `tests/unit/`, `tests/e2e/`, `tests/features/`, `tests/integration/`
- E2E: Playwright with Chromium, use `data-testid` selectors

## Project Structure (key paths)

```
src/
  main.js                  # App entry, init sequence, event wiring
  config/constants.js      # PRIORITY_COLORS, STORAGE_KEYS, SYSTEM_FIELD_CONFIG
  core/storage.js          # Dexie + localStorage CRUD
  core/store.js            # Global state, persistence, migrations
  features/ai/             # AI assistant (agent, api, prompts, tools, skills)
  features/gantt/           # Gantt chart (init, columns, zoom, scheduler, markers)
  features/calendar/       # Work calendar, holidays
  features/customFields/   # Custom field management
  features/lightbox/       # Task edit dialog
  features/selection/      # Multi-select, batch edit
  features/task-details/   # Task detail side panel
  locales/                 # zh-CN, en-US, ja-JP, ko-KR
  styles/                  # main.css, components/, pages/, responsive/
  utils/                   # i18n, toast, analytics, time-formatter, dom
tests/
  setup.js                 # Global test mocks
  unit/                    # ~70 unit test files
  e2e/                     # ~27 Playwright specs
  features/, core/, integration/, utils/
```

## 注意事项

### 可行性分析（防止循环问题）

在开发、设计、解决问题之前，**必须**先对用户提出的问题进行可行性分析：

1. **识别问题依赖链**：分析当前问题的解决方案是否会引入新的问题，特别要警惕 A→B→A 的循环依赖。
2. **预判副作用**：在动手之前，明确列出解决方案可能带来的副作用，并评估这些副作用是否可接受。
3. **如果发现循环风险**：必须在实施前向用户说明，提出替代方案或折中方案，而不是盲目执行后再回头修补。
4. **记录决策链**：使用 TodoWrite 记录「问题 → 方案 → 可能的副作用 → 应对措施」，确保每一步都经过审慎思考。

> 核心原则：解决问题不能制造新问题。如果方案 X 解决了问题 A 但引出问题 B，而解决 B 又会恢复问题 A，则方案 X 不可行，必须寻找其他路径。

### 文档检索（weknora MCP）

本项目已配置 weknora MCP Server 用于文档检索。所有与项目相关的文档检索都应使用 weknora：

- **知识库名称**: `Gantt Chart Project`
- **知识库 ID**: `f6dd9088-2e05-4dcb-b53e-7eb43d3dda4c`
- **检索方式**: 使用 `hybrid_search` 工具进行混合搜索
- **新增文档**: 使用 `create_knowledge_from_url` 工具将文档 URL 添加到知识库

**检索示例**:

```javascript
// 使用 hybrid_search 工具搜索知识库
{
  kb_id: "f6dd9088-2e05-4dcb-b53e-7eb43d3dda4c",
  query: "项目相关问题",
  match_count: 5
}
```

**添加新文档到知识库**:

```javascript
// 使用 create_knowledge_from_url 添加文档
{
  kb_id: "f6dd9088-2e05-4dcb-b53e-7eb43d3dda4c",
  url: "https://example.com/doc-url",
  enable_multimodel: true
}
```
