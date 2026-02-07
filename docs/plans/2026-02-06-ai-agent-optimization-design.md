# AI Agent Optimization Design

Date: 2026-02-06  
Status: Implemented (2026-02-07)

## Goals

Optimize AI-agent interaction for task-centric workflows, with stronger visual clarity, stronger grounding in real task data, and broader read/analyze capability via chat.

Primary goals:

1. Improve user request/reply visual quality in chat.
2. Pass full task context (including subtasks/dependencies) for refine/split operations.
3. Add `@` task mention in chat input.
4. Make task-related AI replies interactive (click to open task details), not plain text only.
5. Expand skills so users can inspect/analyze project state via conversation (no task CUD in this phase).

---

## Decisions Confirmed

1. **Visual optimization scope**: full upgrade.
2. **Task card style**: compact information cards.
3. **Task context display**: combine mention tags + collapsible context card.
4. **Reply grounding style**: AI keeps natural language summary, but task mentions become clickable highlights.
5. **Task mention binding**: AI-side explicit task markers.
6. **Task ID strategy**: keep internal `task.id` for binding, display dynamic hierarchy number (e.g. `#1.2`) to user.
7. **Skills expansion**: include all proposed read/analyze skills.

---

## Architecture Overview

### 1) Unified Task Presentation Layer

Introduce a reusable renderer layer for task references across:

- user input mentions,
- tool call result preview,
- assistant reply content,
- task-context-in-message cards.

Three reusable UI units:

1. `TaskChip` (inline)
2. `TaskRow` (list row)
3. `TaskContextCard` (collapsible, rich context)

All use shared status/priority visual tokens and shared click behavior (`open task detail panel`).

### 2) Marker-Based Grounding in AI Replies

Standardize assistant task references to marker format (fixed, parse-first):

`[<hierarchy_id>] <name>`

Example: `[#1.2] 设计登录页面`

Internal/transport marker may still be kept as:

`[task:<id>:<hierarchy_id>:<name>]`

UI always normalizes to the fixed citation style above for consistency.
Internal numeric IDs are not shown in the UI.

Renderer pipeline parses marker and converts to `TaskChip`.

### 3) Context Injection Separation

Split “what AI receives” from “what user sees”:

- AI receives full structured task payload.
- UI shows a compact/collapsible context card.

This keeps context rich and UI clean.

---

## Component Design

## A. TaskChip (inline reference)

Purpose: inline clickable grounded task reference.

Visual:

- tiny status dot,
- hierarchy badge (`#1.2`),
- truncated title,
- optional priority glyph.

Behavior:

- click -> open existing task detail panel,
- hover -> tooltip with key fields.

Usage:

- parsed from assistant markers,
- rendered in mention composer,
- rendered in compact tool previews.

## B. TaskRow (compact list item)

Purpose: dense list for query outputs.

Visual (single row):

- status dot -> hierarchy -> title -> tags (priority/progress/due or overdue).

Behavior:

- row click -> open task detail,
- keyboard accessible.

Usage:

- today/overdue/status/priority query results,
- tool call expanded panels.

## C. TaskContextCard (collapsible)

Purpose: show high-value summary first, hide full context by default.

Collapsed:

- hierarchy + title,
- status, priority, progress.

Expanded:

- description snippet,
- subtasks,
- dependency summary,
- assignee and dates,
- links to open related tasks.

Usage:

- refine/split prompt context display,
- messages that include one or more explicit `@` mentions.

---

## Data and Tool Contract Changes

## 1) Hierarchy ID generation (display-only)

Keep internal numeric `task.id` unchanged.

Add dynamic `hierarchy_id` to task-related tool outputs:

```json
{
  "id": 5,
  "hierarchy_id": "#1.2",
  "text": "设计登录页面",
  "status": "in_progress",
  "priority": "high",
  "progress": 60
}
```

## 2) Assistant marker convention

All task-aware skills must reference concrete tasks in final reply with markers.
UI rendering must use readable citations only:

`[<hierarchy_id>] <name>`

Renderer validates marker IDs against tool-result context of the same turn before clickable transform.

## 3) Context payload format for refine/split

Use structured payload:

- task core fields,
- child tasks,
- predecessor/successor summary,
- selected custom fields.

UI still renders compact context card only.

---

## @ Mention Design

## Interaction

1. User types `@` in composer.
2. Mention popup opens with fuzzy search.
3. Search supports task name and hierarchy ID.
4. User selects one/multiple tasks via keyboard or mouse.
5. Composer shows selected mentions as chips.
6. On send, message includes `referencedTasks[]` full structured payload.

## Mention payload

```json
{
  "text": "帮我分析这个任务是否有风险",
  "referencedTasks": [
    {
      "id": 5,
      "hierarchy_id": "#1.2",
      "text": "设计登录页面"
    }
  ]
}
```

---

## Tool Call UX Redesign

Replace raw JSON-centric visuals with semantic cards.

States:

1. Running: “正在查询…” + spinner.
2. Done (collapsed): short summary (count/key metrics).
3. Done (expanded): structured preview using `TaskRow` or summary block.

Do not remove full raw payload from system; keep it in debug/details foldout for traceability.

---

## Skills Expansion (Read/Analyze Only)

Add the following skills:

1. `dependency-analysis`
2. `resource-analysis`
3. `timeline-analysis`
4. `task-detail-query`
5. `project-summary`
6. `field-info`

Existing skills remain:

7. `task-query`
8. `progress-analysis`

### New tool families

- dependency: `get_task_dependencies`, `get_critical_path`
- resource: `get_resource_workload`, `get_tasks_by_assignee`, `get_resource_conflicts`
- timeline: `get_tasks_in_range`, `get_upcoming_deadlines`, `get_baseline_deviation`
- task detail: `get_task_detail`, `get_subtasks`
- field info: `get_field_config`, `get_custom_fields`, `get_field_statistics`

All tools must return `id + hierarchy_id` for task entities.

---

## Routing Strategy Updates

1. Extend keyword router with zh/en patterns for new intents.
2. Keep AI route fallback for ambiguous prompts.
3. Cache route decisions per normalized query.
4. Add ambiguity fallback message if confidence is low and multiple skills are plausible.

---

## Error Handling and Trust Controls

1. Marker parse failure -> render plain text (no crash).
2. Marker id not in tool context -> render as non-clickable muted tag and log mismatch.
3. Task deleted before click -> toast “task no longer exists”.
4. Mention selection stale -> re-validate IDs on send.
5. Tool returns empty -> standardized empty-state cards.

Anti-hallucination guardrails:

- clickable task references require validated IDs,
- analysis summary should cite tool-derived counts.

---

## Testing Plan

## Unit

1. Marker parser: valid/invalid/mixed input.
2. Hierarchy ID generator: nested trees and reorder cases.
3. Mention query matcher: name + hierarchy searches.
4. Tool mappers: output schema includes required fields.

## Integration

1. Skill response with markers -> clickable chips.
2. Tool call flow running/done/expanded states.
3. Refine/split context card collapsible behavior.
4. Click chip -> open task detail panel.

## E2E

1. `@` mention task and ask follow-up.
2. Query today tasks and open one task from reply.
3. Resource/dependency/timeline summary flows.
4. Regression: existing refine/split apply/undo workflow unaffected.

---

## Implementation Phases

Phase 1 (UI foundation):

- build TaskChip/TaskRow/TaskContextCard,
- add marker parser/renderer,
- redesign tool call cards.

Phase 2 (context + mentions):

- implement mention popup + payload,
- wire full task context injection + compact card display.

Phase 3 (skills/tools):

- add 6 skills + tool contracts,
- update routing patterns,
- enforce marker convention in skill prompts.

Phase 4 (quality hardening):

- unit/integration/e2e,
- polish empty/error states,
- performance tuning for large task lists.

---

## Non-Goals (Current Scope)

1. No AI task create/update/delete operations.
2. No redesign of non-AI pages.
3. No backend architecture migration.

---

## Acceptance Criteria

1. Assistant replies can render validated clickable task references.
2. Users can `@` search and insert task references in composer.
3. Refine/split receives full task context while UI remains compact.
4. Tool-call UI no longer relies on raw JSON-only presentation.
5. New six skills available and routable for read/analyze workflows.
6. Key flows are covered by tests and pass locally.
