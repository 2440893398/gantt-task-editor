# Parent-Child System Field Linkage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement semi-automatic parent-child linkage for system fields so parent status/workload/date stay consistent with children, while parent assignee supports manual lock override.

**Architecture:** Extract deterministic rollup rules into a dedicated module and invoke it from existing Gantt/scheduler update events. Keep updates upward-only (changed task -> ancestors), update only when values change, and preserve backward compatibility by defaulting assignee lock to false.

**Tech Stack:** Vanilla JS, DHTMLX Gantt, Vite, Vitest.

---

### Task 1: Create Rollup Engine Module

**Files:**
- Create: `src/features/gantt/parent-rollup.js`
- Test: `tests/unit/gantt/parent-rollup.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { rollupStatus } from '../../../src/features/gantt/parent-rollup.js';

describe('rollupStatus', () => {
  it('returns completed when all children are completed', () => {
    expect(rollupStatus(['completed', 'completed'])).toBe('completed');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/gantt/parent-rollup.test.js`
Expected: FAIL with missing module/function.

**Step 3: Write minimal implementation**

```js
export function rollupStatus(statuses = []) {
  if (!statuses.length) return null;
  if (statuses.every(s => s === 'completed')) return 'completed';
  if (statuses.some(s => s === 'in_progress')) return 'in_progress';
  if (statuses.some(s => s === 'suspended')) return 'suspended';
  return 'pending';
}

export function rollupAssignee(assignees = [], locked = false, currentValue = '') {
  if (locked) return currentValue;
  const uniq = [...new Set(assignees.map(v => String(v || '').trim()).filter(Boolean))];
  return uniq.length === 1 ? uniq[0] : currentValue;
}

export function sumNumberField(values = []) {
  return values.reduce((acc, v) => acc + (Number.isFinite(Number(v)) ? Number(v) : 0), 0);
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/gantt/parent-rollup.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/gantt/parent-rollup.js tests/unit/gantt/parent-rollup.test.js
git commit -m "feat(gantt): add parent-child rollup engine"
```

### Task 2: Integrate Rollup Into Parent Update Flow

**Files:**
- Modify: `src/features/gantt/scheduler.js`
- Modify: `src/features/gantt/init.js`
- Test: `tests/unit/scheduler.test.js`

**Step 1: Write the failing test**

```js
it('updates parent status and assignee after child update', async () => {
  // setup parent + children in mocked gantt
  // update child status/assignee
  // expect parent fields rolled up with chosen rules
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/scheduler.test.js`
Expected: FAIL because parent fields are not rolled up yet.

**Step 3: Write minimal implementation**

```js
// in scheduler.js updateParentDates flow:
// 1) existing date/duration rollup
// 2) gather direct children values
// 3) apply rollupStatus / rollupAssignee / sumNumberField
// 4) update parent only when changed
```

Also ensure trigger points call this same parent rollup path after add/update/delete.

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/scheduler.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/gantt/scheduler.js src/features/gantt/init.js tests/unit/scheduler.test.js
git commit -m "feat(gantt): roll up parent system fields from child tasks"
```

### Task 3: Add Assignee Lock Compatibility

**Files:**
- Modify: `src/features/task-details/right-section.js`
- Modify: `src/core/store.js`
- Test: `tests/unit/task-details/parent-assignee-lock.test.js`

**Step 1: Write the failing test**

```js
it('keeps parent assignee unchanged when parent_assignee_locked is true', () => {
  // setup parent locked state
  // child assignee changes
  // expect parent assignee unchanged
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/task-details/parent-assignee-lock.test.js`
Expected: FAIL because lock flag not respected yet.

**Step 3: Write minimal implementation**

```js
// parent_assignee_locked default false for old data
// right panel provides lock toggle for parent tasks
// scheduler rollup reads this flag before assignee overwrite
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/task-details/parent-assignee-lock.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/task-details/right-section.js src/core/store.js tests/unit/task-details/parent-assignee-lock.test.js
git commit -m "feat(task-details): support parent assignee lock for rollup"
```

### Task 4: Regression and Integration Validation

**Files:**
- Modify: `tests/features/gantt/resource-conflict.test.js`
- Modify: `tests/unit/config-io.test.js`

**Step 1: Write the failing regression tests**

```js
it('keeps parent rollup consistent after excel import', () => {
  // import start/end/status/assignee
  // expect parent fields to match rollup rules
});
```

```js
it('does not introduce extra conflict false positives after parent rollup', () => {
  // ensure parent-only aggregation does not double count
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/config-io.test.js tests/features/gantt/resource-conflict.test.js`
Expected: FAIL until integrations are complete.

**Step 3: Implement minimal glue/fixes**

```js
// adjust integration points only if needed; avoid unrelated refactor
```

**Step 4: Run full verification**

Run: `npm run test -- tests/unit/gantt/parent-rollup.test.js tests/unit/scheduler.test.js tests/unit/task-details/parent-assignee-lock.test.js tests/unit/config-io.test.js tests/features/gantt/resource-conflict.test.js`

Run: `npm run build`

Expected: All pass.

**Step 5: Commit**

```bash
git add tests/unit/gantt/parent-rollup.test.js tests/unit/scheduler.test.js tests/unit/task-details/parent-assignee-lock.test.js tests/unit/config-io.test.js tests/features/gantt/resource-conflict.test.js
git commit -m "test(gantt): add regression coverage for parent-child field linkage"
```
