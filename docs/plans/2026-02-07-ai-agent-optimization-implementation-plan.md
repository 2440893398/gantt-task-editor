# AI Agent Grounded Task Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a unified, grounded AI chat task experience with consistent task citations, mention-based task referencing, collapsible skills config, and expanded read/analyze skills.

**Architecture:** Keep AI generation flow unchanged, then normalize/augment UI in the renderer pipeline. Task references are standardized to readable hierarchy citations (`[#1.2] 任务名`) while internal IDs remain hidden. Add a dedicated mention composer layer and expand tool/skill contracts for analysis use cases.

**Tech Stack:** Vanilla JS modules, Vite, DaisyUI/Tailwind, Vercel AI SDK, Zod, Vitest, Playwright.

---

### Task 1: Citation Rules + Shared Task UI Primitives

**Files:**
- Create: `src/features/ai/renderers/task-citation.js`
- Create: `src/features/ai/renderers/task-ui.js`
- Modify: `src/features/ai/renderers/index.js`
- Modify: `src/features/ai/styles/ai-theme.css`
- Test: `tests/unit/ai/renderers/task-citation.test.js`

**Step 1: Write the failing test**

Add tests for:
- parse `[#1.2] 设计登录页面` into citation tokens,
- reject malformed citation,
- render citation token as clickable chip HTML.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/renderers/task-citation.test.js`
Expected: FAIL (module or behavior not implemented).

**Step 3: Write minimal implementation**

Implement parser + renderer helpers:
- `extractTaskCitations(text)`
- `renderTaskCitationChip({ hierarchyId, name })`
- register renderer helper usage in `renderers/index.js`.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/renderers/task-citation.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/renderers/task-citation.js src/features/ai/renderers/task-ui.js src/features/ai/renderers/index.js src/features/ai/styles/ai-theme.css tests/unit/ai/renderers/task-citation.test.js
git commit -m "feat(ai): add unified task citation parsing and chip rendering"
```

---

### Task 2: AI Drawer Integration for Grounded Reply Rendering

**Files:**
- Modify: `src/features/ai/components/AiDrawer.js`
- Modify: `src/features/ai/services/aiService.js`
- Modify: `src/features/ai/styles/ai-theme.css`
- Test: `tests/unit/ai/components/ai-drawer-citation-render.test.js`

**Step 1: Write the failing test**

Test `finishStreaming()` behavior:
- plain markdown with citations -> chip rendering,
- no citation -> unchanged markdown rendering,
- click handler hook dispatch for citation chip.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/components/ai-drawer-citation-render.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `AiDrawer.js`:
- run citation normalization after markdown parse path,
- use shared renderer helpers,
- wire click event delegation to open task details by hierarchy lookup.

In `aiService.js`:
- keep full task context for current turn (for grounding checks),
- expose context to drawer rendering hooks.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/components/ai-drawer-citation-render.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/components/AiDrawer.js src/features/ai/services/aiService.js src/features/ai/styles/ai-theme.css tests/unit/ai/components/ai-drawer-citation-render.test.js
git commit -m "feat(ai): render grounded task citations in assistant replies"
```

---

### Task 3: @ Mention Search Composer (Componentized)

**Files:**
- Create: `src/features/ai/components/mention-composer.js`
- Modify: `src/features/ai/components/AiDrawer.js`
- Create: `src/features/ai/utils/hierarchy-id.js`
- Test: `tests/unit/ai/components/mention-composer.test.js`

**Step 1: Write the failing test**

Cover:
- trigger popup on `@`,
- fuzzy search by task name and hierarchy id,
- insert mention chip,
- emit payload with `referencedTasks`.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/components/mention-composer.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement mention composer module and integrate in drawer footer input:
- popup open/close,
- keyboard navigation,
- selection chips,
- message payload augmentation.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/components/mention-composer.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/components/mention-composer.js src/features/ai/components/AiDrawer.js src/features/ai/utils/hierarchy-id.js tests/unit/ai/components/mention-composer.test.js
git commit -m "feat(ai): add @mention task search and structured reference payload"
```

---

### Task 4: Task Input Bubble Unification (Polish/Split)

**Files:**
- Modify: `src/features/ai/components/AiDrawer.js`
- Modify: `src/features/ai/renderers/index.js`
- Modify: `src/features/ai/styles/ai-theme.css`
- Test: `tests/unit/ai/components/task-input-bubble.test.js`

**Step 1: Write the failing test**

Verify same HTML class structure is used for:
- task polish input context,
- task split input context,
- mention-driven context display.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/components/task-input-bubble.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create one renderer path for task input bubble and use it across both flows.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/components/task-input-bubble.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/components/AiDrawer.js src/features/ai/renderers/index.js src/features/ai/styles/ai-theme.css tests/unit/ai/components/task-input-bubble.test.js
git commit -m "refactor(ai): unify task input bubble component across flows"
```

---

### Task 5: Tool Layer Contract Upgrade (Hierarchy + Semantic Preview)

**Files:**
- Modify: `src/features/ai/tools/taskTools.js`
- Create: `src/features/ai/tools/hierarchy.js`
- Modify: `src/features/ai/components/AiDrawer.js`
- Test: `tests/unit/ai/tools/task-tools-hierarchy.test.js`

**Step 1: Write the failing test**

Cover tool output schema:
- all task list tools include `hierarchy_id`,
- output fields are consistent enough for task-row renderer,
- semantic summary strings are generated for tool cards.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/tools/task-tools-hierarchy.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement shared helper to compute hierarchy ID from task tree and attach to every task-returning tool.

Update tool-call card rendering in drawer:
- running,
- done collapsed summary,
- expanded semantic content (no raw JSON-first UX).

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/tools/task-tools-hierarchy.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/tools/taskTools.js src/features/ai/tools/hierarchy.js src/features/ai/components/AiDrawer.js tests/unit/ai/tools/task-tools-hierarchy.test.js
git commit -m "feat(ai): add hierarchy-aware tool outputs and semantic tool cards"
```

---

### Task 6: Skills Config UX (Default Collapsed)

**Files:**
- Modify: `src/features/ai/components/AiConfigModal.js`
- Modify: `src/features/ai/styles/ai-theme.css`
- Test: `tests/unit/ai/components/ai-config-skills-collapse.test.js`

**Step 1: Write the failing test**

Cover:
- skills section default collapsed,
- enabled count shown in header,
- expand/collapse persists in modal state.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/components/ai-config-skills-collapse.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement one collapsed skills header and lazy render full list only on expand.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/components/ai-config-skills-collapse.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/components/AiConfigModal.js src/features/ai/styles/ai-theme.css tests/unit/ai/components/ai-config-skills-collapse.test.js
git commit -m "feat(ai): default collapse skills management in config modal"
```

---

### Task 7: Add New Read/Analyze Tools

**Files:**
- Create: `src/features/ai/tools/analysisTools.js`
- Modify: `src/features/ai/tools/registry.js`
- Test: `tests/unit/ai/tools/analysis-tools.test.js`

**Step 1: Write the failing test**

Add schema and behavior tests for:
- `get_task_dependencies`
- `get_critical_path`
- `get_resource_workload`
- `get_tasks_by_assignee`
- `get_resource_conflicts`
- `get_tasks_in_range`
- `get_upcoming_deadlines`
- `get_baseline_deviation`
- `get_task_detail`
- `get_subtasks`
- `get_field_config`
- `get_custom_fields`
- `get_field_statistics`

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/tools/analysis-tools.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement tool set with consistent response envelopes and hierarchy IDs where applicable.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/tools/analysis-tools.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/tools/analysisTools.js src/features/ai/tools/registry.js tests/unit/ai/tools/analysis-tools.test.js
git commit -m "feat(ai): add read/analyze toolset for dependency resource timeline and fields"
```

---

### Task 8: Add 6 Skills + Router Expansion

**Files:**
- Create: `src/features/ai/skills/dependency-analysis/SKILL.md`
- Create: `src/features/ai/skills/resource-analysis/SKILL.md`
- Create: `src/features/ai/skills/timeline-analysis/SKILL.md`
- Create: `src/features/ai/skills/task-detail-query/SKILL.md`
- Create: `src/features/ai/skills/project-summary/SKILL.md`
- Create: `src/features/ai/skills/field-info/SKILL.md`
- Modify: `src/features/ai/skills/registry.js`
- Modify: `src/features/ai/agent/router.js`
- Test: `tests/unit/ai/agent/router-skill-expansion.test.js`

**Step 1: Write the failing test**

Cover:
- keyword routing zh/en for each new skill,
- fallback behavior when low confidence,
- registry resolves all new skills.

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ai/agent/router-skill-expansion.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

Create skill prompts with:
- explicit tool constraints,
- fixed reply citation style requirement: `[#层级] 任务名`.

Expand router keyword map and keep AI router fallback unchanged.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ai/agent/router-skill-expansion.test.js`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/features/ai/skills/dependency-analysis/SKILL.md src/features/ai/skills/resource-analysis/SKILL.md src/features/ai/skills/timeline-analysis/SKILL.md src/features/ai/skills/task-detail-query/SKILL.md src/features/ai/skills/project-summary/SKILL.md src/features/ai/skills/field-info/SKILL.md src/features/ai/skills/registry.js src/features/ai/agent/router.js tests/unit/ai/agent/router-skill-expansion.test.js
git commit -m "feat(ai): add six analysis skills and extend router matching"
```

---

### Task 9: End-to-End Verification

**Files:**
- Create: `tests/e2e/ai-grounded-citation.spec.js`
- Create: `tests/e2e/ai-mention-search.spec.js`
- Create: `tests/e2e/ai-analysis-skills.spec.js`
- Modify: `tests/e2e/ai-interaction.spec.js`

**Step 1: Write failing E2E cases**

Scenarios:
- query task list -> clickable citation chips,
- `@` mention flow -> payload includes referenced task,
- expanded skills -> dependency/resource/timeline answers grounded in tool results.

**Step 2: Run E2E subset to verify failure**

Run: `npm run test:e2e -- tests/e2e/ai-grounded-citation.spec.js`
Expected: FAIL.

**Step 3: Implement any missing glue code**

Fix selectors/event hooks only where tests reveal gaps.

**Step 4: Run full verification**

Run:
- `npm test -- tests/unit/ai`
- `npm run test:e2e -- tests/e2e/ai-grounded-citation.spec.js tests/e2e/ai-mention-search.spec.js tests/e2e/ai-analysis-skills.spec.js`
- `npm run build`

Expected: all PASS.

**Step 5: Commit**

```bash
git add tests/e2e/ai-grounded-citation.spec.js tests/e2e/ai-mention-search.spec.js tests/e2e/ai-analysis-skills.spec.js tests/e2e/ai-interaction.spec.js
git commit -m "test(ai): add e2e coverage for grounded citations mentions and analysis skills"
```

---

### Task 10: Docs + Rollout Notes

**Files:**
- Modify: `docs/plans/2026-02-06-ai-agent-optimization-design.md`
- Create: `docs/releases/ai-grounded-task-experience.md`
- Modify: `README.md`

**Step 1: Write failing docs checklist**

Create checklist for:
- citation rule,
- mention behavior,
- skills collapsed UX,
- new skills matrix.

**Step 2: Verify missing docs**

Run manual check: ensure each shipped behavior has one doc section.

**Step 3: Write minimal docs updates**

Add rollout notes and operator guidance.

**Step 4: Sanity check links and formatting**

Run: `npm run build`
Expected: PASS.

**Step 5: Commit**

```bash
git add docs/plans/2026-02-06-ai-agent-optimization-design.md docs/releases/ai-grounded-task-experience.md README.md
git commit -m "docs(ai): document grounded citation rules mention flow and skill expansion"
```

---

## Implementation Notes

- Keep DRY/YAGNI: one citation parser, one task chip renderer, one task input bubble shape.
- Use @superpowers:test-driven-development for each task.
- If defects appear, use @superpowers:systematic-debugging before patching.
- Keep commits small and tied to one task.

## Final Verification Gate

Before merge:

1. `npm test -- tests/unit/ai`
2. `npm run test:e2e -- tests/e2e/ai-grounded-citation.spec.js tests/e2e/ai-mention-search.spec.js tests/e2e/ai-analysis-skills.spec.js`
3. `npm run build`

All three must pass.
