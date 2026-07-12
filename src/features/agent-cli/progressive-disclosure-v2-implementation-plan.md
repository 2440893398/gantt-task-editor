# Agent CLI v2 Progressive Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent CLI v1 contract with a discoverable v2 protocol that exposes dynamic task-form, schedule, calendar, and hierarchy knowledge, validates writes from shared domain services, and guides recovery through read-only next actions.

**Architecture:** Static command metadata stays in the Agent CLI registry; dynamic business knowledge moves into UI-independent services under the owning feature. Commands adapt those services to a v2 API with inclusive user-facing dates. Batch and operation remain orchestration layers and consume command metadata rather than interpreting arbitrary values.

**Tech Stack:** Vanilla ES modules, Vitest/jsdom, DHTMLX Gantt global, Dexie through `src/core/storage.js`, Vite 5.

## Global Constraints

- This is a Tier 3 change under `docs/ai-development-quality-gates.md`.
- Do not preserve Agent CLI v1 parameter or manifest compatibility.
- Do not import DHTMLX as a module or access Dexie outside `src/core/storage.js`.
- Do not add DHTMLX event listeners or modify `src/core/store.js` / `src/core/storage.js` without preserving the already-approved project-switch behavior.
- Use named ES module exports, `.js` import suffixes, four-space indentation, and single quotes.
- Every behavior change starts with a failing targeted test and ends with a focused commit.
- Preserve unrelated working-tree changes; stage only files named by the active task.

---

## File Map

**Create**

- `src/features/agent-cli/runtime/read-action.js` — validates and constructs static discovery and runtime next actions.
- `src/features/customFields/task-form-schema.js` — builds normalized task-form schemas and revisions.
- `src/features/customFields/task-value-validator.js` — validates create/update/query/export values against schemas.
- `src/features/gantt/domain/schedule-policy.js` — describes and revisions all scheduling inputs.
- `src/features/calendar/calendar-query.js` — range-scoped calendar/settings/leave reads.
- `src/features/gantt/domain/hierarchy-context.js` — minimal ancestor, sibling, and subtree context.
- `src/features/agent-cli/commands/form.js` — `form.describe/field/options`.
- `src/features/agent-cli/commands/calendar.js` — `calendar.describe`.
- `tests/unit/agent-cli/manifest-v2.test.js`
- `tests/unit/agent-cli/form-commands.test.js`
- `tests/unit/agent-cli/schedule-calendar-discovery.test.js`
- `tests/unit/agent-cli/hierarchy-inspect.test.js`
- `tests/unit/agent-cli/task-v2.test.js`
- `tests/unit/agent-cli/batch-v2.test.js`
- `tests/unit/agent-cli/error-navigation.test.js`

**Modify**

- `src/features/agent-cli/registry.js`, `runtime/manifest.js`, `runtime/result.js`, `runtime/api-builder.js`
- `src/features/agent-cli/runtime/guards.js`, `runtime/dispatch.js`, `runtime/operations.js`
- `src/features/agent-cli/commands/task.js`, `schedule.js`, `hierarchy.js`, `state.js`, `index.js`
- `src/features/gantt/domain/task-ops.js`, `schedule-ops.js`
- `src/features/ai/tools/analysisTools.js`, `calendarTools.js`
- `src/features/agent-cli/ui/AgentGuidePanel.js`, discovery scripts and matching tests.

---

### Task 0: Land the Existing Project-Switch Baseline

**Files:**

- Modify/commit: `.gitignore`, `src/core/project-mutation-gate.js`, `src/core/storage.js`, `src/core/store.js`, `src/main.js`
- Modify/commit: `src/features/agent-cli/index.js`, `runtime/api-builder.js`, `runtime/dispatch.js`, `commands/project.js`, `ui/AgentGuidePanel.js`
- Test/commit: `tests/unit/store-projects.test.js`, `tests/unit/main-autosave-build.test.js`, `tests/unit/agent-cli/project-management-commands.test.js`, `project-switch-mutation-gate.test.js`, `guide-ui.test.js`

**Interfaces:**

- Produces: serialized project mutations through `runProjectMutationExclusive(fn)` and stable `project.create/list/switch` commands.

- [ ] **Step 1: Run the focused baseline tests**

Run:

```bash
npx vitest run tests/unit/store-projects.test.js tests/unit/main-autosave-build.test.js tests/unit/agent-cli/project-management-commands.test.js tests/unit/agent-cli/project-switch-mutation-gate.test.js tests/unit/agent-cli/guide-ui.test.js
```

Expected: all files pass; no project data is written under the wrong active project.

- [ ] **Step 2: Run the repository unit suite**

Run: `npm test`
Expected: exit 0. If it fails, fix only failures caused by the in-flight project-switch diff before continuing.

- [ ] **Step 3: Commit the coherent baseline only**

```bash
git add .gitignore src/core/project-mutation-gate.js src/core/storage.js src/core/store.js src/main.js src/features/agent-cli/index.js src/features/agent-cli/runtime/api-builder.js src/features/agent-cli/runtime/dispatch.js src/features/agent-cli/commands/project.js src/features/agent-cli/ui/AgentGuidePanel.js tests/unit/store-projects.test.js tests/unit/main-autosave-build.test.js tests/unit/agent-cli/project-management-commands.test.js tests/unit/agent-cli/project-switch-mutation-gate.test.js tests/unit/agent-cli/guide-ui.test.js
git commit -m "feat: add safe agent project switching"
```

### Task 1: Introduce the v2 Manifest, Help, and Read-Action Safety Contract

**Files:**

- Create: `src/features/agent-cli/runtime/read-action.js`
- Modify: `src/features/agent-cli/registry.js`, `runtime/manifest.js`, `runtime/result.js`, `runtime/api-builder.js`
- Test: `tests/unit/agent-cli/manifest-v2.test.js`, `tests/unit/agent-cli/manifest-golden.test.js`

**Interfaces:**

- Produces: `createReadAction(commandName, args, reason, { getCommand })`, v2 `manifest()`, detailed `help(name)`, compact `help()`.

- [ ] **Step 1: Write failing protocol tests**

```js
it('publishes compact v2 manifest entries and detailed help discovery', () => {
    const manifest = buildManifest([command]);
    expect(manifest.version).toBe(2);
    expect(manifest.commands[0]).not.toHaveProperty('params');
    expect(buildHelp([command], 'task.create').discovery[0].command).toBe('form.describe');
});

it('rejects a mutating next action', () => {
    expect(() => createReadAction('task.create', {}, 'unsafe', { getCommand })).toThrow(
        'must target a read-only command'
    );
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/unit/agent-cli/manifest-v2.test.js`
Expected: FAIL because v2 metadata and `createReadAction` do not exist.

- [ ] **Step 3: Implement the minimal v2 metadata path**

```js
export function createReadAction(command, args, reason, { getCommand }) {
    const target = getCommand(command);
    if (!target || target.mutating) {
        throw new Error(`[Agent CLI] nextAction must target a read-only command: ${command}`);
    }
    return { command, args: args || {}, reason };
}
```

Update public command mapping to expose `dynamic`, `supports`, `params`, `result`, `examples`,
`discovery`, and `errors` only from detailed help. Make no-arg help return a compact directory.

- [ ] **Step 4: Verify green and commit**

Run: `npx vitest run tests/unit/agent-cli/manifest-v2.test.js tests/unit/agent-cli/manifest-golden.test.js tests/unit/agent-cli/manifest.test.js`
Expected: PASS.

```bash
git add src/features/agent-cli/runtime/read-action.js src/features/agent-cli/registry.js src/features/agent-cli/runtime/manifest.js src/features/agent-cli/runtime/result.js src/features/agent-cli/runtime/api-builder.js tests/unit/agent-cli/manifest-v2.test.js tests/unit/agent-cli/manifest-golden.test.js tests/unit/agent-cli/manifest.test.js
git commit -m "feat: publish agent cli v2 discovery metadata"
```

### Task 2: Build the Shared Task-Form Schema and Validator

**Files:**

- Create: `src/features/customFields/task-form-schema.js`, `src/features/customFields/task-value-validator.js`
- Test: `tests/unit/custom-fields/task-form-schema.test.js`, `tests/unit/custom-fields/task-value-validator.test.js`

**Interfaces:**

- Produces: `buildTaskFormSchema({ mode, locale, state })`, `getTaskField(schema, key)`, `validateTaskValues({ mode, schema, values, currentTask })`.

- [ ] **Step 1: Write failing schema tests**

```js
it('deduplicates system fields and configured fields by key', () => {
    const schema = buildTaskFormSchema({ mode: 'create', state });
    expect(schema.fields.filter((field) => field.key === 'assignee')).toHaveLength(1);
    expect(schema.fields.find((field) => field.key === 'assignee')).toMatchObject({
        type: 'text',
        required: true,
        optionsAvailable: false,
    });
});

it('validates configured enum values and preserves free-text assignees', () => {
    expect(validateTaskValues({ mode: 'create', schema, values: validValues }).ok).toBe(true);
    expect(validateTaskValues({ mode: 'create', schema, values: invalidEnum }).error.code).toBe(
        'INVALID_FIELD_VALUE'
    );
});
```

- [ ] **Step 2: Verify red**

Run: `npx vitest run tests/unit/custom-fields/task-form-schema.test.js tests/unit/custom-fields/task-value-validator.test.js`
Expected: FAIL with missing modules.

- [ ] **Step 3: Implement normalized fields and deterministic revision**

Use a stable sorted JSON representation of validation-relevant properties and a deterministic
32-bit hash. Exclude localized labels from `schemaRev`. Create mode applies defaults and checks all
required fields; update mode checks supplied fields and rejects clearing a required value.

- [ ] **Step 4: Verify and commit**

Run the two new tests plus `tests/unit/field-management.test.js`. Expected: PASS.

```bash
git add src/features/customFields/task-form-schema.js src/features/customFields/task-value-validator.js tests/unit/custom-fields/task-form-schema.test.js tests/unit/custom-fields/task-value-validator.test.js tests/unit/field-management.test.js
git commit -m "feat: add shared task form schema validation"
```

### Task 3: Build Schedule, Calendar, and Hierarchy Discovery Services

**Files:**

- Create: `src/features/gantt/domain/schedule-policy.js`, `src/features/calendar/calendar-query.js`, `src/features/gantt/domain/hierarchy-context.js`
- Test: `tests/unit/agent-cli/schedule-calendar-discovery.test.js`, `hierarchy-inspect.test.js`

**Interfaces:**

- Produces: `describeSchedulePolicy({ taskId, assignee, gantt })`, `queryCalendarContext(query)`, `inspectHierarchy({ taskId, depth, gantt })`.

- [ ] **Step 1: Write failing service tests**

```js
it('changes policyRev when a scheduling exception changes', async () => {
    const before = await describeSchedulePolicy(context);
    await saveCustomDay({ date: '2026-07-15', isOffDay: true });
    const after = await describeSchedulePolicy(context);
    expect(after.policyRev).not.toBe(before.policyRev);
});

it('returns ancestor and sibling context without serializing the whole tree', () => {
    expect(inspectHierarchy({ taskId: 3, depth: 1, gantt })).toMatchObject({
        parent: 2,
        ancestors: [1, 2],
        previousSibling: null,
    });
});
```

- [ ] **Step 2: Verify red, implement through storage APIs, verify green**

Run the two tests. Expected red before implementation and PASS after. `policyRev` must include
settings, holidays, custom days, and relevant leave data; calendar query must require a range before
returning exceptions or leaves.

- [ ] **Step 3: Commit**

```bash
git add src/features/gantt/domain/schedule-policy.js src/features/calendar/calendar-query.js src/features/gantt/domain/hierarchy-context.js tests/unit/agent-cli/schedule-calendar-discovery.test.js tests/unit/agent-cli/hierarchy-inspect.test.js
git commit -m "feat: describe agent scheduling and hierarchy context"
```

### Task 4: Expose Read-Only Form, Calendar, Schedule, and Hierarchy Commands

**Files:**

- Create: `src/features/agent-cli/commands/form.js`, `commands/calendar.js`
- Modify: `commands/schedule.js`, `commands/hierarchy.js`, `index.js`
- Test: `tests/unit/agent-cli/form-commands.test.js`, `schedule-calendar-discovery.test.js`, `hierarchy-inspect.test.js`, `read-only-commands.test.js`

**Interfaces:**

- Produces: `form.describe/field/options`, `schedule.describe`, `calendar.describe`, `hierarchy.inspect`.

- [ ] **Step 1: Write failing command tests**

```js
it('progressively discloses field summaries then field detail', async () => {
    const summary = await app.form.describe({ form: 'task', mode: 'create' });
    expect(summary.data.fields[0]).not.toHaveProperty('options');
    const detail = await app.form.field({ form: 'task', mode: 'create', field: 'priority' });
    expect(detail.data.options).toEqual(
        expect.arrayContaining([{ value: 'high', label: expect.any(String) }])
    );
});
```

- [ ] **Step 2: Verify red, register minimal handlers, verify green**

Run all four test files. Expected PASS and every new command marked `mutating: false`.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-cli/commands/form.js src/features/agent-cli/commands/calendar.js src/features/agent-cli/commands/schedule.js src/features/agent-cli/commands/hierarchy.js src/features/agent-cli/index.js tests/unit/agent-cli/form-commands.test.js tests/unit/agent-cli/schedule-calendar-discovery.test.js tests/unit/agent-cli/hierarchy-inspect.test.js tests/unit/agent-cli/read-only-commands.test.js
git commit -m "feat: expose progressive agent discovery commands"
```

### Task 5: Switch Task Writes, Queries, and Exports to v2

**Files:**

- Modify: `src/features/agent-cli/commands/task.js`, `commands/state.js`
- Modify: `src/features/gantt/domain/task-ops.js`, `domain/schedule-ops.js`
- Test: `tests/unit/agent-cli/task-v2.test.js`, `state-export.test.js`, `dispatch-write.test.js`, `gantt/domain/schedule-ops.test.js`

**Interfaces:**

- Consumes: shared form validator and schedule policy.
- Produces: `task.create({ parent, values }, options)`, `task.update({ id, values }, options)`, dynamic filters, inclusive read dates, dynamic export fields.

- [ ] **Step 1: Write failing v2 task tests**

```js
it('creates a task from values and returns settled inclusive dates', async () => {
    const result = await app.task.create({
        values: { text: 'A', assignee: '张三', start_date: '2026-07-13', end_date: '2026-07-17' },
    });
    expect(result.data.task).toMatchObject({ end_date: '2026-07-17' });
});

it('supports dynamic field filters and preserves today/overdue commands', async () => {
    const result = await app.task.list({
        filters: [{ field: 'risk_level', operator: 'eq', value: 'high' }],
        fields: ['id', 'text', 'risk_level'],
    });
    expect(result.data.tasks).toHaveLength(1);
});
```

- [ ] **Step 2: Verify red, replace v1 schemas and adapters, verify green**

Single-write `schemaRev/policyRev` are optional execution options; if supplied they must match.
Always calculate a coherent internal start/end/duration before `gantt.addTask/updateTask`, and read
the final task after settle. Keep `task.today` and `task.overdue` as separate derived commands.

- [ ] **Step 3: Update state export and commit**

Run all named tests. Expected PASS.

```bash
git add src/features/agent-cli/commands/task.js src/features/agent-cli/commands/state.js src/features/gantt/domain/task-ops.js src/features/gantt/domain/schedule-ops.js tests/unit/agent-cli/task-v2.test.js tests/unit/agent-cli/state-export.test.js tests/unit/agent-cli/dispatch-write.test.js tests/unit/gantt/domain/schedule-ops.test.js
git commit -m "feat: migrate agent task operations to v2"
```

### Task 6: Make Batch References Typed and Enforce Batch Revisions

**Files:**

- Modify: `src/features/agent-cli/runtime/dispatch.js`, `registry.js`, `runtime/api-builder.js`
- Test: `tests/unit/agent-cli/batch-v2.test.js`, `batch.test.js`, `batch-real-transaction.test.js`

**Interfaces:**

- Produces: schema property marker `x-batch-ref: true`; batch options `schemaRev/policyRev`; no `$` scanning in arbitrary strings.

- [ ] **Step 1: Write failing alias safety tests**

```js
it('resolves aliases only in marked id properties', async () => {
    const result = await batch(
        [
            {
                op: 'task.create',
                as: 'root',
                args: { values: { text: '$literal', assignee: 'A' } },
            },
            {
                op: 'task.create',
                args: { parent: '$root', values: { text: 'Child', assignee: 'A' } },
            },
        ],
        context
    );
    expect(result.ok).toBe(true);
    expect(gantt.getTask(1).text).toBe('$literal');
});
```

- [ ] **Step 2: Verify red, implement schema-guided traversal, verify green**

Traverse only properties marked `x-batch-ref`. A batch containing task writes requires
`schemaRev`; scheduled values additionally require `policyRev`. Check revisions before preflight
and immediately before commit.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-cli/runtime/dispatch.js src/features/agent-cli/registry.js src/features/agent-cli/runtime/api-builder.js tests/unit/agent-cli/batch-v2.test.js tests/unit/agent-cli/batch.test.js tests/unit/agent-cli/batch-real-transaction.test.js
git commit -m "feat: enforce typed agent batch references"
```

### Task 7: Add Structured Error Navigation Across Commands

**Files:**

- Modify: `src/features/agent-cli/runtime/result.js`, `guards.js`, `dispatch.js`
- Modify: all command files touched above and `domain/hierarchy-ops.js`, `domain/link-ops.js`
- Test: `tests/unit/agent-cli/error-navigation.test.js`, `guards.test.js`, `project-commands.test.js`

**Interfaces:**

- Produces: frozen v2 code set and `error.nextAction`; `stepIndex/op` only on batch wrappers.

- [ ] **Step 1: Write failing error contract tests**

```js
it('guides invalid dynamic values to a read command', async () => {
    const result = await app.task.create({ values: invalidValues });
    expect(result.error).toMatchObject({
        code: 'INVALID_FIELD_VALUE',
        nextAction: { command: 'form.field' },
    });
    expect(result.error).not.toHaveProperty('stepIndex');
});
```

- [ ] **Step 2: Verify red, migrate ENUM and add runtime safety, verify green**

Static enum errors become `BAD_ARGS`; dynamic enum errors become `INVALID_FIELD_VALUE`. Construct
every dynamic next action through `createReadAction`; batch adds `stepIndex` and `op` when wrapping.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-cli/runtime/result.js src/features/agent-cli/runtime/guards.js src/features/agent-cli/runtime/dispatch.js src/features/agent-cli/commands src/features/gantt/domain/hierarchy-ops.js src/features/gantt/domain/link-ops.js tests/unit/agent-cli/error-navigation.test.js tests/unit/agent-cli/guards.test.js tests/unit/agent-cli/project-commands.test.js
git commit -m "feat: guide agent errors with safe next actions"
```

### Task 8: Migrate Operation, Internal AI Adapters, Discovery UI, and Guide Prompt

**Files:**

- Modify: `src/features/agent-cli/runtime/operations.js`, `ui/AgentGuidePanel.js`, `discovery/index.js`
- Modify: `src/features/ai/tools/analysisTools.js`, `calendarTools.js`
- Test: `tests/unit/agent-cli/operations.test.js`, `guide-ui.test.js`, `api-builder.test.js`
- Test: create `tests/unit/ai/tools/field-config-shape.test.js`, `calendar-info-shape.test.js`

**Interfaces:**

- Consumes: shared services and v2 command results.
- Produces: operation results that preserve nextAction; internal AI tools with unchanged output shape; v2 Agent prompt.

- [ ] **Step 1: Write failing output-shape and guide tests**

```js
it('keeps the field-info tool output shape while using the shared schema', async () => {
    const result = await executeFieldConfigTool();
    expect(result).toMatchSnapshot();
});

it('teaches help then discovery instead of source inspection', () => {
    expect(buildAgentInstruction()).toContain("help('task.create')");
    expect(buildAgentInstruction()).toContain('nextAction');
});
```

- [ ] **Step 2: Verify red, adapt consumers, verify green**

Do not expose extra shared-service fields from internal AI tools; map explicitly to their current
shape. Ensure operation status/result and visible runner render v2 errors unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/features/agent-cli/runtime/operations.js src/features/agent-cli/ui/AgentGuidePanel.js src/features/agent-cli/discovery/index.js src/features/ai/tools/analysisTools.js src/features/ai/tools/calendarTools.js tests/unit/agent-cli/operations.test.js tests/unit/agent-cli/guide-ui.test.js tests/unit/agent-cli/api-builder.test.js tests/unit/ai/tools/field-config-shape.test.js tests/unit/ai/tools/calendar-info-shape.test.js
git commit -m "feat: teach agents the v2 discovery workflow"
```

### Task 9: Full Verification and Browser Acceptance

**Files:**

- Modify only if verification reveals a v2 regression.

- [ ] **Step 1: Run focused Agent CLI and domain tests**

Run:

```bash
npx vitest run tests/unit/agent-cli tests/unit/custom-fields tests/unit/gantt/domain tests/unit/ai/tools
```

Expected: all tests pass with zero unhandled rejections.

- [ ] **Step 2: Run repository quality gate**

Run: `npm run check`
Expected: lint, format check, and unit tests pass.

- [ ] **Step 3: Run browser acceptance**

Start `npm run dev`, then verify in the browser:

1. `manifest()` → `help('task.create')` → `form.describe` → `form.field`.
2. One batch dry-run with parent alias and dynamic fields.
3. One batch commit and task readback with inclusive end date.
4. Invalid enum, stale schemaRev, stale policyRev, hierarchy cycle, and dependency cycle each return a read-only nextAction.
5. A task text beginning with `$` remains literal.
6. Project switch waits for reload and does not save data to the wrong project.
7. Read-only page rejects writes but allows discovery commands.

- [ ] **Step 4: Run full test suite and report gaps**

Run: `npm test` and `npm run build`. Expected: both exit 0. Record any untested external holiday-provider behavior explicitly.

- [ ] **Step 5: Final commit if verification required fixes**

Stage only verified fixes and commit with `fix: close agent cli v2 verification gaps`.

---

## Plan Self-Review

- Spec coverage: protocol, dynamic form, options classes, schedule/calendar revisions, hierarchy,
  task v2, typed aliases, errors, operation, internal AI, prompt, and browser acceptance are mapped.
- Placeholder scan: complete; every implementation step has a concrete action and command.
- Type consistency: form uses `schemaRev`; scheduling uses `policyRev`; single writes accept optional
  execution revisions; schema-dependent batches require them; end dates are inclusive at the API.
