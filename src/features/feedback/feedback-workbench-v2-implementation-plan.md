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

**Status (2026-07-31) — GitHub dispatch and the mechanical diff gate landed.**

- `src/features/feedback/diff-gate.js` holds the single §14.4 rule table, used by both
  enforcement points: `scripts/feedback-diff-gate.mjs` in the Runner (before tests run) and
  `verifyRunCompletionManifest` in the Worker (before `run.completed` is projected). One
  table means the two gates cannot drift.
- Three tiers per §14.4 rule 4: hard deny (golden JSON, `.git`, credentials), admin
  approval (`.github/workflows`, `scripts`, `wrangler.*`, `AGENTS.md`, `CLAUDE.md`,
  `.agents`, `.codex`) and contract-aware (`tests/scenarios/**`, append-only `CHANGES.md`,
  allowed only for a trusted Run that cites an SCN-ID). A signed admin scope can release
  approval-level paths but never the hard-deny list.
- The gate also refuses verification weakening — `test.skip/only/todo`, removed `expect`
  lines and weakened deep comparisons — and any file written by a read-only policy.
- `dispatchFeedbackRunToGitHub` posts `workflow_dispatch` with the §13.2 minimal payload.
  Run tokens travel as separate inputs, and no Agent key, admin password or feedback body
  is included.
- A Run that could not be dispatched stays non-terminal so §17.1 retry stays possible and
  the one-write-Run lock is not released while nothing is running; the reason is recorded
  as an admin-visible `automation.suppressed`.
- `.github/workflows/feedback-agent-{codex,claude}.yml` implement §13.3: payload
  validation, pinned `baseCommit` checkout with `persist-credentials: false`, context fetch
  with the Context token, prompt with the reporter text fenced as untrusted data, the diff
  gate before tests, Playwright evidence upload, and an `if: always()` callback.

**Status (2026-08-01) — Candidate/Release closure and the reconcile sweep landed. An Issue
can now reach `resolved`.**

- A clean `run.completed` from a write policy registers a Candidate (§14.5). Identity is
  repository + `baseCommit` + `changeCommit` + signed manifest; the Runner worktree path is
  never stored (§9.3). A follow-up Candidate points at `parentCandidateId` and abandons it
  explicitly rather than letting creation time decide.
- Approving a HumanAction with `ready_for_deploy` flips the exact named Candidate to
  `approved`; a superseded, integrated or unknown Candidate is refused.
- `POST /candidates/:id/deliver` takes the repository-level delivery lock (§14.6 step 1),
  creates the Release, moves the Issue to `testing` — never straight to `resolved` — and
  mints the release-scoped token.
- `deploymentRequired` follows the changed surface (§14.7): Worker paths need a Worker
  deploy plus smoke, frontend paths need Pages, tests/docs-only needs neither.
- `POST /releases/:id/events` accepts the nine §15.4 types under a `release`-audience token
  only. `release.completed` is refused unless `integrationCommit` is present, every
  required stage has reported, smoke passed, and `deployedCommit` matches the merged
  commit. Only then does the Issue become `resolved` and the Candidate `integrated`.
- The daily `feedback-reconcile` sweep now has a real `scheduled()` handler and a single
  `[triggers] crons = ["0 3 * * *"]`. It only touches stuck work: it expires 7-day waits
  (terminating the instance and clearing `active_workflow_id` while the Issue stays
  `needs_human`, §17.3) and drops artifact rows past retention. With nothing stuck it does
  no work and reports zero Runs, which is what keeps SCN-FWB-002 true.
- `.gitignore` gained a narrow exception so the two Agent Runner workflows are versioned —
  GitHub cannot run a workflow that is not in the repository. Everything else under
  `.github/` stays untracked.

**Local pipeline run (2026-08-01).** Driving one Issue end to end against a local Worker
found three defects no unit test could have caught, all now fixed: Cloudflare rejects `:`
in a Workflow instance ID so no instance was ever created; orchestration was gated on an
external Hook being configured, so an Actions-only project would never get a Run; and Run
creation sat behind Hook delivery retries, parking the Agent behind up to ~21 minutes of
backoff. Re-running the pipeline now produces `feedback-<id>-g1`, a Run at the routed
policy, and an honest `GITHUB_DISPATCH_NOT_CONFIGURED`.

**Status (2026-08-01) — Design revision approval landed.**

- `0004_feedback_design_run_binding.sql` links each follow-up Run to the exact approved
  Design. Structured `design_decision` callbacks create immutable numbered revisions plus
  an exact HumanAction; malformed Designs are rejected before any partial event/action write.
- `GET /api/feedback/issues/:key/designs` serves revisions to owner/admin. Approve, revise
  and reject require the HumanAction's exact `designId`; approval/revision returns to
  `queued`, rejection closes, and the decision is preserved in the Design/event audit trail.
- `FeedbackWorkflow` now separates the policy-bound Run deadline (`analyze` 30 minutes,
  `implement` 45, `implement_and_verify` 60, `local_required` 120) from the seven-day
  `needs_human` wait. A durable Run callback uses `feedback-run-result`; only a persisted
  HumanAction enters the Cloudflare-safe `feedback-resume` wait. Run timeout marks the Run
  `timed_out`, terminates the Workflow, and releases the active mapping.
- The durable `create run` step marks its output sensitive because the persisted result carries
  short-lived Callback/Context tokens; Workflow logs and instance inspection redact that output.
- Review hardening now makes every explicit/derived Design gate read-only until approval,
  commits Callback + Design + HumanAction in one D1 batch, CAS-guards every decision
  projection, terminates rejected Design Runs/Workflows before generation 2 can reopen, and
  removes internal Run/implementation details from the owner Design API. HumanAction return
  states now come from the §16.3 per-type server contract rather than Agent-provided values.
- Owner capability can read the Design but cannot approve it or any other privileged
  HumanAction; only administrators see those controls. The response CAS requires the exact
  active HumanAction, `needs_human` Issue projection, current Design revision and
  `awaiting_decision` status. Approve/revise/reject append distinct audit event types.
- Persisted terminal Run callbacks signal the exact run-bound Workflow before it decides whether
  to wait for a person or finish. A failed control-plane send is reported as `pending`, can be
  replayed by the idempotent Callback, and is retried by the narrow daily reconcile sweep without
  creating a Run. Every `resolved/closed` transition terminates the D1 and Cloudflare Workflow
  lifecycle, clears the active mapping, and a later reopen claims generation `+ 1` rather than
  resuming a stale instance.
- The workbench renders the structured Design and acceptance criteria, with explicit
  admin-only approve/revise/reject controls. A checked-in Playwright journey drives a real local
  requirement Issue through signed Callback, owner read-only verification, administrator
  approval and D1 verification of the `implement_and_verify` Run's `design_id`.
- A true local pipeline run reproduced and fixed the previous false resume: the old Workflow
  returned after dispatch while D1 still said `running`, so `sendEvent` appeared successful
  but created no Run. Re-running now leaves generation 1 in `waiting`, resumes it, creates
  the Design-bound implementation Run and still reports `GITHUB_DISPATCH_NOT_CONFIGURED`
  rather than inventing dispatch success.

**Status (2026-08-01) — `auto_deliver` implementation landed, external proof still pending.**

- A write Run fixes `deliveryMode` before dispatch from server-owned facts. Only an enabled,
  healthy trusted admin/system actor or named actor allowlist entry, `scope=small`,
  `auto_fix`, bug/improvement route can select `auto_deliver`; every absent prerequisite
  deterministically selects `candidate_review`.
- The shared diff gate now derives Tier 0–3 and visual-evidence requirements from changed paths.
  Callback re-checks that classification plus structured target-test/build/Playwright/visual
  evidence. Tier 3, protected paths and evidence gaps create an exact `review_required`
  HumanAction instead of letting the Agent self-authorize delivery.
- A passing low-risk Candidate is still registered first, then system-approved into the existing
  repository delivery lock and dispatched to `feedback-delivery.yml`. Agent workflows now build,
  commit and push a recoverable per-Run Candidate ref; the Release workflow validates that exact
  ref/commit, integrates from a clean checkout, reruns tests/build, performs required Cloudflare
  deploy and production smoke, and reports every Release stage with its scoped token.
- GitHub dispatch failure never reports success: timeout/429/5xx remain resumable on the exact
  Release, while permanent rejection fails Candidate/Release, returns the Issue to `needs_human`,
  and records an exact `blocked_external` HumanAction.

**Local full-chain run (2026-08-01).** One Issue was driven end to end against a local
`wrangler dev` Worker with real D1 and the real Workflows runtime, using placeholder GitHub
credentials so dispatch reaches `api.github.com` and is honestly rejected. What it confirmed:

- An admin reopen of a `bug` / `small` / `auto_fix` Issue produced an `implement_and_verify`
  Run whose `delivery_mode` the Worker itself fixed to `auto_deliver` before dispatch.
- A `run.completed` callback carrying a Tier 1, unprotected change set with passing
  target-test and build evidence registered a Candidate, created a Release and dispatched it
  to `feedback-delivery.yml`. GitHub answered `401`, and the Worker recorded exactly that:
  Candidate and Release `failed` with `error_code=GITHUB_HTTP_401`, `retryable=false`, the
  Issue back to `needs_human`, and one active `blocked_external` HumanAction. No step
  reported a success it had not observed.
- The four downgrade paths were each exercised on their own Run and all held: `src/core/`
  → `QUALITY_TIER_REQUIRES_REVIEW`; a UI path without visual evidence →
  `VISUAL_EVIDENCE_REQUIRED`; failing target tests → `TARGETED_TEST_EVIDENCE_REQUIRED`; and
  `.github/workflows/` was blocked harder still — the diff gate failed the callback with
  `PATH_NOT_IN_APPROVED_SCOPE` before any Candidate existed.

Two things the run made precise, neither of which is a defect but both of which were easy to
misread from the code alone:

1. **The provider-health precondition is an admin assertion, not a smoke result.**
   `resolveFeedbackDeliveryMode` requires `connectionState === 'connected'` and
   `lastTestResult.ok === true`, but `/runners/test` deliberately never returns success, and
   no other code path writes that state. Today it can only be satisfied by an admin writing
   it through `PATCH /api/feedback/runners/settings`. `auto_deliver` is therefore inert until
   a person deliberately vouches for the provider — fail-closed, but it is an explicit
   human act rather than machine-verified health.
2. **A gate-blocked callback still echoes the Run's configured `deliveryMode`.** Case 3 above
   returned `deliveryMode: "auto_deliver"` alongside `gate.allowed: false` and
   `candidateId: null`, because the mode is the Run's fixed attribute and the delivery branch
   never ran. The response is unambiguous read as a whole; the field is not a claim that
   anything was delivered.

**Still not externally verified:** `/runners/test` intentionally continues to return
`ACTION_SMOKE_NOT_CONFIGURED`. No Agent or Release workflow has run against a real repository;
that still needs `FEEDBACK_GITHUB_REPOSITORY`, `FEEDBACK_GITHUB_TOKEN`,
`FEEDBACK_CALLBACK_ORIGIN`, `FEEDBACK_CANDIDATE_TOKEN`, `FEEDBACK_MERGE_TOKEN`,
`FEEDBACK_RELEASE_TOKEN_SECRET`, provider secrets,
deployment credentials, `FEEDBACK_PRODUCTION_ORIGIN`, `FEEDBACK_PRODUCTION_API_URL` and a remote
D1 migration. SCN-FWB-020 and SCN-FWB-022 therefore remain `todo`;
only SCN-FWB-015 is `active`.

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
