# AGENTS.md — gantt-task-editor

Vanilla JS Gantt chart SPA. Vite 5, Tailwind 4 + DaisyUI 5, DHTMLX Gantt (CDN), Dexie.js, Vercel AI SDK.

## Build & Run

```bash
npm run dev      # http://localhost:5273
npm run build    # dist/
npm run build:cn # dist-cn/ (Cloudflare)
npm run check    # lint + format:check + test
```

## Testing

```bash
npm test             # Vitest (unit tests)
npm run test:ui      # vitest --ui
npm run test:coverage # v8 coverage → doc/testdoc/
npm run test:e2e     # Playwright E2E (Chromium)
```

Single test: `npx vitest run tests/unit/xxx.test.js`

Vitest: jsdom, `pool: 'forks'`. Playwright: Chromium only.

## Business Testing Loop (mandatory)

Business tests are driven by three assets — scenario inventory (`tests/scenarios/<domain>.md`),
golden answers (`tests/e2e/agent-journeys/expected/*.json`), and journey specs. The single
authoritative spec is [tests/scenarios/README.md](./tests/scenarios/README.md); read it before
touching business behavior or those directories. Non-negotiable rules:

1. **Requirement changes update the scenario inventory first.** Decide what you can infer
   yourself (log it in the inventory changelog); ambiguous business intent goes to the
   inventory's "例外队列" section for the user — never guess silently.
2. **Contracts are protected.** `expected/` files and scenario verification points are the
   contract. Editing test *implementation* is free; editing the contract requires an entry in
   `expected/CHANGES.md` (date, SCN-ID, reason). Goldens are re-recorded only via
   `UPDATE_GOLDEN=1`, never hand-edited.
3. **Red before green.** Before fixing a failing business test, confirm the failure reflects a
   real business difference and state what bad behavior the test would catch. Never silence
   failures via `test.skip`, deleted assertions, or weakened comparisons.
4. **Traceability.** Business test titles embed `[SCN-xxx]`; `npm run check:scenarios` must
   pass before commit.

## AI Quality Gates

Before code changes, classify the task using `docs/ai-development-quality-gates.md`.
Use the minimum sufficient tier: Tier 0 for trivial/no-runtime changes, Tier 1 for small
local fixes, Tier 2 for user-visible interactions, and Tier 3 for core flows such as
drag/drop, hierarchy, links, persistence, calendar cache/worktime, batch operations, or
undo/redo. Keep verification targeted, but include fresh evidence in the final response.

## Project Structure

```
src/
├── main.js              # Entry point
├── config/constants.js  # Colors, field config
├── core/                # storage.js (Dexie), store.js (state)
├── data/                # fields.js, tasks.js
├── features/
│   ├── agent-cli/       # AI agent command layer: commands/, runtime/ (dispatch, manifest, guards), discovery/, adapters/
│   ├── ai/              # agent, api, components, prompts, renderers, services, skills/**, tools, utils
│   ├── calendar/        # holidayFetcher, mini-calendar, panel, tab1-3, locale-country
│   ├── config/configIO.js, customFields/, gantt/ (~18 modules)
│   ├── lightbox/, projects/, selection/, share/, task-details/
├── locales/             # zh-CN, en-US, ja-JP, ko-KR
├── styles/, utils/      # i18n, toast, time-formatter, dom, analytics
workers/share-worker.js   # Cloudflare Worker
tests/setup.js, unit/** (~100), e2e/** (~27)
```

## Code Style

- ES Modules, named exports, `.js` in import paths
- 4-space indent, single quotes, template literals
- `async/await` only — no `.then()` chains
- Section separators: `// ========== Name ==========`

### Naming
| Files | Convention | Example |
|-------|-----------|---------|
| Source | `kebab-case.js` | `time-formatter.js` |
| Components | `PascalCase.js` | `AiDrawer.js` |
| Functions/vars | `camelCase` | `formatDuration` |
| Constants | `UPPER_SNAKE_CASE` | `PRIORITY_COLORS` |

### Error Handling
- Wrap localStorage/Dexie in `try/catch`
- Tags: `[Storage]`, `[Store]`, `[AI]`, `[Gantt]`, `[Projects]`

### State & Events
- Single source: `src/core/store.js` exports `state`
- Storage via `src/core/storage.js` — never call Dexie directly
- Custom events: `document.dispatchEvent(new CustomEvent('name', { detail }))`
- DHTMLX: `gantt.attachEvent('onTaskClick', handler)`
- Global bridges: `window.*` for HTML onclick handlers

### I18n
- JS: `i18n.t('key')`; HTML: `data-i18n="key"`

## Architecture

- **DHTMLX Gantt**: CDN global `window.gantt` — never import as module
- **Vite chunks**: `vendor` (dexie, exceljs...) + `ai` (@ai-sdk/openai, ai)
- **Project scoping**: all Dexie uses `projectScope(projectId)`
- **Undo/redo**: `undoManager` singleton tracks AI mutations
- **Agent CLI layer**: `src/features/agent-cli/` exposes app features as agent commands
  (registry → manifest/discovery → dispatch → guards). It mirrors feature behavior, so it
  goes stale silently when features change.

## Boundaries

- ✅ **Always do:** Run `npm test` before committing. Include `.js` in import paths. Use `i18n.t()` in JS and `data-i18n` in HTML. When changing or adding any feature, check the impact on the agent CLI command layer (`src/features/agent-cli/`) — adapt its commands/manifest/guards to match and update `tests/unit/agent-cli/` (plus `tests/e2e/agent-cli.spec.js` for user-visible flows).
- ⚠️ **Ask first:** Adding new DHTMLX Gantt event listeners. Modifying `core/store.js` or `core/storage.js`. Changing `features/` module boundaries.
- 🚫 **Never do:** Call Dexie directly — use `src/core/storage.js`. Import `window.gantt` as a module. Use `var`. Create files outside `src/` or `tests/`.

## Working Principles

- Analyze circular dependencies and side effects before implementing.
- Keep diffs focused; report unrelated issues separately.
