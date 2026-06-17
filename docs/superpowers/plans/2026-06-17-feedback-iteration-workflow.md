# Feedback Iteration Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Implement the feedback iteration workflow that separates issue type classification from lifecycle status and supports AI-generated design decisions for requirements and larger optimizations.
**Architecture:** Extend the existing feedback Worker payload normalization and admin UI with classification metadata while preserving current KV records. Update the frontend feedback dialog/service to send optional user-selected business type. Update the scheduled automation prompt to classify issues, create design artifacts, and use `needs_human` plus structured `humanAction` blocks instead of adding more statuses.
**Tech Stack:** Vanilla JS, Cloudflare Worker, Workers KV, Vitest, Codex automation.

---

### Task 1: Worker Classification Model

**Files:**
- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

- [ ] **Step 1: Write failing Worker tests**

Add tests that verify:

- `POST /api/feedback` accepts `sourceType=manual` and `submittedType=bug`.
- Missing `submittedType` is normalized to `unclear`.
- Existing records with `type=manual` remain readable with `sourceType=manual`.
- Admin detail includes `submittedType`, `sourceType`, and normalized `ai` classification.
- Invalid admin classification values are rejected.

- [ ] **Step 2: Run Worker tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: FAIL because classification fields and validation are not implemented.

- [ ] **Step 3: Add classification constants and normalizers**

In `workers/share-worker.js`, add:

- `FEEDBACK_SOURCE_TYPES`
- `FEEDBACK_BUSINESS_TYPES`
- `FEEDBACK_SCOPES`
- `FEEDBACK_AUTOMATION_DECISIONS`
- `normalizeSourceType(value, fallback)`
- `normalizeSubmittedType(value)`
- `normalizeAiClassification(feedback)`

- [ ] **Step 4: Normalize create/read paths**

Update `normalizeFeedbackPayload()` and `normalizeStoredFeedback()` so records expose:

- `sourceType`
- `submittedType`
- `ai.businessType`
- `ai.scope`
- `ai.automationDecision`
- `ai.classifiedAt`
- `ai.confidence`

Keep existing `type` for backward compatibility.

- [ ] **Step 5: Validate admin updates**

Extend `validateWorkflowPatch()` and `updateFeedbackIssue()` to allow validated updates for:

- `sourceType`
- `submittedType`
- `ai.businessType`
- `ai.scope`
- `ai.automationDecision`
- `ai.confidence`

- [ ] **Step 6: Run Worker tests and verify pass**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: PASS.

### Task 2: Feedback Submission UI And Service

**Files:**
- Modify: `src/features/feedback/FeedbackDialog.js`
- Modify: `src/features/feedback/feedbackService.js`
- Modify: `src/locales/zh-CN.js`
- Modify: `src/locales/en-US.js`
- Modify: `src/locales/ja-JP.js`
- Modify: `src/locales/ko-KR.js`
- Test: `tests/unit/feedback/feedback-service.test.js`
- Test: `tests/unit/feedback/feedback-dialog.test.js`

- [ ] **Step 1: Write failing service tests**

Add tests that verify:

- Manual feedback sends `sourceType=manual` and selected `submittedType`.
- Missing selection sends `submittedType=unclear`.
- Runtime error reports send `sourceType=auto_error` and `submittedType=bug`.

- [ ] **Step 2: Write failing dialog test**

Add a test that opens the feedback dialog and verifies the type selector contains:

- Bug
- Optimization
- Requirement
- Other
- Not sure

- [ ] **Step 3: Run feedback tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/feedback/feedback-service.test.js tests/unit/feedback/feedback-dialog.test.js
```

Expected: FAIL before implementation.

- [ ] **Step 4: Update service payload**

Update `submitFeedback()` to send:

- `sourceType: feedback.sourceType || 'manual'`
- `submittedType: feedback.submittedType || feedback.type || 'unclear'`
- `type` retained for compatibility.

Update `reportRuntimeError()` to send:

- `sourceType: 'auto_error'`
- `submittedType: 'bug'`
- `type: 'auto_error'`

- [ ] **Step 5: Update dialog selector**

Replace current feedback type options with business type options while keeping the submit flow low-friction. Pass `submittedType` to `submitFeedback()`.

- [ ] **Step 6: Update locale strings**

Add labels for optimization, requirement, other, and not sure in all locale files.

- [ ] **Step 7: Run feedback tests and verify pass**

Run:

```powershell
npx vitest run tests/unit/feedback/feedback-service.test.js tests/unit/feedback/feedback-dialog.test.js
```

Expected: PASS.

### Task 3: Admin Board Workflow Rendering

**Files:**
- Modify: `workers/share-worker.js`
- Test: `tests/unit/feedback/share-worker-feedback-board.test.js`

- [ ] **Step 1: Write failing admin board tests**

Add tests that verify `/feedback` HTML contains rendering helpers or labels for:

- Submitted type.
- AI type.
- Scope.
- Automation decision.
- Human action next step.
- Design review section.
- Candidate metadata section.

- [ ] **Step 2: Run Worker tests and verify failure**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: FAIL before UI support.

- [ ] **Step 3: Add parse helpers in page script**

Inside the self-contained `/feedback` page script, add parser helpers for:

- `[feedback-agent-human-action]`
- `[feedback-agent-design]`
- `[feedback-agent-candidate]`

- [ ] **Step 4: Render panels**

Render compact admin-only panels in issue detail:

- Classification panel.
- Human action panel when status is `needs_human`.
- Design review panel when design block exists.
- Candidate panel when candidate block exists.

- [ ] **Step 5: Run Worker tests and verify pass**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js
```

Expected: PASS.

### Task 4: Automation Prompt

**Files:**
- Update existing Codex automation `process-gantt-feedback-issues`

- [ ] **Step 1: Update automation prompt**

Use `codex_app.automation_update` to update the existing automation. The prompt must:

- Classify `businessType`, `scope`, and `automationDecision`.
- Generate `feedback-agent-design` for requirements and large optimizations.
- Use `needs_human` with `humanAction=design_decision` for human approval.
- Resume implementation when a human sets the issue back to `queued`.
- Keep `ready_for_deploy` only for approved candidate implementation merge/deploy.
- Avoid adding new statuses.

- [ ] **Step 2: Verify prompt was written**

Inspect the automation config and confirm it contains:

- `businessType`
- `feedback-agent-design`
- `humanAction=design_decision`
- `ready_for_deploy`

### Task 5: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
npx vitest run tests/unit/feedback/share-worker-feedback-board.test.js tests/unit/feedback/feedback-service.test.js tests/unit/feedback/feedback-dialog.test.js
```

Expected: PASS.

- [ ] **Step 2: Run formatting check**

Run:

```powershell
npx prettier --check workers/share-worker.js src/features/feedback/FeedbackDialog.js src/features/feedback/feedbackService.js tests/unit/feedback/share-worker-feedback-board.test.js tests/unit/feedback/feedback-service.test.js tests/unit/feedback/feedback-dialog.test.js
```

Expected: PASS.

- [ ] **Step 3: Report deploy gap**

Do not deploy unless explicitly instructed. Report that Worker deployment is required before production feedback board supports the new fields.
