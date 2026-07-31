# Feedback Workbench V2 Phase 0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish the V2 Worker storage foundation while preserving every readable V1 feedback record and preventing any new KV writes.

**Architecture:** `gantt-share` remains the single Worker entrypoint. D1 becomes the only metadata write store, R2 becomes the only binary write store, and `FEEDBACK_KV` is consulted only when a D1 issue lookup misses; a deterministic backfill maps legacy fields and history into append-only rows without copying inline attachment data into D1. The existing public/admin serializers remain the compatibility boundary while later phases replace the workbench UI.

**Tech Stack:** Cloudflare Workers, D1/SQLite migrations, R2, Cloudflare Workflows, Wrangler 4, Vitest, Playwright.

**Status (2026-07-28):** Tasks 1–6 are implemented. Task 7 passed through focused and
full Vitest, local Wrangler D1/R2 smoke checks, responsive browser checks, production build,
scenario reconciliation, migration idempotency, and Worker dry-run. A checked-in Playwright
spec and remote Workflow/R2 lifecycle verification remain follow-up work; the Cloudflare
account currently has R2 disabled.

**Status (2026-07-30) — Phase 3 workbench UI landed.** Phase 0 only built storage, so
`/feedback` still served the V1 board and the gap against
`feedback-workbench-v2-prototype.html` was the whole UI. Now shipped:

- `workers/feedback-workbench-ui.js` + `feedback-workbench.css.txt` (verbatim prototype
  stylesheet) + `feedback-workbench-client.js.txt` render the three prototype views
  (Issues timeline / 自动化 / AI 执行器) at `/feedback`, wired to real endpoints with no
  sample data. The V1 board stays at `/feedback/legacy` until its rrweb replay and
  classification editors are ported.
- New V2 endpoints: issue queue ordering + `attention`/`active` filters,
  `:key/events`, `:key/comments`, `:key/reopen`, `:key/human-actions`,
  `human-actions/:id/respond`, `automation/settings|health|test`,
  `runners/settings|test`. Settings live in D1 (`0003_feedback_workbench_settings.sql`).
- `tests/e2e/workbench/feedback-workbench.spec.js` (18 tests) runs against the local
  Worker per §19.6; `SCN-FWB-015` moved to `active`.

**Status (2026-07-30) — Phase 1 event dispatch landed.**

- `dispatchFeedbackEvent` replaces the placeholder enqueue: it builds the §12.1 envelope,
  writes an idempotent delivery keyed on `issueId:event:eventId`, records daily usage, and
  starts or resumes the Workflow that owns the retries.
- Workflow instance identity follows §13.1/§13.4: one non-terminal instance per Issue,
  `sendEvent` resume while it lives, compare-and-set `generation + 1` once it is terminal,
  and a `security.blocked` event when a custom instance ID does not match the D1 mapping.
  The event ID is never the instance ID.
- Retries live in `FeedbackWorkflow.deliverEvent` as a `step.do` with exponential backoff
  (§17.2: 4 attempts from 1 minute), so no high-frequency cron exists (§4, §19.4). Only
  transport failures retry; auth/schema failures fail immediately (§17.1). Exhaustion parks
  the delivery in the DLQ.
- `POST /api/feedback/deliveries/:id/replay` (admin) reuses the original delivery row, and
  the automation page shows a 重放 action on stuck deliveries.
- §12.2/§18.2 quota: dispatch past `FEEDBACK_DAILY_DISPATCH_QUOTA` per Issue per day writes
  an admin-visible `automation.suppressed` event and creates no Workflow, delivery or Run.
- `issue.created` dispatches through `ctx.waitUntil`, so submitters never wait on the Hook.

**Status (2026-07-31) — Run creation and the Callback API landed.**

- `resolveFeedbackPolicy` implements the §7.2 matrix in code; per §7.3 neither the request
  body nor the Agent output can pick a policy.
- The Workflow creates a Run after delivering the event and mints two run-scoped tokens
  with distinct `aud` (`context`, `callback`), so neither can be replayed as the other and
  an admin session is rejected at both endpoints (§18.1, §21.3).
- `GET /api/feedback/runs/:runId/context` returns the minimal snapshot: no `contact`, no
  internal notes, and the reporter's text wrapped as `untrustedUserContent` for prompt
  data separation (§18.2).
- `POST /api/feedback/runs/:runId/events` accepts only the eight §15.2 types, is idempotent
  on `runId + eventId` (a repeat returns 200), keeps `providerRawStatus` as metadata that
  never drives the UI (§15.3), and refuses events for a terminal Run.
- Run→Issue projection follows §9.2: `run.completed` lands on `needs_human`, never
  `resolved`; a `verification_failed` failure lands on `test_failed`; infrastructure
  failures leave the Issue where it is.
- `agent.waiting_human` creates a structured HumanAction (type, requestedAction, evidence,
  allowedReturnStates) so the UI never parses a free-text note (§19.2).
- `artifact.created` records a private artifact bound to the Run (§18.2).
- One write-capable Run per Issue (§7.3); a second attempt is refused with an
  admin-visible `automation.suppressed`. `local_required` never auto-dispatches.
- `POST /api/feedback/runs/:runId/cancel` (admin) cancels the Run and returns the Issue to
  `open` (§9.2).

**Still not built:** GitHub `workflow_dispatch` — the Run and its tokens exist but nothing
starts an Action yet, so Callbacks only arrive from tests. Candidate/Design/Release
endpoints and the delivery closure are absent, `/runners/test` still returns
`ACTION_SMOKE_NOT_CONFIGURED`, and the daily `feedback-reconcile` sweep is reported by
`automation/health` but has no scheduled handler.

---

### Task 1: Freeze the Phase 0 infrastructure contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `wrangler.toml`
- Test: `tests/unit/feedback/feedback-v2-infrastructure.test.js`

**Steps:**
1. Write failing tests for the pinned Wrangler dependency, Worker-only D1/R2/Workflow bindings, the `2026-07-28` compatibility date, and local/remote migration scripts.
2. Run `npx vitest run tests/unit/feedback/feedback-v2-infrastructure.test.js`; expect failures for missing configuration.
3. Add Wrangler and the Worker/migration scripts. Keep `wrangler.jsonc` free of V2 write bindings.
4. Re-run the focused test; expect PASS.

### Task 2: Add the append-only D1 schema

**Files:**
- Create: `src/features/feedback/migrations/0001_feedback_workbench_v2.sql`
- Test: `tests/unit/feedback/feedback-v2-infrastructure.test.js`

**Steps:**
1. Add failing schema assertions for Issue/Event/Workflow/Run/HumanAction/Design/Candidate/Release/Delivery/Artifact/Attachment/Usage tables, foreign keys, uniqueness, active-record partial indexes, and migration-safe defaults.
2. Run the focused test and confirm the missing-schema failure.
3. Add the first append-only migration. Store JSON and ISO timestamps as `TEXT`; store booleans as constrained integers; keep attachment bodies out of D1.
4. Apply the migration twice through Wrangler's migration command and verify the second run reports no pending migration.

### Task 3: Introduce D1-first reads without breaking V1

**Files:**
- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

**Steps:**
1. Add failing tests showing D1 wins when both stores contain an issue, a D1 miss falls back to KV, a D1 failure does not silently write KV, and D1 list results never enumerate anonymous KV data.
2. Run the focused Worker test and confirm the failures reflect the existing KV-only behavior.
3. Implement prepared D1 reads and compatibility mapping while retaining the existing serializers.
4. Re-run the focused Worker test and preserve all original 27 cases.

### Task 4: Backfill legacy history idempotently

**Files:**
- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

**Steps:**
1. Add failing tests for deterministic legacy event IDs, stable per-Issue sequence numbers, public/internal visibility, contact/context preservation, and repeatable backfill.
2. Confirm RED because no D1 backfill exists.
3. Implement a D1 transaction/batch that inserts the normalized Issue and uses uniqueness constraints for event/history deduplication. Record inline attachments only as legacy references; never copy `dataUrl` into D1.
4. Re-run the focused tests and assert repeated migration changes no row counts.

### Task 5: Enforce D1-only mutation contracts

**Files:**
- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

**Steps:**
1. Add failing tests for D1-only creation/PATCH, append-only events, expected-version conflicts, and failure when D1/R2 are unavailable.
2. Confirm RED and state that the tests catch accidental KV dual-writes and lost updates.
3. Implement minimal prepared statements/batches and return stable 409 errors on optimistic concurrency conflicts.
4. Re-run tests and inspect the in-memory KV spy to prove zero writes.

### Task 6: Add the minimal Workflow entrypoint

**Files:**
- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/feedback-v2-infrastructure.test.js`

**Steps:**
1. Add a failing export/config contract test for `FeedbackWorkflow`.
2. Confirm RED because the class is absent.
3. Add a deterministic, no-dispatch Phase 0 Workflow skeleton whose durable steps only persist serializable state and use `this.env`.
4. Validate the Worker with `wrangler deploy --dry-run`.

### Task 7: Verify the delivery slice

**Files:**
- Test: `tests/e2e/feedback-workbench-v2.spec.js`

**Steps:**
1. Add owner/admin local Worker smoke coverage using `[SCN-FWB-017]` and `[SCN-FWB-018]`.
2. Apply local D1 migrations and run the Worker with local bindings.
3. Run focused Vitest, `npm run check:scenarios`, the focused Playwright path, `npm test`, and Worker dry-run.
4. Record remote gaps honestly: the account must enable R2 before bucket creation/lifecycle verification, and real Action/Workflow retention tests require external credentials and deployment.
