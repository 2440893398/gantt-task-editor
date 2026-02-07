# AI Grounded Task Experience - Release Notes

Date: 2026-02-07
Version: AI Agent Optimization v1

## Summary

This release overhauls the AI chat experience to be grounded in real project data. Task references in AI responses are now interactive citation chips, users can `@` mention tasks directly in chat input, the skills configuration is streamlined, and 6 new analysis skills with 13 read-only tools enable rich project inspection via conversation.

---

## Features

### 1. Grounded Task Citations

AI responses now parse task references in `[#hierarchyId] taskName` format into interactive citation chips.

- **Citation chips** (`.ai-task-citation`) display hierarchy ID + task name
- **Click to navigate**: chips carry `data-task-id` and `data-hierarchy-id` for downstream navigation
- **Parser**: `parseCitations(text)` in `src/features/ai/renderers/task-citation.js`
- **Rule**: All task tools attach hierarchy IDs via `attachHierarchyIds()` before returning results

### 2. @ Mention Task Search

Users can type `@` in the chat input to trigger a fuzzy search popup for referencing tasks.

- **Fuzzy matching** against task name, hierarchy ID, and assignee
- **Keyboard navigation**: Arrow keys + Enter to select, Escape to dismiss
- **Chip display**: Selected tasks appear as removable chips above the input
- **Payload**: `buildPayload()` returns `{ message, referencedTasks }` for the AI to use as grounding context
- **Component**: `src/features/ai/components/mention-composer.js`

### 3. Unified Task Input Bubble

All task display contexts (polish, split, mention) use a single `renderTaskInputBubble(taskData, {mode})` component.

- Consistent `.ai-task-input-bubble` class across all modes
- Shows task name, status badge, priority badge, progress, date range, subtask count
- **Component**: `src/features/ai/renderers/task-input-bubble.js`

### 4. Hierarchy-Aware Tool Outputs

All 5 existing task tools now return results enriched with dynamic hierarchy IDs.

- `attachHierarchyIds()` computes tree-position IDs (e.g., `1.2.3`) from the Gantt data
- Tool result cards use `getToolDisplayNameExtended()` for human-friendly display names
- `generateToolSummary()` provides semantic one-line summaries alongside tool call results
- **Module**: `src/features/ai/tools/hierarchy.js`

### 5. Skills Config Collapsed by Default

The skills section in the AI config modal now defaults to collapsed state using `<details>` / `<summary>`.

- Badge shows enabled skill count (e.g., "3/8")
- Expands on click to reveal individual skill toggles
- Reduces visual clutter in the config modal

### 6. New Analysis Tools (13 tools)

Read-only tools for project inspection via AI conversation:

| Category | Tool | Description |
|----------|------|-------------|
| Dependencies | `get_task_dependencies` | Get dependency links for a task |
| Dependencies | `get_critical_path` | Calculate project critical path |
| Resources | `get_resource_workload` | Get workload distribution |
| Resources | `get_tasks_by_assignee` | Find tasks assigned to a person |
| Resources | `get_resource_conflicts` | Detect overallocation conflicts |
| Timeline | `get_tasks_in_range` | Query tasks within a date range |
| Timeline | `get_upcoming_deadlines` | List approaching deadlines |
| Timeline | `get_baseline_deviation` | Compare current vs baseline |
| Details | `get_task_detail` | Get full detail for a single task |
| Details | `get_subtasks` | Get child tasks of a parent |
| Fields | `get_field_config` | Get column/field configuration |
| Fields | `get_custom_fields` | List custom field definitions |
| Fields | `get_field_statistics` | Compute statistics for a field |

### 7. New Analysis Skills (6 skills)

New skills enable structured AI analysis workflows:

| Skill | Purpose | Key Tools |
|-------|---------|-----------|
| `dependency-analysis` | Dependency graph and critical path analysis | `get_task_dependencies`, `get_critical_path` |
| `resource-analysis` | Workload and conflict analysis | `get_resource_workload`, `get_tasks_by_assignee`, `get_resource_conflicts` |
| `timeline-analysis` | Schedule deviation and deadline tracking | `get_tasks_in_range`, `get_upcoming_deadlines`, `get_baseline_deviation` |
| `task-detail-query` | Deep task inspection | `get_task_detail`, `get_subtasks` |
| `project-summary` | Overall project status overview | All read tools |
| `field-info` | Custom field and column queries | `get_field_config`, `get_custom_fields`, `get_field_statistics` |

### 8. Router Expansion

The skill router now supports keyword-based quick routing for all 8 skills (2 existing + 6 new).

- `quickRoute()` matches Chinese and English keyword patterns
- First match wins (ordered by specificity)
- Fallback to AI-based `routeToSkill()` when no keyword match

---

## Test Coverage

| Area | Test File | Count |
|------|-----------|-------|
| Citation parser | `tests/unit/ai/renderers/task-citation.test.js` | 4 |
| Mention composer | `tests/unit/ai/components/mention-composer.test.js` | 12 |
| Task input bubble | `tests/unit/ai/components/task-input-bubble.test.js` | 9 |
| Hierarchy tools | `tests/unit/ai/tools/task-tools-hierarchy.test.js` | 8 |
| Skills collapse UX | `tests/unit/ai/components/ai-config-skills-collapse.test.js` | 4 |
| Analysis tools | `tests/unit/ai/tools/analysis-tools.test.js` | 16 |
| Router expansion | `tests/unit/ai/agent/router-skill-expansion.test.js` | 23 |
| **Total new unit tests** | | **76** |
| E2E: citations | `tests/e2e/ai-grounded-citation.spec.js` | 2 |
| E2E: mentions | `tests/e2e/ai-mention-search.spec.js` | 4 |
| E2E: analysis skills | `tests/e2e/ai-analysis-skills.spec.js` | 5 |
| **Total new E2E tests** | | **11** |

---

## Migration Notes

- No breaking changes to existing task CUD tools
- Skills registry expanded from 2 to 8 skills
- Tool registry expanded from 5 to 18 tools
- All new tools are read-only (no mutations)
- Config modal skills section collapses by default — users can expand to customize
