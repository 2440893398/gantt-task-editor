# AGENTS.md — gantt-task-editor

Vanilla JS Gantt chart SPA. Vite 5, Tailwind 4 + DaisyUI 5, DHTMLX Gantt (CDN), Dexie.js, Vercel AI SDK.

Commands live in `package.json` scripts (`dev` serves on port 5273). Vitest runs on jsdom with
`pool: 'forks'`; Playwright is Chromium-only.

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
- **Project scoping**: all Dexie uses `projectScope(projectId)` — EXCEPT the work
  calendar (settings, company special days, person leaves, holiday cache), which is
  deliberately global across projects (EXC-GUI-01, decided 2026-08-19)
- **Undo/redo**: `undoManager` singleton tracks AI mutations
- **Agent CLI layer**: `src/features/agent-cli/` exposes app features as agent commands
  (registry → manifest/discovery → dispatch → guards). It mirrors feature behavior, so it
  goes stale silently when features change.

## Deployment (two copies, one codebase)

`npm run build:cn` copies `workers/share-worker.js` verbatim into the Pages artifact as
`_worker.js`, so **the Pages site and the `gantt-share` Worker run the same code in two
deployments**. They differ only in bindings: the Pages project has KV + Durable Object,
while D1, R2 and Workflows exist only on the Worker — which is why the feedback write path
lives there and the app's `VITE_FEEDBACK_API_URL` points at `*.workers.dev`. Pages still
needs its `_worker.js` because `/feedback` is rendered, not a static file.

- **Changing `workers/share-worker.js` means deploying both sides.** Deploying only one
  leaves the page UI and the API on different versions — that drift is what users perceive
  as "the styling is wrong". Worker: `npx wrangler deploy --config wrangler.toml`.
  Pages: `npm run deploy:cn`.
- **Pages is the only entry a person should see** (SCN-FWB-028). User-facing links use
  `FEEDBACK_PRODUCTION_ORIGIN`, and `/feedback` on `*.workers.dev` 302s back to Pages.
  Attachment signed URLs stay on the Worker — they need R2 and the signing secret.
- **New modules imported by the Worker must be registered** in `workerModuleFiles`
  (`scripts/prepare-cloudflare-pages.js`), or the CN build validation fails.
- **`.github/workflows/` changes do not take effect via deploy.** The Worker dispatches
  workflows from `master` (`FEEDBACK_GITHUB_REF`), so they must be merged first.
- Pre-flight checks that need no credentials: `npm run feedback:worker:dry-run` and
  `npm run build:cn`.

## Boundaries

- ✅ **Always do:** Run `npm test` before committing. Include `.js` in import paths. Use `i18n.t()` in JS and `data-i18n` in HTML. When changing or adding any feature, check the impact on the agent CLI command layer (`src/features/agent-cli/`) — adapt its commands/manifest/guards to match and update `tests/unit/agent-cli/` (plus `tests/e2e/agent-cli.spec.js` for user-visible flows). After changing `workers/share-worker.js`, deploy both the Worker and Pages — see [Deployment](#deployment-two-copies-one-codebase).
- ⚠️ **Ask first:** Adding new DHTMLX Gantt event listeners. Modifying `core/store.js` or `core/storage.js`. Changing `features/` module boundaries.
- 🚫 **Never do:** Call Dexie directly — use `src/core/storage.js`. Import `window.gantt` as a module. Use `var`. Create files outside `src/` or `tests/`.

## Working Principles

- Analyze circular dependencies and side effects before implementing.
- Keep diffs focused; report unrelated issues separately.
