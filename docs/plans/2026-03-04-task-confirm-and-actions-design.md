# Task Confirm And Actions Design

**Date:** 2026-03-04

## Goal

Implement a confirmation-based task editing workflow and a fixed right-side action column so task creation/edit/delete is explicit, efficient, and consistent across split/table/gantt views.

## Confirmed Decisions

1. All task field edits require explicit confirmation before persisting.
2. The action buttons column is a fixed right-most column.
3. The fixed action column appears in split/table/gantt modes.
4. Single task delete must be supported from list actions with confirmation.
5. New task flow must open editing flow reliably instead of silently persisting partial values.

## Current Gaps

1. Field edits in task details call `gantt.updateTask` on blur/change, causing repeated renders and expensive listeners to run.
2. List lacks a dedicated single-delete action entry point.
3. Gantt-only mode currently reduces columns to text only, so no operation buttons are available there.
4. New task create and edit transition can be inconsistent from user perspective.

## Solution Overview

### 1) Draft-Then-Commit Editing

- Introduce draft state in task details panel:
  - `sourceTask`: canonical gantt task object.
  - `draftTask`: editable clone.
- All inputs mutate `draftTask` only.
- Add panel footer actions:
  - `Cancel`: discard draft.
  - `Confirm Save`: diff and apply once to `sourceTask`, then call one `gantt.updateTask(task.id)`.
- If panel closes with unsaved draft changes, show a discard confirmation dialog.

### 2) New Task Flow

- Keep existing new-task modal for initial required input.
- On submit:
  - create minimal task record,
  - open task details panel immediately,
  - continue editing in draft mode,
  - persist only when user clicks `Confirm Save`.

### 3) Fixed Right-Side Action Column

- Add `actions` column in gantt grid columns config as right-most fixed-width column.
- Actions:
  - edit/open details,
  - delete with confirmation.
- Ensure this column is present in:
  - split mode,
  - table mode,
  - gantt-only mode (`text + actions`, not text-only).

### 4) Single Task Delete

- Delete action from actions column uses shared confirm dialog.
- On confirm:
  - call `gantt.deleteTask(id)`,
  - close detail panel if it currently displays deleted task,
  - avoid extra full re-render calls.

## Performance Strategy

- Prevent repeated update/render chain while typing by buffering edits in draft state.
- Trigger gantt update exactly once per explicit save.
- Keep delete and view transitions scoped to required updates only.

## Risks And Mitigations

1. **Risk:** stale draft after task deleted externally.
   - **Mitigation:** validate task existence before confirm; if missing, abort and notify.
2. **Risk:** draft and panel refresh logic conflict.
   - **Mitigation:** centralize draft lifecycle in panel-level state and route field bindings through one setter.
3. **Risk:** right-fixed action column style mismatch on narrow widths.
   - **Mitigation:** enforce fixed width and compact icon buttons; verify in three view modes.

## Acceptance Criteria

1. Editing any field in task details does not persist until `Confirm Save`.
2. Closing with unsaved changes prompts for discard.
3. New task creation opens editing flow and persists only on confirmation.
4. List supports single-row delete via fixed right-most actions column.
5. Actions column remains available in split/table/gantt modes.
6. Confirm-save path performs one task update call for a normal edit session.
