# Parent-Child System Field Linkage Design

Date: 2026-02-27
Status: Approved
Mode: Semi-automatic

## Context

The current Gantt implementation already rolls up parent date range from children (`updateParentDates`).
System fields such as status, assignee, and workload are not fully linked, which can lead to inconsistent parent data.

This design introduces a semi-automatic linkage model for parent tasks.

## Goals

- Keep parent task data consistent with children by default.
- Allow practical manual override for parent assignee.
- Reuse existing scheduler/event architecture and avoid full-tree recomputation.
- Stay compatible with existing data and imported projects.

## Non-goals

- No hard enforcement of full read-only parent fields.
- No new dependency model changes.
- No redesign of calendar/resource model in this scope.

## Chosen Approach (Recommended)

Semi-automatic linkage:

- Parent `status`, `duration`, `estimated_hours`, `actual_hours`, and date range are auto-aggregated from children.
- Parent `assignee` is auto-derived only when child assignees collapse to one unique person.
- Parent assignee supports manual lock (`parent_assignee_locked=true`) so business owners can keep a designated owner.

Why chosen:

- Better consistency than “hint only”.
- More flexible than strict full-automatic mode.
- Minimal disruption to current UX and data model.

## Rule Set

### 1) Status Rollup

Given direct child tasks only:

- all completed -> parent completed
- else if any in_progress -> parent in_progress
- else if any suspended -> parent suspended
- else -> parent pending

Priority avoids oscillation and is deterministic.

### 2) Workload/Duration Rollup

- `duration`: use parent time span (`calculateDuration(parent.start_date, parent.end_date)`) after date rollup.
- `estimated_hours`: sum of children where value is numeric.
- `actual_hours`: sum of children where value is numeric.
- Parent values are treated as derived display values (not manual source of truth).

### 3) Assignee Rollup

- Collect normalized, non-empty child assignees.
- If exactly one unique assignee and parent not locked -> set parent assignee.
- If multiple unique assignees:
  - if locked -> keep current value
  - if unlocked -> keep current value (selected by user)
- If no valid assignee from children -> do not override parent.

### 4) Date Rollup

Keep current logic:

- parent start = min(child.start_date)
- parent end = max(child.end_date)

Then recompute parent duration from start/end.

## Data Model Changes

Add optional parent-level field:

- `parent_assignee_locked: boolean` (default `false`)

Backward compatibility:

- Existing tasks without this field are treated as unlocked.

## Triggering and Data Flow

### Trigger points

Run rollup from changed task upward on:

- task add/update/delete
- dependency update that changes scheduled dates
- batch import/batch edit completion

### Execution order (per affected parent chain)

1. date rollup (existing)
2. duration/workload rollup
3. status rollup
4. assignee rollup

Only call `gantt.updateTask(parentId)` when actual field values changed.

### Performance guard

- Upward-chain update only (no full-tree scan).
- Optional debounce/queue for bulk operations.

## Error Handling and Edge Cases

- No children: skip rollup for that parent.
- Invalid child dates: ignore invalid child in aggregation.
- Empty/mixed assignees: do not force overwrite.
- Parent-only projects with no leaves: keep existing values.
- Recursion safety: parent-chain traversal with visited-set guard.

## Testing Plan

### Unit tests

- status truth table combinations
- assignee rollup: single/multiple/empty/locked
- workload sums with null/invalid values

### Integration tests

- child add/edit/delete updates all affected ancestors
- drag/auto-schedule changes update parent duration/status correctly
- Excel import + parent rollup consistency

### Regression tests

- Existing date rollup behavior unchanged
- No extra render storm in large trees (1000+ tasks)

## Rollout Notes

- Default behavior is non-breaking (unlocked by default).
- UI can later expose a lock toggle for parent assignee near assignee field.
