# Task Scheduling Input + Calendar Date Picker + Gantt Add/Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dual schedule input (`start+duration` and `start+end`), a task-details date picker that reflects work-calendar statuses, and direct add/delete operations in gantt-only mode without changing unrelated behaviors.

**Architecture:** Keep existing task-details panel structure and gantt data model; add a small schedule-mode layer and a focused date-picker popover module. Reuse existing calendar data sources and color mapping, and extend current column action handlers instead of introducing a second action system.

**Tech Stack:** Vanilla JS (ES modules), DHTMLX Gantt, IndexedDB (Dexie via `storage.js`), Vitest.

---

### Task 1: Add Schedule Mode Calculation Utility (Pure Logic)

**Files:**
- Create: `src/features/task-details/schedule-mode.js`
- Create: `tests/unit/task-details/schedule-mode.test.js`

**Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest';
import {
    deriveFromStartAndDuration,
    deriveFromStartAndEnd,
    normalizeScheduleMode,
} from '../../../src/features/task-details/schedule-mode.js';

describe('schedule-mode utils', () => {
    it('defaults to start_duration mode', () => {
        expect(normalizeScheduleMode(undefined)).toBe('start_duration');
    });

    it('derives end date from start+duration', () => {
        const res = deriveFromStartAndDuration(new Date('2026-03-10'), 3, {
            calculateEndDate: (start, duration) => new Date('2026-03-13')
        });
        expect(res.end_date.toISOString().slice(0, 10)).toBe('2026-03-13');
    });

    it('derives duration from start+end', () => {
        const res = deriveFromStartAndEnd(new Date('2026-03-10'), new Date('2026-03-15'), {
            calculateDuration: () => 5
        });
        expect(res.duration).toBe(5);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/task-details/schedule-mode.test.js`

Expected: FAIL with module not found for `schedule-mode.js`.

**Step 3: Write minimal implementation**

```js
export function normalizeScheduleMode(value) {
    return value === 'start_end' ? 'start_end' : 'start_duration';
}

export function deriveFromStartAndDuration(startDate, duration, deps) {
    const end = deps.calculateEndDate(startDate, duration);
    return { start_date: startDate, duration, end_date: end };
}

export function deriveFromStartAndEnd(startDate, endDate, deps) {
    const duration = deps.calculateDuration(startDate, endDate);
    return { start_date: startDate, end_date: endDate, duration };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/task-details/schedule-mode.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/task-details/schedule-mode.js tests/unit/task-details/schedule-mode.test.js
git commit -m "test(task-details): cover schedule mode date derivation"
```

---

### Task 2: Integrate Dual Mode UI in Right Section (Minimal Surface Change)

**Files:**
- Modify: `src/features/task-details/right-section.js`
- Test: `tests/unit/task-details/right-section.parent-assignee-lock.test.js`
- Create: `tests/unit/task-details/right-section.schedule-mode.test.js`

**Step 1: Write the failing UI test**

```js
it('renders schedule mode selector and keeps compact workload row', async () => {
    const { renderRightSection } = await import('../../../src/features/task-details/right-section.js');
    const html = renderRightSection({
        id: 1,
        text: 'T1',
        start_date: new Date('2026-03-10'),
        end_date: new Date('2026-03-15'),
        duration: 5,
        schedule_mode: 'start_duration'
    });

    expect(html).toContain('task-schedule-mode');
    expect(html).toContain('计划开始');
    expect(html).toContain('计划截止');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/task-details/right-section.schedule-mode.test.js`

Expected: FAIL because selector id and mode rendering are missing.

**Step 3: Implement minimal UI + binding**

```js
// renderRightSection: insert mode row at schedule block top
${renderScheduleModeRow(task.schedule_mode)}

// bindRightSectionEvents: bind mode dropdown change
bindDropdown(panel, 'task-schedule-mode', (value) => {
    mutateDraft((target) => { target.schedule_mode = value; });
    if (!isDraftMode) task.schedule_mode = value;
    persistIfNeeded();
});
```

Rules:
- Keep existing row spacing and styles.
- Do not add long explanatory paragraphs.
- Preserve existing `duration` row behavior.

**Step 4: Run tests**

Run:
- `npm test -- --run tests/unit/task-details/right-section.schedule-mode.test.js`
- `npm test -- --run tests/unit/task-details/right-section.parent-assignee-lock.test.js`

Expected: PASS for both.

**Step 5: Commit**

```bash
git add src/features/task-details/right-section.js tests/unit/task-details/right-section.schedule-mode.test.js tests/unit/task-details/right-section.parent-assignee-lock.test.js
git commit -m "feat(task-details): add compact schedule mode selector"
```

---

### Task 3: Add Task-Details Date Picker Popover with Calendar Statuses

**Files:**
- Create: `src/features/task-details/date-picker-popover.js`
- Modify: `src/features/task-details/right-section.js`
- Modify: `src/features/calendar/mini-calendar.js` (only if needed for reuse hooks)
- Modify: `src/features/calendar/panel.css` (extract/reuse mini-calendar styles safely)
- Create: `tests/unit/task-details/date-picker-popover.test.js`

**Step 1: Write the failing test**

```js
it('opens popover from schedule date field and renders holiday/makeup/overtime/companyday legend', async () => {
    const mod = await import('../../../src/features/task-details/date-picker-popover.js');
    const host = document.createElement('div');
    document.body.appendChild(host);

    mod.openDatePickerPopover({
        anchorEl: host,
        selectedDate: '2026-03-10',
        highlights: new Map([
            ['2026-03-08', { type: 'holiday', label: '法定假日' }],
            ['2026-03-09', { type: 'makeupday', label: '补班日' }],
        ]),
        onSelect: () => {}
    });

    expect(document.body.innerHTML).toContain('法定假日');
    expect(document.body.innerHTML).toContain('补班日');
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/task-details/date-picker-popover.test.js`

Expected: FAIL due to missing popover module.

**Step 3: Implement popover and data wiring**

```js
// open popover from click on [data-date-field]
panel.querySelectorAll('[data-date-field]').forEach((el) => {
    el.addEventListener('click', () => openDatePickerPopover({...}));
});
```

Implementation constraints:
- Reuse calendar status colors from existing work-calendar behavior.
- No business rule duplication; pull highlight data from existing storage/calendar functions.
- Keep interaction local (open, select, close) without changing unrelated panel behavior.

**Step 4: Run tests**

Run:
- `npm test -- --run tests/unit/task-details/date-picker-popover.test.js`
- `npm test -- --run tests/unit/task-details/panel.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/task-details/date-picker-popover.js src/features/task-details/right-section.js src/features/calendar/mini-calendar.js src/features/calendar/panel.css tests/unit/task-details/date-picker-popover.test.js tests/unit/task-details/panel.test.js
git commit -m "feat(task-details): add calendar-aware date picker popover"
```

---

### Task 4: Implement Mode-Based Date/Duration Recalculation in Right Section

**Files:**
- Modify: `src/features/task-details/right-section.js`
- Modify: `src/features/task-details/schedule-mode.js`
- Create: `tests/unit/task-details/right-section.date-recalc.test.js`

**Step 1: Write failing behavior tests**

```js
it('recalculates end_date when start_date changes in start_duration mode', async () => {
    // simulate start date change and assert end_date updated
});

it('recalculates duration when end_date changes in start_end mode', async () => {
    // simulate end date change and assert duration updated
});
```

**Step 2: Run to verify failures**

Run: `npm test -- --run tests/unit/task-details/right-section.date-recalc.test.js`

Expected: FAIL with wrong/unchanged duration or end_date.

**Step 3: Implement minimal logic path**

```js
const mode = normalizeScheduleMode(draftTask.schedule_mode);
if (mode === 'start_duration') {
    // start change => calculate end
}
if (mode === 'start_end') {
    // end change => calculate duration
}
```

Preserve existing inclusive/exclusive handling for end dates.

**Step 4: Run tests**

Run:
- `npm test -- --run tests/unit/task-details/right-section.date-recalc.test.js`
- `npm test -- --run tests/unit/task-details/right-section.schedule-mode.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/task-details/right-section.js src/features/task-details/schedule-mode.js tests/unit/task-details/right-section.date-recalc.test.js tests/unit/task-details/right-section.schedule-mode.test.js
git commit -m "feat(task-details): recalc dates by selected schedule mode"
```

---

### Task 5: Add Gantt-Only Add/Delete Affordances (Without Breaking Existing Grid Actions)

**Files:**
- Modify: `src/features/gantt/columns.js`
- Modify: `src/features/gantt/init.js`
- Modify: `src/features/gantt/view-toggle.js` (only if wiring needed)
- Modify: `src/styles/pages/gantt.css`
- Create: `tests/unit/gantt/gantt-only-actions.test.js`
- Modify: `tests/unit/gantt/column-actions.test.js`

**Step 1: Write failing tests**

```js
it('renders add-child and delete actions in gantt-only grid actions cell', async () => {
    // expect data-action="add-child" and data-action="delete"
});

it('opens new task flow from timeline empty-area action', async () => {
    // expect window.openNewTaskDetailsPanel called
});
```

**Step 2: Run tests to confirm failure**

Run: `npm test -- --run tests/unit/gantt/column-actions.test.js tests/unit/gantt/gantt-only-actions.test.js`

Expected: FAIL on missing `add-child` action and missing empty-area flow.

**Step 3: Implement minimal behavior**

```js
// columns.js
if (action === 'add-child') {
    window.openNewTaskDetailsPanel?.({ parent: taskId, start_date: task.start_date, duration: 1 });
}

// init.js (timeline empty-area)
gantt.attachEvent('onEmptyClick', (date, e) => {
    if (e?.button === 2) {
        window.openNewTaskDetailsPanel?.({ start_date: date, duration: 1 });
        return false;
    }
    return true;
});
```

Keep existing delete/edit behavior intact.

**Step 4: Run tests**

Run:
- `npm test -- --run tests/unit/gantt/column-actions.test.js`
- `npm test -- --run tests/unit/gantt/gantt-only-actions.test.js`
- `npm test -- --run tests/unit/gantt/view-toggle.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/gantt/columns.js src/features/gantt/init.js src/features/gantt/view-toggle.js src/styles/pages/gantt.css tests/unit/gantt/column-actions.test.js tests/unit/gantt/gantt-only-actions.test.js tests/unit/gantt/view-toggle.test.js
git commit -m "feat(gantt): add gantt-only add/delete task affordances"
```

---

### Task 6: Align Delete Copy With Existing Undo Capability

**Files:**
- Modify: `src/locales/zh-CN.js`
- Modify: `src/locales/en-US.js`
- Modify: `src/locales/ja-JP.js`
- Modify: `src/locales/ko-KR.js`
- Modify: `tests/unit/i18n/delete-confirm-modal.test.js`

**Step 1: Write failing i18n test**

```js
it('delete confirmation copy should indicate undo availability', () => {
    expect(zh.message.confirmDelete).toContain('Ctrl+Z');
});
```

**Step 2: Run test and verify fail**

Run: `npm test -- --run tests/unit/i18n/delete-confirm-modal.test.js`

Expected: FAIL because copy still says cannot undo.

**Step 3: Update copy minimally**

```js
confirmDelete: '确定要删除此任务吗？可通过 Ctrl+Z 撤销。'
```

Do equivalent semantics for EN/JA/KO locale files.

**Step 4: Run tests**

Run: `npm test -- --run tests/unit/i18n/delete-confirm-modal.test.js`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/locales/zh-CN.js src/locales/en-US.js src/locales/ja-JP.js src/locales/ko-KR.js tests/unit/i18n/delete-confirm-modal.test.js
git commit -m "fix(i18n): align delete confirmation with undo behavior"
```

---

### Task 7: Regression Verification + Build

**Files:**
- No code changes unless failures occur

**Step 1: Run focused unit suite**

Run:

```bash
npm test -- --run tests/unit/task-details/schedule-mode.test.js tests/unit/task-details/right-section.schedule-mode.test.js tests/unit/task-details/date-picker-popover.test.js tests/unit/task-details/right-section.date-recalc.test.js tests/unit/gantt/column-actions.test.js tests/unit/gantt/gantt-only-actions.test.js tests/unit/gantt/view-toggle.test.js tests/unit/i18n/delete-confirm-modal.test.js
```

Expected: all PASS.

**Step 2: Run project unit tests once**

Run: `npm test -- --run`

Expected: PASS without unrelated regressions.

**Step 3: Run production build**

Run: `npm run build`

Expected: build succeeds.

**Step 4: Commit verification evidence (if doc log is used)**

```bash
git add doc/testdoc/ || true
git commit -m "test: verify schedule mode and gantt action regressions"
```

---

### Notes for Execution

- Use `@test-driven-development` while implementing each task.
- If any test fails unexpectedly, switch to `@systematic-debugging` before patching.
- Keep scope narrow: only task-details schedule/date interaction, calendar-aware date picker, and gantt add/delete affordances.
- Do not refactor unrelated modules.
