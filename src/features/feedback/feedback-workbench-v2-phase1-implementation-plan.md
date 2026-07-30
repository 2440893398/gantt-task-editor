# Feedback Workbench V2 Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect an authenticated feedback Run to a scoped Cloudflare Workflow and the
official Codex GitHub Action while keeping Issue history, credentials, and callbacks
isolated and idempotent.

**Architecture:** `gantt-share` remains the API and orchestration boundary. An administrator
creates a Run through the Worker; D1 atomically reserves the Issue generation and stores
only hashes of independent short-lived Context and Callback bearer tokens. The Cloudflare
Workflow dispatches a pinned GitHub Action job, waits for normalized callback events, and
projects durable state into D1. GitHub receives the scoped tokens as masked dispatch inputs;
tokens never appear in URLs, persisted events, or artifacts.

**Tech Stack:** Cloudflare Workers and Workflows, D1/SQLite, GitHub Actions,
`openai/codex-action`, Vitest, Wrangler 4.

**Quality tier:** Tier 3. Every runtime task uses a red-green TDD cycle. Focused Worker and
schema tests run during development; scenario reconciliation, full Vitest, Wrangler
dry-run, and one real Action smoke are release gates.

**Repository constraint:** The repository currently forbids creating files outside
`src/` and `tests/`. Tasks 1–4 comply. Task 5 requires an explicit one-time exception for
`.github/workflows/feedback-agent-codex.yml` and `.github/codex/**`; do not start Task 5
without that authorization.

---

### Task 1: Persist scoped Run credentials and immutable context

**Files:**
- Create: `src/features/feedback/migrations/0003_feedback_agent_runs.sql`
- Modify: `tests/unit/feedback/feedback-v2-infrastructure.test.js`

**Step 1: Write the failing schema contract**

Assert that the new migration adds these `feedback_runs` columns:

- `permission_profile`
- `context_snapshot_json`
- `context_token_hash`
- `context_token_expires_at`
- `callback_token_hash`
- `callback_token_expires_at`
- `updated_at`

Also assert an active-Run uniqueness index for statuses `queued`, `running`, and
`waiting_human`.

**Step 2: Verify RED**

Run:

```powershell
npm.cmd exec vitest -- run tests/unit/feedback/feedback-v2-infrastructure.test.js
```

Expected: FAIL because migration `0003_feedback_agent_runs.sql` does not exist.

**Step 3: Add the migration**

Use `ALTER TABLE ... ADD COLUMN` with migration-safe defaults. Store token hashes only,
never raw token values. Add the partial unique index.

**Step 4: Verify GREEN**

Re-run the focused infrastructure test and apply local migrations twice:

```powershell
npm.cmd exec vitest -- run tests/unit/feedback/feedback-v2-infrastructure.test.js
npm.cmd run feedback:migrate:local
npm.cmd run feedback:migrate:local
```

Expected: tests pass; the second migration command reports no pending migrations.

### Task 2: Add scoped Context and Callback API contracts

**Files:**
- Modify: `workers/share-worker.js`
- Modify: `tests/unit/feedback/share-worker-feedback-board.test.js`

**Step 1: Write failing actor/scope tests**

Add `[SCN-FWB-017]` tests proving:

- `GET /api/feedback/runs/:runId/context` accepts only the matching, unexpired Context
  bearer token.
- A Callback token cannot read Context.
- `POST /api/feedback/runs/:runId/events` accepts only the matching, unexpired Callback
  bearer token.
- A Context token cannot append events.
- Cross-Run and expired tokens return `401` without revealing whether another Run exists.
- Replaying the same `eventId` does not create a duplicate event.

The tests fail under the bad behavior where a shared token, URL token, or missing
Run-scope check can read another Issue or append duplicate timeline events.

**Step 2: Verify RED**

Run the focused Worker test and confirm the new routes return the existing not-found or
invalid-key behavior.

**Step 3: Implement the minimal contract**

- Generate random tokens with the existing cryptographic capability helper.
- Compare SHA-256 hashes using timing-safe byte comparison.
- Return only the immutable `context_snapshot_json` to the Context actor.
- Accept only normalized event types:
  `run.started`, `agent.message`, `agent.waiting_human`, `artifact.created`,
  `run.completed`, and `run.failed`.
- Insert callback events idempotently by caller-provided `eventId`; ignore conflicting
  replay bodies rather than overwriting history.
- Never serialize token hashes or raw tokens in API responses.

**Step 4: Verify GREEN**

Run:

```powershell
npm.cmd exec vitest -- run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: all existing feedback tests and the new scope tests pass.

### Task 3: Start one idempotent Workflow generation per Issue

**Files:**
- Modify: `workers/share-worker.js`
- Modify: `tests/unit/feedback/share-worker-feedback-board.test.js`

**Step 1: Write failing Run-start tests**

Add `[SCN-FWB-002]`, `[SCN-FWB-003]`, `[SCN-FWB-008]`, and `[SCN-FWB-009]` tests proving:

- Only an administrator can call `POST /api/feedback/issues/:key/runs`.
- The server maps `analyze/review` to `:read-only` and
  `implement/implement_and_verify` to `feedback-workspace`.
- `local_required` creates a structured human action and never calls the Workflow binding.
- The first accepted request increments `workflow_generation`, sets
  `active_workflow_id = issueId:generation`, creates one queued Run, and invokes
  `FEEDBACK_WORKFLOW.create({ id, params })`.
- A repeated idempotency key returns the existing Run and never creates a second Workflow.
- A second write Run while one is active returns stable `409`.

**Step 2: Verify RED**

Run the focused Worker test and confirm the route is absent.

**Step 3: Implement the minimal reservation**

- Validate policy and provider before writing.
- Use an administrator-supplied `Idempotency-Key` header.
- Build a length-limited immutable Context snapshot from the Issue without contact data.
- Create independent Context and Callback tokens and persist only their hashes.
- Reserve the Issue generation and Run in one D1 batch guarded by the current Issue
  version/active Workflow state.
- Call `FEEDBACK_WORKFLOW.create()` only after the reservation succeeds.
- If Cloudflare reports an already-retained instance ID, use
  `FEEDBACK_WORKFLOW.get(instanceId)` only after checking the D1 mapping.
- Return the raw scoped tokens exactly once to the internal Workflow payload, not to the
  administrator response.

**Step 4: Verify GREEN**

Run the focused Worker test and assert exactly one Workflow creation and one Run.

### Task 4: Dispatch the Codex job and normalize terminal callbacks

**Files:**
- Modify: `workers/share-worker.js`
- Modify: `tests/unit/feedback/share-worker-feedback-board.test.js`
- Modify: `wrangler.toml`

**Step 1: Write failing dispatch tests**

Cover GitHub success, authentication failure, retryable failure, duplicate delivery, and
terminal callback projection. Assert that logs/persisted payloads contain neither GitHub
credentials nor scoped token plaintext.

**Step 2: Verify RED**

Confirm the Phase 0 Workflow records its start but does not dispatch.

**Step 3: Implement the adapter**

- Read `FEEDBACK_GITHUB_TOKEN` only as a Worker Secret.
- Read non-secret repository/ref/workflow identifiers from Worker variables.
- Call the GitHub workflow-dispatch endpoint with a minimal payload.
- Pass Context and Callback tokens as separate inputs; the Action masks them before use.
- Persist delivery status and retry only 429/5xx/network errors with bounded backoff.
- Project normalized callback events into Run/Issue state without treating Run success as
  Issue resolution.

**Step 4: Verify GREEN**

Run focused tests and Wrangler dry-run with explicit `--config wrangler.toml`.

### Task 5: Install the pinned official Codex Action workflow

**Prerequisite:** Explicit authorization to create `.github/**`.

**Files:**
- Create: `.github/workflows/feedback-agent-codex.yml`
- Create: `.github/codex/prompts/feedback-agent.md`
- Create: `.github/codex/config.toml`
- Test: `tests/unit/feedback/feedback-v2-infrastructure.test.js`

**Step 1: Write failing static contract tests**

Assert checkout uses `persist-credentials: false`, the Codex Action is pinned to a full
commit SHA, `safety-strategy` is `drop-sudo`, `permission-profile` is supplied without the
legacy `sandbox` input, token inputs are masked before network calls, and the failure
callback uses `if: always()`.

**Step 2: Verify RED**

Run the infrastructure test and confirm the workflow is missing.

**Step 3: Add the workflow and profile**

Support `workflow_dispatch` inputs for Issue/Workflow/Run identity, policy, provider,
permission profile, base commit, Context URL/token, and Callback URL/token. Checkout the
specified base commit, fetch Context, run the pinned official Action, execute the selected
quality gates, upload private artifacts, and always send one normalized terminal callback.

**Step 4: Verify GREEN**

Run static contract tests and GitHub workflow syntax validation.

### Task 6: Verify the Phase 1 delivery slice

**Files:**
- Modify: `tests/scenarios/feedback-workbench.md`
- Create or modify an allowed E2E journey under `tests/e2e/`

**Steps:**
1. Mark only fully automated scenario branches active; record the real Action smoke as
   manual until credentials and remote deployment are available.
2. Run `npm run check:scenarios`.
3. Run focused Worker and infrastructure tests.
4. Run `npm test`.
5. Run `npm run build`.
6. Run `npm run feedback:worker:dry-run`.
7. Deploy to a non-production target and perform one real
   `implement_and_verify` Action smoke before claiming Phase 1 complete.
