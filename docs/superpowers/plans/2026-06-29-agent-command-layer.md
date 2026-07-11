# Agent Command Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a deterministic, self-describing `window.app` command layer that external browser agents can use to observe and mutate the Gantt project through the same domain logic as the application.

**Architecture:** Build a shared `features/gantt/domain/` layer first, then put `features/agent-cli/` on top of a single command registry and dispatch pipeline. Mutating commands use `plan()` for dry-run diffs, `commit()` inside a project transaction, `settleAndPersist()` for awaitable final state, and per-project in-memory `rev`/log bookkeeping.

**Tech Stack:** Vanilla ES modules, Vite 5, DHTMLX Gantt via `window.gantt`, Dexie through `src/core/storage.js` and `src/core/store.js`, Vitest with jsdom, Playwright Chromium.

---

## Quality Gate Classification

Implementation is **Tier 3: High-Risk Core Flow** under `docs/ai-development-quality-gates.md`.

Reasons:
- Touches hierarchy, dependency links, persistence, batch operations, undo/redo, scheduler recalculation, and cross-module state.
- Adds an externally callable write surface.
- Requires unit/integration tests plus browser-level verification.

Minimum evidence for every implementation batch:
- Targeted Vitest files for the changed module.
- At least one browser/DOM or Playwright check for user-visible command effects after M1.
- `npm test` before commit, per `AGENTS.md`.

## Required Approval Gate

Before implementation, get explicit user approval for these boundary changes from `AGENTS.md` and the design spec:

- Modify `features/` module boundaries:
  - Move `src/features/ai/services/undoManager.js` to `src/features/gantt/history/undoManager.js`.
  - Add `src/features/gantt/domain/`.
  - Add `src/features/agent-cli/`.
- Add transaction-time event suppression around DHTMLX Gantt writes.
- Modify `src/core/store.js` and `src/main.js` autosave/persistence behavior.
- Decide whether `src/features/agent-cli/README-agent.md` is acceptable. It is inside `src/`, but it is documentation inside source.
- Keep `/llms.txt` out of v1 unless the user explicitly approves a `public/` file.

Do not begin code changes until this approval is recorded in the thread.

## Planned File Structure

### Move
- `src/features/ai/services/undoManager.js` -> `src/features/gantt/history/undoManager.js`

### Create
- `src/features/gantt/domain/transaction.js`
- `src/features/gantt/domain/settle.js`
- `src/features/gantt/domain/rev.js`
- `src/features/gantt/domain/diff.js`
- `src/features/gantt/domain/task-ops.js`
- `src/features/gantt/domain/hierarchy-ops.js`
- `src/features/gantt/domain/link-ops.js`
- `src/features/gantt/domain/schedule-ops.js`
- `src/features/agent-cli/index.js`
- `src/features/agent-cli/registry.js`
- `src/features/agent-cli/commands/task.js`
- `src/features/agent-cli/commands/hierarchy.js`
- `src/features/agent-cli/commands/link.js`
- `src/features/agent-cli/commands/schedule.js`
- `src/features/agent-cli/commands/state.js`
- `src/features/agent-cli/commands/session.js`
- `src/features/agent-cli/runtime/api-builder.js`
- `src/features/agent-cli/runtime/dispatch.js`
- `src/features/agent-cli/runtime/exec.js`
- `src/features/agent-cli/runtime/guards.js`
- `src/features/agent-cli/runtime/log.js`
- `src/features/agent-cli/runtime/manifest.js`
- `src/features/agent-cli/runtime/result.js`
- `src/features/agent-cli/discovery/index.js`
- `src/features/agent-cli/adapters/gantt-adapter.js`
- `tests/unit/agent-cli/`
- `tests/unit/gantt/domain/`
- `tests/e2e/agent-cli.spec.js`

### Modify
- `src/main.js`
- `src/main.js` autosave import path for `undoManager`
- `src/core/store.js`
- `src/features/gantt/scheduler.js`
- Existing imports of `src/features/ai/services/undoManager.js`
- `src/features/ai/tools/registry.js`
- `src/features/ai/tools/taskTools.js`
- `src/features/ai/tools/analysisTools.js`
- `src/features/ai/tools/calendarTools.js`
- `src/main.js` bootstrap to initialize `window.app`

---

## Task 0: Approval, Baseline, and Import Map

**Files:**
- Read: `doc/design/DESIGN_SPEC_面向Agent命令层_v1.md`
- Read: `docs/ai-development-quality-gates.md`
- Read: `src/main.js`
- Read: `src/core/store.js`
- Read: `src/features/gantt/scheduler.js`
- Read: `src/features/ai/services/undoManager.js`

- [ ] **Step 1: Record approval**

Ask the user to approve the boundary changes listed in "Required Approval Gate". Continue only after approval.

- [ ] **Step 2: Capture current undo imports**

Run:

```bash
rg -n "features/ai/services/undoManager|undoManager" src tests
```

Expected: output includes `src/main.js`, `src/features/gantt/scheduler.js`, and AI undo tests. Save the list in the implementation notes for Task 1.

- [ ] **Step 3: Capture current persistence entry points**

Run:

```bash
rg -n "persistGanttData|setupAutoSave|scheduleCloudSync|scheduleAsyncReschedule" src/main.js src/core/store.js src/features/gantt/scheduler.js
```

Expected: output includes `src/core/store.js:230`, `src/main.js:253`, and `src/features/gantt/scheduler.js:618`.

- [ ] **Step 4: Run baseline targeted tests**

Run:

```bash
npx vitest run src/features/ai/services/undoManager.test.js tests/unit/ai/services/undoManager.test.js tests/unit/scheduler.test.js tests/unit/main-autosave-build.test.js
```

Expected: PASS. If any test fails before edits, stop and record the failure as pre-existing.

---

## Task 1: Move Undo Manager into Gantt History

**Files:**
- Move: `src/features/ai/services/undoManager.js` -> `src/features/gantt/history/undoManager.js`
- Move or duplicate test target as needed: `src/features/ai/services/undoManager.test.js` -> `tests/unit/gantt/history/undoManager.test.js`
- Modify: `src/main.js`
- Modify: `src/features/gantt/scheduler.js`
- Modify: all imports found in Task 0 Step 2

- [ ] **Step 1: Write failing import-boundary test**

Create `tests/unit/gantt/history/undoManager-import-boundary.test.js`:

```js
import { describe, expect, it } from 'vitest';

describe('undoManager import boundary', () => {
    it('is exported from gantt history', async () => {
        const module = await import('../../../src/features/gantt/history/undoManager.js');

        expect(module.default).toBeTruthy();
        expect(typeof module.default.saveState).toBe('function');
        expect(typeof module.default.undo).toBe('function');
        expect(typeof module.default.redo).toBe('function');
    });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/unit/gantt/history/undoManager-import-boundary.test.js
```

Expected: FAIL because `src/features/gantt/history/undoManager.js` does not exist yet.

- [ ] **Step 3: Move file and preserve API**

Move the file without changing public exports. Update imports from:

```js
import undoManager from '../ai/services/undoManager.js';
```

to the correct relative path:

```js
import undoManager from './history/undoManager.js';
```

In `src/main.js`, update:

```js
import undoManager from './features/gantt/history/undoManager.js';
```

- [ ] **Step 4: Update tests that import the old path**

For tests that import `src/features/ai/services/undoManager.js`, change to `src/features/gantt/history/undoManager.js`.

- [ ] **Step 5: Verify moved undo manager**

Run:

```bash
npx vitest run tests/unit/gantt/history/undoManager-import-boundary.test.js tests/unit/ai/services/undoManager.test.js tests/unit/scheduler.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/gantt/history/undoManager.js src/main.js src/features/gantt/scheduler.js tests/unit/gantt/history/undoManager-import-boundary.test.js tests/unit/ai/services/undoManager.test.js
git commit -m "refactor: move undo manager into gantt history"
```

---

## Task 2: Add Domain Foundation, Rev, Diff, and Transactions

**Files:**
- Create: `src/features/gantt/domain/diff.js`
- Create: `src/features/gantt/domain/rev.js`
- Create: `src/features/gantt/domain/transaction.js`
- Test: `tests/unit/gantt/domain/diff.test.js`
- Test: `tests/unit/gantt/domain/rev.test.js`
- Test: `tests/unit/gantt/domain/transaction.test.js`

- [ ] **Step 1: Write diff tests**

Create `tests/unit/gantt/domain/diff.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { createEmptyDiff, mergeDiffs } from '../../../src/features/gantt/domain/diff.js';

describe('domain diff helpers', () => {
    it('creates the canonical empty diff shape', () => {
        expect(createEmptyDiff()).toEqual({
            created: [],
            updated: [],
            deleted: [],
            links: { added: [], removed: [] },
        });
    });

    it('merges created, updated, deleted, and link diffs', () => {
        const result = mergeDiffs([
            { created: ['1'], updated: [], deleted: [], links: { added: [], removed: [] } },
            {
                created: ['2'],
                updated: [{ id: '1', fields: { text: ['Old', 'New'] } }],
                deleted: ['3'],
                links: { added: [{ id: 'l1' }], removed: [{ id: 'l0' }] },
            },
        ]);

        expect(result).toEqual({
            created: ['1', '2'],
            updated: [{ id: '1', fields: { text: ['Old', 'New'] } }],
            deleted: ['3'],
            links: { added: [{ id: 'l1' }], removed: [{ id: 'l0' }] },
        });
    });
});
```

- [ ] **Step 2: Write rev tests**

Create `tests/unit/gantt/domain/rev.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { bumpProjectRev, getProjectRev, resetProjectRev } from '../../../src/features/gantt/domain/rev.js';

describe('project rev', () => {
    it('tracks rev per project in memory', () => {
        resetProjectRev('p1');
        resetProjectRev('p2');

        expect(getProjectRev('p1')).toBe(0);
        expect(bumpProjectRev('p1')).toBe(1);
        expect(getProjectRev('p1')).toBe(1);
        expect(getProjectRev('p2')).toBe(0);
    });
});
```

- [ ] **Step 3: Write transaction tests**

Create `tests/unit/gantt/domain/transaction.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { runGanttTransaction } from '../../../src/features/gantt/domain/transaction.js';

describe('gantt transaction', () => {
    it('restores serialized data when commit throws', async () => {
        const serialized = { data: [{ id: 1, text: 'Before' }], links: [] };
        const gantt = {
            serialize: vi.fn(() => serialized),
            clearAll: vi.fn(),
            parse: vi.fn(),
            render: vi.fn(),
        };

        const result = await runGanttTransaction({
            gantt,
            work: async () => {
                throw new Error('boom');
            },
        });

        expect(result.ok).toBe(false);
        expect(gantt.clearAll).toHaveBeenCalledTimes(1);
        expect(gantt.parse).toHaveBeenCalledWith(serialized);
        expect(gantt.render).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
npx vitest run tests/unit/gantt/domain/diff.test.js tests/unit/gantt/domain/rev.test.js tests/unit/gantt/domain/transaction.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement `diff.js`**

Create:

```js
export function createEmptyDiff() {
    return {
        created: [],
        updated: [],
        deleted: [],
        links: { added: [], removed: [] },
    };
}

export function mergeDiffs(diffs) {
    return diffs.reduce((merged, diff) => {
        merged.created.push(...(diff.created || []));
        merged.updated.push(...(diff.updated || []));
        merged.deleted.push(...(diff.deleted || []));
        merged.links.added.push(...(diff.links?.added || []));
        merged.links.removed.push(...(diff.links?.removed || []));
        return merged;
    }, createEmptyDiff());
}
```

- [ ] **Step 6: Implement `rev.js`**

Create:

```js
const revByProject = new Map();

export function getProjectRev(projectId = 'default') {
    return revByProject.get(projectId) || 0;
}

export function bumpProjectRev(projectId = 'default') {
    const nextRev = getProjectRev(projectId) + 1;
    revByProject.set(projectId, nextRev);
    return nextRev;
}

export function resetProjectRev(projectId = 'default') {
    revByProject.delete(projectId);
}
```

- [ ] **Step 7: Implement `transaction.js`**

Create:

```js
export async function runGanttTransaction({ gantt, work }) {
    const snapshot = gantt.serialize();

    try {
        const data = await work();
        return { ok: true, data };
    } catch (error) {
        gantt.clearAll();
        gantt.parse(snapshot);
        if (typeof gantt.render === 'function') {
            gantt.render();
        }

        return { ok: false, error };
    }
}
```

- [ ] **Step 8: Verify transaction foundation**

Run:

```bash
npx vitest run tests/unit/gantt/domain/diff.test.js tests/unit/gantt/domain/rev.test.js tests/unit/gantt/domain/transaction.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/gantt/domain tests/unit/gantt/domain
git commit -m "feat: add gantt domain transaction foundation"
```

---

## Task 3: Add Awaitable Settle and Local-Only Persistence

**Files:**
- Create: `src/features/gantt/domain/settle.js`
- Modify: `src/features/gantt/scheduler.js`
- Modify: `src/core/store.js`
- Modify: `src/main.js`
- Test: `tests/unit/gantt/domain/settle.test.js`
- Test: `tests/unit/main-autosave-build.test.js`
- Test: `tests/unit/scheduler.test.js`

- [ ] **Step 1: Write settle test**

Create `tests/unit/gantt/domain/settle.test.js`:

```js
import { describe, expect, it, vi } from 'vitest';
import { settleAndPersist } from '../../../src/features/gantt/domain/settle.js';

describe('settleAndPersist', () => {
    it('awaits scheduler recalculation before persistence', async () => {
        const calls = [];
        const scheduler = {
            recalculateProject: vi.fn(async () => calls.push('recalc')),
        };
        const persistGanttData = vi.fn(async () => calls.push('persist'));

        await settleAndPersist({
            scheduler,
            persistGanttData,
            projectId: 'p1',
            source: 'agent',
            sync: false,
        });

        expect(calls).toEqual(['recalc', 'persist']);
        expect(persistGanttData).toHaveBeenCalledWith({
            projectId: 'p1',
            source: 'agent',
            sync: false,
        });
    });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run tests/unit/gantt/domain/settle.test.js
```

Expected: FAIL because `settle.js` does not exist.

- [ ] **Step 3: Expose awaitable scheduler entry**

In `src/features/gantt/scheduler.js`, export a project-level async recalculation wrapper. Keep existing event behavior intact.

```js
export async function recalculateProjectSchedule(taskId = null) {
    if (taskId) {
        await scheduleAsyncReschedule(taskId);
        return;
    }

    const roots = [];
    gantt.eachTask((task) => {
        if (!task.parent || task.parent === 0 || task.parent === '0') {
            roots.push(task.id);
        }
    });

    for (const id of roots) {
        await scheduleAsyncReschedule(id);
    }
}
```

- [ ] **Step 4: Extend `persistGanttData` signature**

In `src/core/store.js`, change the signature from:

```js
export async function persistGanttData() {
```

to:

```js
export async function persistGanttData(options = {}) {
```

Inside the function, read:

```js
const { projectId = state.currentProjectId, source = 'ui', sync = true } = options;
```

Continue to call storage through existing `src/core/storage.js` helpers only. Do not call Dexie directly.

- [ ] **Step 5: Add local-only autosave marker**

In `src/main.js`, add an in-memory marker near `setupAutoSave()`:

```js
const localOnlyAutosaveByProject = new Set();

export function markNextAutosaveLocalOnly(projectId) {
    if (projectId) {
        localOnlyAutosaveByProject.add(projectId);
    }
}
```

In the debounced autosave callback, after `await persistGanttData(...)`, consume the marker before deciding cloud sync:

```js
const shouldSkipCloudSync = localOnlyAutosaveByProject.delete(projectId);

if (!shouldSkipCloudSync) {
    scheduleCloudSync(projectId);
}
```

- [ ] **Step 6: Implement `settle.js`**

Create:

```js
import { persistGanttData } from '../../../core/store.js';
import { recalculateProjectSchedule } from '../scheduler.js';

export async function settleAndPersist({
    scheduler = { recalculateProject: recalculateProjectSchedule },
    persistGanttData: persist = persistGanttData,
    projectId,
    source = 'agent',
    sync = false,
    fromTaskId = null,
} = {}) {
    await scheduler.recalculateProject(fromTaskId);
    await persist({ projectId, source, sync });
}
```

- [ ] **Step 7: Verify settle and autosave**

Run:

```bash
npx vitest run tests/unit/gantt/domain/settle.test.js tests/unit/scheduler.test.js tests/unit/main-autosave-build.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/gantt/domain/settle.js src/features/gantt/scheduler.js src/core/store.js src/main.js tests/unit/gantt/domain/settle.test.js tests/unit/scheduler.test.js tests/unit/main-autosave-build.test.js
git commit -m "feat: add awaitable agent settle persistence"
```

---

## Task 4: Registry, Result, Guards, Manifest, and CLI Parser

**Files:**
- Create: `src/features/agent-cli/registry.js`
- Create: `src/features/agent-cli/runtime/result.js`
- Create: `src/features/agent-cli/runtime/guards.js`
- Create: `src/features/agent-cli/runtime/manifest.js`
- Create: `src/features/agent-cli/runtime/exec.js`
- Test: `tests/unit/agent-cli/registry.test.js`
- Test: `tests/unit/agent-cli/guards.test.js`
- Test: `tests/unit/agent-cli/exec.test.js`
- Test: `tests/unit/agent-cli/manifest.test.js`

- [ ] **Step 1: Write registry and manifest tests**

Create tests asserting:
- `defineCommand()` rejects duplicate names.
- `getCommands()` returns commands sorted by name.
- `buildManifest()` includes `name`, `summary`, `params`, `mutating`, and examples.
- `buildHelp()` returns compact command index when no command name is passed.

- [ ] **Step 2: Write guard tests**

Create tests asserting:
- Missing required string returns `BAD_ARGS`.
- Unknown additional property returns `BAD_ARGS`.
- Enum mismatch returns `ENUM` with `allowed`.
- Valid integers passed as CLI strings are coerced to numbers.

- [ ] **Step 3: Write CLI parser tests**

Create tests asserting:
- `task.create --name "Design review" --duration 3` resolves name and integer.
- Unknown command returns `UNKNOWN_COMMAND` and `didYouMean`.
- Quoted strings with spaces remain intact.

- [ ] **Step 4: Run failing tests**

Run:

```bash
npx vitest run tests/unit/agent-cli/registry.test.js tests/unit/agent-cli/guards.test.js tests/unit/agent-cli/exec.test.js tests/unit/agent-cli/manifest.test.js
```

Expected: FAIL because modules do not exist.

- [ ] **Step 5: Implement minimal registry**

Create `registry.js` with:

```js
const commands = new Map();

export function defineCommand(command) {
    if (!command?.name) {
        throw new Error('Command name is required');
    }
    if (commands.has(command.name)) {
        throw new Error(`Duplicate command: ${command.name}`);
    }
    commands.set(command.name, command);
    return command;
}

export function getCommand(name) {
    return commands.get(name) || null;
}

export function getCommands() {
    return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function clearCommandsForTest() {
    commands.clear();
}
```

- [ ] **Step 6: Implement result builders**

Create `runtime/result.js`:

```js
export function ok(data, rev, warnings) {
    return warnings?.length ? { ok: true, data, rev, warnings } : { ok: true, data, rev };
}

export function fail(code, message, { hint, allowed, didYouMean, rev } = {}) {
    return {
        ok: false,
        error: { code, message, hint, allowed, didYouMean },
        rev,
    };
}
```

- [ ] **Step 7: Implement guards and exec**

Implement a small JSON Schema subset matching v1 needs: `type: object`, `properties`, `required`, `additionalProperties: false`, string/integer/number/boolean, enum, pattern, minimum.

Do not add a third-party schema validator unless the repo already uses it for runtime validation.

- [ ] **Step 8: Verify runtime foundation**

Run:

```bash
npx vitest run tests/unit/agent-cli/registry.test.js tests/unit/agent-cli/guards.test.js tests/unit/agent-cli/exec.test.js tests/unit/agent-cli/manifest.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/agent-cli tests/unit/agent-cli
git commit -m "feat: add agent command registry runtime"
```

---

## Task 5: Read-Only Commands and `window.app` Bootstrap

**Files:**
- Create: `src/features/agent-cli/adapters/gantt-adapter.js`
- Create: `src/features/agent-cli/commands/state.js`
- Create: `src/features/agent-cli/commands/task.js`
- Create: `src/features/agent-cli/commands/link.js`
- Create: `src/features/agent-cli/discovery/index.js`
- Create: `src/features/agent-cli/runtime/api-builder.js`
- Create: `src/features/agent-cli/index.js`
- Modify: `src/main.js`
- Test: `tests/unit/agent-cli/read-only-commands.test.js`
- Test: `tests/unit/agent-cli/api-builder.test.js`
- Test: `tests/e2e/agent-cli.spec.js`

- [ ] **Step 1: Write read-only command tests**

Test that `state.rev`, `state.snapshot`, `task.get`, `task.list`, `task.today`, `task.overdue`, and `link.list` return deterministic data from a mocked Gantt adapter and do not bump rev.

- [ ] **Step 2: Write API builder tests**

Assert the registry command `task.list` becomes `app.task.list(args)` and calls shared dispatch with `task.list`.

- [ ] **Step 3: Write discovery test**

Assert discovery sets:

```html
<html data-agent-api="window.app">
<meta name="agent-api" content="window.app.help()">
```

- [ ] **Step 4: Run failing tests**

Run:

```bash
npx vitest run tests/unit/agent-cli/read-only-commands.test.js tests/unit/agent-cli/api-builder.test.js
```

Expected: FAIL because commands/bootstrap do not exist.

- [ ] **Step 5: Implement Gantt adapter**

Create read-only helpers that wrap global `window.gantt` but accept an injected `gantt` in tests:

```js
export function createGanttAdapter(gantt = globalThis.gantt) {
    return {
        getTask(id) {
            return gantt.getTask(id);
        },
        getTasks() {
            const tasks = [];
            gantt.eachTask((task) => tasks.push({ ...task }));
            return tasks;
        },
        getLinks() {
            return typeof gantt.getLinks === 'function' ? gantt.getLinks().map((link) => ({ ...link })) : [];
        },
        serialize() {
            return gantt.serialize();
        },
    };
}
```

- [ ] **Step 6: Implement `initAgentCli()`**

Create `src/features/agent-cli/index.js` with:

```js
import { buildApi } from './runtime/api-builder.js';
import { injectAgentDiscovery } from './discovery/index.js';
import { registerTaskCommands } from './commands/task.js';
import { registerStateCommands } from './commands/state.js';
import { registerLinkCommands } from './commands/link.js';

export function initAgentCli(options = {}) {
    registerStateCommands();
    registerTaskCommands();
    registerLinkCommands();

    const app = buildApi(options);
    globalThis.app = app;
    injectAgentDiscovery();
    return app;
}
```

- [ ] **Step 7: Bootstrap from main**

In `src/main.js`, import and call after Gantt initialization is ready:

```js
import { initAgentCli } from './features/agent-cli/index.js';
```

Then:

```js
initAgentCli();
```

- [ ] **Step 8: Verify read-only surface**

Run:

```bash
npx vitest run tests/unit/agent-cli/read-only-commands.test.js tests/unit/agent-cli/api-builder.test.js
npx playwright test tests/e2e/agent-cli.spec.js
```

Expected:
- Vitest PASS.
- Playwright can evaluate `window.app.help()` and `window.app.state.snapshot({ level: 'summary' })`.

- [ ] **Step 9: Commit**

```bash
git add src/features/agent-cli src/main.js tests/unit/agent-cli tests/e2e/agent-cli.spec.js
git commit -m "feat: expose read-only agent command layer"
```

---

## Task 6: Task Write Commands with Dry-Run, Diff, Undo, and Log

**Files:**
- Create: `src/features/gantt/domain/task-ops.js`
- Create: `src/features/agent-cli/runtime/dispatch.js`
- Create: `src/features/agent-cli/runtime/log.js`
- Modify: `src/features/agent-cli/commands/task.js`
- Create: `src/features/agent-cli/commands/session.js`
- Test: `tests/unit/gantt/domain/task-ops.test.js`
- Test: `tests/unit/agent-cli/dispatch-write.test.js`
- Test: `tests/unit/agent-cli/session.test.js`

- [ ] **Step 1: Write task op tests**

Assert:
- `taskOps.create.plan()` returns a diff with `created` and does not call `gantt.addTask`.
- `taskOps.create.commit()` calls `gantt.addTask`.
- `taskOps.update.plan()` reports old/new field values.
- `taskOps.delete.plan()` returns all cascade ids when `cascade: true`.

- [ ] **Step 2: Write dispatch write tests**

Assert:
- `dryRun: true` returns diff and does not call transaction or persist.
- Successful write bumps rev once.
- Failed write rolls back and does not bump rev.
- `ifRev` mismatch returns `CONFLICT` before transaction.
- Command log records `{ seq, ts, name, args, ok, rev, ms }`.

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run tests/unit/gantt/domain/task-ops.test.js tests/unit/agent-cli/dispatch-write.test.js tests/unit/agent-cli/session.test.js
```

Expected: FAIL because write dispatch and task ops are not implemented.

- [ ] **Step 4: Implement dispatch write contract**

Write commands use this sequence exactly:

```js
const plan = command.op.plan(resolvedArgs, ctx);

if (opts.dryRun || resolvedArgs.dryRun) {
    return ok({ diff: plan.diff }, getProjectRev(ctx.projectId));
}

if (opts.ifRev !== undefined && opts.ifRev !== getProjectRev(ctx.projectId)) {
    return fail('CONFLICT', 'Project revision changed.', {
        hint: 'Call state.rev or state.snapshot, then retry with the latest rev.',
        rev: getProjectRev(ctx.projectId),
    });
}

const txResult = await runGanttTransaction({
    gantt: ctx.gantt,
    work: async () => command.op.commit(plan, ctx),
});
```

After successful transaction, call `settleAndPersist()`, bump rev, log, and return `diff`.

- [ ] **Step 5: Implement task commands**

Add registrations for:
- `task.create`
- `task.update`
- `task.delete`

Each command must have JSON Schema with `additionalProperties: false`.

- [ ] **Step 6: Implement session commands**

Add:
- `session.undo`
- `session.redo`
- `session.history`
- `session.log`

These reuse `undoManager` and command log; undo/redo must return the current rev and a meaningful `data` payload.

- [ ] **Step 7: Verify task write behavior**

Run:

```bash
npx vitest run tests/unit/gantt/domain/task-ops.test.js tests/unit/agent-cli/dispatch-write.test.js tests/unit/agent-cli/session.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/gantt/domain/task-ops.js src/features/agent-cli tests/unit/gantt/domain/task-ops.test.js tests/unit/agent-cli
git commit -m "feat: add agent task write commands"
```

---

## Task 7: Hierarchy, Link, and Schedule Commands

**Files:**
- Create: `src/features/gantt/domain/hierarchy-ops.js`
- Create: `src/features/gantt/domain/link-ops.js`
- Create: `src/features/gantt/domain/schedule-ops.js`
- Create: `src/features/agent-cli/commands/hierarchy.js`
- Modify: `src/features/agent-cli/commands/link.js`
- Create: `src/features/agent-cli/commands/schedule.js`
- Test: `tests/unit/gantt/domain/hierarchy-ops.test.js`
- Test: `tests/unit/gantt/domain/link-ops.test.js`
- Test: `tests/unit/gantt/domain/schedule-ops.test.js`
- Test: `tests/unit/agent-cli/project-commands.test.js`

- [ ] **Step 1: Write hierarchy tests**

Assert:
- `hierarchy.move` changes parent and optional ordering.
- `hierarchy.indent` moves under previous sibling.
- `hierarchy.outdent` moves to parent sibling level.
- Each op returns a diff and supports dry-run without mutating real Gantt.

- [ ] **Step 2: Write link tests**

Assert:
- `link.add` rejects cycles with `CYCLE`.
- `link.add` accepts `fs`, `ss`, `ff`, `sf`.
- `link.remove` works by id or `{ source, target }`.
- `link.list` can filter by task id.

- [ ] **Step 3: Write schedule tests**

Assert:
- `schedule.setDates` validates that at least one of `start`, `end`, `duration` is present.
- `schedule.move` shifts start/end by working days through existing scheduler/date utilities where available.
- `schedule.recalc` calls the awaitable scheduler path.

- [ ] **Step 4: Run failing tests**

Run:

```bash
npx vitest run tests/unit/gantt/domain/hierarchy-ops.test.js tests/unit/gantt/domain/link-ops.test.js tests/unit/gantt/domain/schedule-ops.test.js tests/unit/agent-cli/project-commands.test.js
```

Expected: FAIL because ops and command registrations are incomplete.

- [ ] **Step 5: Implement hierarchy ops**

Use Gantt methods already used by the app for move/indent/outdent. If no direct wrapper exists, encapsulate the `gantt.moveTask` behavior inside `hierarchy-ops.js`; do not call it from command handlers.

- [ ] **Step 6: Implement link ops with cycle detection**

Build cycle detection over serialized links before calling `gantt.addLink()`. Return:

```js
{
    ok: false,
    error: {
        code: 'CYCLE',
        message: 'Dependency would create a cycle.',
        hint: 'Remove or reverse an existing dependency, then retry link.add.',
    },
}
```

- [ ] **Step 7: Implement schedule ops**

Use the existing scheduler functions from `src/features/gantt/scheduler.js`; do not duplicate scheduling rules in `agent-cli`.

- [ ] **Step 8: Verify project write commands**

Run:

```bash
npx vitest run tests/unit/gantt/domain/hierarchy-ops.test.js tests/unit/gantt/domain/link-ops.test.js tests/unit/gantt/domain/schedule-ops.test.js tests/unit/agent-cli/project-commands.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/gantt/domain src/features/agent-cli/commands tests/unit/gantt/domain tests/unit/agent-cli
git commit -m "feat: add agent hierarchy link schedule commands"
```

---

## Task 8: Atomic Batch, `$ref`, and `ifRev`

**Files:**
- Modify: `src/features/agent-cli/runtime/dispatch.js`
- Modify: `src/features/agent-cli/runtime/guards.js`
- Modify: `src/features/agent-cli/runtime/result.js`
- Test: `tests/unit/agent-cli/batch.test.js`

- [ ] **Step 1: Write batch tests**

Create tests for:
- Batch success bumps rev once.
- Batch failure rolls back all changes.
- `$ref` resolves left-to-right from `as`.
- Batch dry-run returns merged diff and does not mutate.
- `ifRev` is checked before transaction.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run tests/unit/agent-cli/batch.test.js
```

Expected: FAIL because batch is not implemented.

- [ ] **Step 3: Implement `$ref` resolver**

Resolver rules:
- References must start with `$`.
- A reference resolves to the created id returned by an earlier step with matching `as`.
- Unknown references return `BAD_ARGS` with a hint naming the missing alias.

- [ ] **Step 4: Implement `app.batch()`**

Batch dispatch must:
- Plan every step first.
- For dry-run, return merged diff.
- For real execution, use one project transaction.
- Run `settleAndPersist()` once at the end.
- Bump rev once.
- Return per-step data and merged diff.

- [ ] **Step 5: Verify batch**

Run:

```bash
npx vitest run tests/unit/agent-cli/batch.test.js tests/unit/agent-cli/dispatch-write.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/agent-cli/runtime tests/unit/agent-cli/batch.test.js
git commit -m "feat: add atomic agent batch commands"
```

---

## Task 9: Security Switches, Read-Only Mode, and Discovery Hardening

**Files:**
- Modify: `src/features/agent-cli/index.js`
- Modify: `src/features/agent-cli/runtime/dispatch.js`
- Modify: `src/features/agent-cli/discovery/index.js`
- Modify: `src/main.js`
- Test: `tests/unit/agent-cli/security.test.js`
- Test: `tests/e2e/agent-cli.spec.js`

- [ ] **Step 1: Write security tests**

Assert:
- `initAgentCli({ enabled: false })` does not expose `window.app`.
- `initAgentCli({ readOnly: true })` exposes read commands and rejects mutating commands with `CONSTRAINT`.
- Cloud sync is skipped unless a mutating command passes `sync: true`.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run tests/unit/agent-cli/security.test.js
```

Expected: FAIL until switches are implemented.

- [ ] **Step 3: Implement enable/read-only options**

Options source order:
1. Explicit `initAgentCli(options)`.
2. URL parameter for local/manual testing.
3. Default enabled, read-write, as specified.

Read-only rejection should return:

```js
{
    ok: false,
    error: {
        code: 'CONSTRAINT',
        message: 'Agent command layer is read-only.',
        hint: 'Use read commands only or enable write mode in app configuration.',
    },
}
```

- [ ] **Step 4: Verify security**

Run:

```bash
npx vitest run tests/unit/agent-cli/security.test.js tests/unit/agent-cli/dispatch-write.test.js
npx playwright test tests/e2e/agent-cli.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/agent-cli src/main.js tests/unit/agent-cli/security.test.js tests/e2e/agent-cli.spec.js
git commit -m "feat: add agent command security controls"
```

---

## Task 10: Existing AI Tool Convergence

> **Post-implementation decision (2026-07-04, accepted).** Task 10 as shipped in
> `c43bab5` is a *deliberate partial* convergence, and this is an accepted state
> rather than an outstanding defect:
>
> - **What converged.** The AI write paths (`DiffConfirmModal.applySelectedChanges`
>   and `aiService.applyToTask`) now share the same *transaction primitives* as the
>   command layer: `runGanttTransaction` + history snapshot/restore, a command undo
>   scope, `settleAndPersist({ source: 'ai' })`, and a single per-project `rev` bump.
>   AI writes therefore gain the same transaction, persistence, undo-scope, and
>   rev-visibility semantics as agent commands, and this is locked in by
>   `tests/unit/ai/ai-write-convergence.test.js`.
> - **What did NOT converge.** These paths do **not** import `domain/task-ops` or
>   call `dispatch(name, args, { source: 'ai' })`. They keep their own row engine
>   (`applyRows`) and single-field text writer.
> - **Why the deferral is accepted.** `applyRows` carries behavior the single-op
>   command path does not model: per-row *partial-apply* (one bad row must not roll
>   back the rest), add/update reconciliation against existing tasks, and
>   forward-parent/node-id resolution; `applyToTask` must keep a *synchronous
>   boolean* contract. Rebuilding these on top of `dispatch`/`task-ops` pre-release
>   is higher-risk than the value it returns.
>
> **Net:** spec §8 / M5 "不再两套维护" is satisfied at the level of a **shared
> transaction primitive**, not a shared **command layer**. Full command-layer
> convergence of the AI row engine is explicitly **deferred** (tracked as future
> work); the fire-and-forget settle inside `applyToTask` is intentional and scoped
> to that path's synchronous contract, not the command-layer async-settle rule
> (§7.6). See the Final Acceptance Checklist note below.

**Files:**
- Modify: `src/features/ai/tools/registry.js`
- Modify: `src/features/ai/tools/taskTools.js`
- Modify: `src/features/ai/tools/analysisTools.js`
- Modify: `src/features/ai/tools/calendarTools.js`
- Test: `tests/unit/ai/tools/registry.test.js`
- Test: `tests/unit/ai/tools/task-tools-hierarchy.test.js`
- Test: `tests/unit/ai/tools/analysis-tools.test.js`

- [ ] **Step 1: Write convergence tests**

Assert:
- Existing AI task write tools call command dispatch or domain ops instead of direct `gantt.updateTask()` paths.
- Existing read tools preserve current response shape.
- Existing tests for AI router and tools still pass.

- [ ] **Step 2: Run current AI tests**

Run:

```bash
npx vitest run tests/unit/ai/tools/registry.test.js tests/unit/ai/tools/task-tools-hierarchy.test.js tests/unit/ai/tools/analysis-tools.test.js tests/unit/ai/agent/router.test.js
```

Expected: PASS before refactor.

- [ ] **Step 3: Replace write paths with command/domain calls**

For each AI write tool:
- Keep public tool name and returned text stable.
- Call `dispatch(name, args, { source: 'ai' })` or a domain op through dispatch.
- Do not import `features/agent-cli` from `features/gantt/domain`.

- [ ] **Step 4: Verify AI convergence**

Run:

```bash
npx vitest run tests/unit/ai/tools/registry.test.js tests/unit/ai/tools/task-tools-hierarchy.test.js tests/unit/ai/tools/analysis-tools.test.js tests/unit/ai/agent/router.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/ai/tools tests/unit/ai/tools
git commit -m "refactor: route ai tools through shared command layer"
```

---

## Task 11: Golden Manifest, E2E Smoke, and Full Verification

**Files:**
- Create: `tests/unit/agent-cli/manifest-golden.test.js`
- Create: `tests/unit/agent-cli/__snapshots__/manifest-golden.test.js.snap` if Vitest snapshot output is used
- Modify: `tests/e2e/agent-cli.spec.js`

- [ ] **Step 1: Add manifest golden test**

Assert the manifest contains all v1 commands:
- `task.get`
- `task.list`
- `task.today`
- `task.overdue`
- `task.create`
- `task.update`
- `task.delete`
- `hierarchy.move`
- `hierarchy.indent`
- `hierarchy.outdent`
- `link.add`
- `link.remove`
- `link.list`
- `schedule.setDates`
- `schedule.move`
- `schedule.recalc`
- `state.snapshot`
- `state.export`
- `state.rev`
- `session.undo`
- `session.redo`
- `session.history`
- `session.log`
- `batch`

- [ ] **Step 2: Expand E2E smoke**

In `tests/e2e/agent-cli.spec.js`, verify:
- `window.app.help()` returns command index.
- `window.app.task.create({ name: 'Agent task', duration: 1 })` creates a visible task.
- `window.app.task.update({ id, name: 'Agent task updated' })` updates the task.
- `window.app.batch([...])` creates a parent and child in one rev bump.
- `window.app.session.undo()` reverts the batch.

- [ ] **Step 3: Run targeted command suite**

Run:

```bash
npx vitest run tests/unit/agent-cli tests/unit/gantt/domain
```

Expected: PASS.

- [ ] **Step 4: Run E2E command smoke**

Run:

```bash
npx playwright test tests/e2e/agent-cli.spec.js
```

Expected: PASS in Chromium.

- [ ] **Step 5: Run full required verification before final commit**

Run:

```bash
npm test
```

Expected: PASS.

Run:

```bash
npm run lint
npm run format:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/agent-cli tests/e2e/agent-cli.spec.js
git commit -m "test: cover agent command layer contract"
```

---

## Final Acceptance Checklist

- [ ] `window.app` is available after app initialization.
- [ ] `window.app.exec()`, structured API calls, `help()`, and `manifest()` are generated from the same registry.
- [ ] Read commands do not bump rev.
- [ ] Mutating single commands bump rev once on success.
- [ ] Mutating batch bumps rev once for the whole batch.
- [ ] Rollback does not bump rev.
- [ ] `dryRun` never mutates real Gantt state.
- [ ] Every mutating command returns a canonical `diff`.
- [ ] `ifRev` conflict is checked before transaction snapshot.
- [ ] `settleAndPersist()` resolves only after scheduler recalculation and local persistence.
- [ ] Agent writes skip cloud sync by default.
- [ ] `sync:true` is the only command path that permits cloud sync.
- [ ] Existing BYOK AI still works.
- [x] Existing AI write tools share the command layer's transaction primitives
      (transaction + settle + rev + undo scope). Full routing through
      `dispatch`/`domain/task-ops` for the AI row engine is a deferred follow-up —
      see the "Post-implementation decision" note under Task 10.
- [ ] Playwright proves external-agent style `page.evaluate(() => window.app...)` can observe and mutate the UI.

## Self-Review

Spec coverage:
- Goals §1.3 are covered by Tasks 4-6 and 11.
- Domain layer and dispatch pipeline §3-5 are covered by Tasks 2-8.
- v1 command list §6 is covered by Tasks 5-8 and 11.
- Runtime contracts §7 are covered by Tasks 2-9 and 11.
- AI coexistence/convergence §8 is covered by Task 10.
- Security §9 is covered by Tasks 3 and 9.
- Testing strategy §10 is covered by Tasks 0-11.
- Milestones §11 map to this plan as: M0 = Tasks 1-3, M1 = Tasks 4-5, M2 = Task 6, M3 = Task 7, M4 = Task 8, M5 = Tasks 9-11.

Known execution risks:
- The exact `gantt.moveTask` and scheduler APIs must be confirmed during Task 7 against current DHTMLX usage.
- Autosave local-only behavior needs careful browser verification because debounce timing can hide bugs.
- Moving `undoManager` may require compatibility re-export if too many existing imports are affected; prefer updating imports, but add a temporary re-export only if required to avoid a large unrelated churn.

No v1 plan item creates `/llms.txt` or any `public/` file.
