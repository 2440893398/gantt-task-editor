# Task Confirm And Fixed Actions Column Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add confirmation-first task editing and a fixed right-most actions column (edit/delete) across split/table/gantt views while reducing unnecessary rerenders.

**Architecture:** Introduce a panel-level draft model (`draftTask`) that buffers all form edits until explicit confirm, then commits changes in one update call. Extend grid columns with a dedicated `actions` column and keep it present in all view modes, including gantt-only mode. Reuse shared confirm dialogs for discard and delete to keep behavior consistent.

**Tech Stack:** Vanilla JS modules, DHTMLX Gantt, Vitest, existing i18n/toast/confirm-dialog utilities.

---

## Skills To Apply During Execution

- `@superpowers:test-driven-development`
- `@superpowers:verification-before-completion`

### Task 1: Add failing tests for confirmation-based editing

**Files:**
- Modify: `tests/unit/task-details/panel.test.js` (create if missing)
- Test: `tests/unit/task-details/panel.test.js`

**Step 1: Write the failing test**

```js
it('does not persist field edits until confirm is clicked', () => {
  // open panel -> change title/assignee
  // assert gantt.updateTask not called yet
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/task-details/panel.test.js`
Expected: FAIL because current behavior persists on blur/change.

**Step 3: Write minimal implementation**

Implement draft buffering in panel bindings so field changes only modify draft state.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/task-details/panel.test.js`
Expected: PASS for draft buffering case.

**Step 5: Commit**

```bash
git add tests/unit/task-details/panel.test.js src/features/task-details/panel.js src/features/task-details/left-section.js src/features/task-details/right-section.js
git commit -m "test(task-details): cover draft-only edits before confirm"
```

### Task 2: Add confirm/cancel footer and one-shot commit behavior

**Files:**
- Modify: `src/features/task-details/panel.js`
- Modify: `src/features/task-details/left-section.js`
- Modify: `src/features/task-details/right-section.js`
- Test: `tests/unit/task-details/panel.test.js`

**Step 1: Write the failing test**

```js
it('commits all draft changes once when confirm save is clicked', () => {
  // edit multiple fields
  // click confirm
  // assert single update path + task values updated
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/task-details/panel.test.js`
Expected: FAIL because no confirm footer and no one-shot commit.

**Step 3: Write minimal implementation**

Add panel footer buttons and commit pipeline:
- compare `draftTask` vs source,
- apply changed fields,
- call one `gantt.updateTask(task.id)` when changed.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/task-details/panel.test.js`
Expected: PASS for confirm-save path.

**Step 5: Commit**

```bash
git add src/features/task-details/panel.js src/features/task-details/left-section.js src/features/task-details/right-section.js tests/unit/task-details/panel.test.js
git commit -m "feat(task-details): add draft confirm/cancel save workflow"
```

### Task 3: Add discard confirmation on close with unsaved draft

**Files:**
- Modify: `src/features/task-details/panel.js`
- Test: `tests/unit/task-details/panel.test.js`

**Step 1: Write the failing test**

```js
it('asks for discard confirmation when closing with unsaved draft', () => {
  // edit draft
  // attempt close
  // expect showConfirmDialog called and close conditional
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/task-details/panel.test.js`
Expected: FAIL because panel currently closes directly.

**Step 3: Write minimal implementation**

Add dirty-check and confirm-dialog guard for overlay click, ESC, close button, and parent-task navigation transitions.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/task-details/panel.test.js`
Expected: PASS for discard guard behavior.

**Step 5: Commit**

```bash
git add src/features/task-details/panel.js tests/unit/task-details/panel.test.js
git commit -m "feat(task-details): guard panel close with discard confirmation"
```

### Task 4: Add fixed right-most actions column and single delete action

**Files:**
- Modify: `src/features/gantt/columns.js`
- Modify: `src/styles/pages/gantt.css`
- Modify: `src/styles/main.css`
- Test: `tests/unit/gantt/column-actions.test.js` (create)

**Step 1: Write the failing test**

```js
it('adds a right-most actions column with edit and delete buttons', () => {
  // build columns
  // assert last column is actions and contains handlers/templates
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/gantt/column-actions.test.js`
Expected: FAIL because actions column does not exist.

**Step 3: Write minimal implementation**

Add `actions` column at end:
- edit action -> open details panel,
- delete action -> confirm then delete task,
- compact fixed width,
- sticky/right-fixed styling support.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/gantt/column-actions.test.js`
Expected: PASS for actions-column structure.

**Step 5: Commit**

```bash
git add src/features/gantt/columns.js src/styles/pages/gantt.css src/styles/main.css tests/unit/gantt/column-actions.test.js
git commit -m "feat(gantt): add fixed right-side actions column with single delete"
```

### Task 5: Keep actions column in gantt-only mode

**Files:**
- Modify: `src/features/gantt/columns.js`
- Modify: `src/features/gantt/view-toggle.js`
- Test: `tests/unit/gantt/view-toggle.test.js`

**Step 1: Write the failing test**

```js
it('keeps actions column visible in gantt-only mode', () => {
  // switch to gantt mode
  // assert columns include text + actions
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/gantt/view-toggle.test.js`
Expected: FAIL because gantt-only currently sets text-only columns.

**Step 3: Write minimal implementation**

Update gantt-only columns builder to include actions as right-most column and preserve fixed behavior.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/gantt/view-toggle.test.js`
Expected: PASS for gantt-only actions visibility.

**Step 5: Commit**

```bash
git add src/features/gantt/columns.js src/features/gantt/view-toggle.js tests/unit/gantt/view-toggle.test.js
git commit -m "fix(gantt-view): keep actions column in gantt-only mode"
```

### Task 6: Update new-task flow to open details draft flow reliably

**Files:**
- Modify: `index.html`
- Modify: `index.cn.html`
- Test: `tests/unit/ui/toolbar-structure.test.js`
- Test: `tests/unit/task-details/new-task-flow.test.js` (create)

**Step 1: Write the failing test**

```js
it('opens task details after creating a new task from modal', () => {
  // click new-task-btn, submit form, assert openTaskDetailsPanel called with new id
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/task-details/new-task-flow.test.js`
Expected: FAIL if flow does not always route to details consistently.

**Step 3: Write minimal implementation**

Refine inline script path:
- ensure modal submit always creates minimal task,
- ensure immediate open details with created id,
- no extra persistence side-effects beyond creation.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/task-details/new-task-flow.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add index.html index.cn.html tests/unit/task-details/new-task-flow.test.js tests/unit/ui/toolbar-structure.test.js
git commit -m "fix(new-task): route create flow consistently to details editor"
```

### Task 7: Full verification before completion

**Files:**
- Modify: none (verification only)
- Test: all touched test suites

**Step 1: Run focused suites**

Run:
- `npm test -- tests/unit/task-details/panel.test.js`
- `npm test -- tests/unit/task-details/new-task-flow.test.js`
- `npm test -- tests/unit/gantt/column-actions.test.js`
- `npm test -- tests/unit/gantt/view-toggle.test.js`

Expected: PASS.

**Step 2: Run broader guard suite**

Run: `npm test -- tests/unit`
Expected: PASS with no regressions in touched modules.

**Step 3: Build verification**

Run: `npm run build`
Expected: build succeeds.

**Step 4: Commit final adjustments**

```bash
git add .
git commit -m "feat(tasks): require confirm-save edits and add fixed row actions"
```
