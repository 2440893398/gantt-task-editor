# AI Development Quality Gates

This document defines the minimum sufficient verification workflow for AI-assisted
development in this repository. The goal is to avoid under-testing user scenarios
without turning every small change into a long, high-token process.

## Default Policy

Use the smallest verification level that can reasonably prove the change is safe.
Start at Tier 1 for code changes, then upgrade only when the change touches higher-risk
behavior or verification reveals a broader impact.

## Risk Tiers

### Tier 0: Trivial Change

Use for copy edits, small style tweaks, obvious typos, comments, and documentation-only
changes that do not change runtime behavior.

Required workflow:

- No full quality plan.
- State what changed in the final response.
- Run a minimal check only when it is cheap and relevant.
- If no test is run, say why.

### Tier 1: Low-Risk Code Fix

Use for single-function logic, small conditional changes, or narrow local UI fixes that
do not alter data shape, persistence, hierarchy, async refresh, or cross-module state.

Required workflow:

- Before editing, write a three-line lightweight plan:
  - Scenario:
  - Risk:
  - Verification:
- Run a targeted unit test or the smallest related check.
- Browser verification is optional unless the issue is visible UI behavior.

### Tier 2: Medium-Risk Interaction Change

Use for modals, search, filters, tables, selection state, local state synchronization,
or other user-visible interaction changes.

Required workflow:

- Write a short quality plan before editing.
- Add or run at least one targeted test or reproducible check.
- Verify the relevant UI path with browser, DOM inspection, or a documented fallback.
- Include verification evidence in the final response.

### Tier 3: High-Risk Core Flow

Use for drag/drop, task hierarchy, dependency links, persistence, import/export,
calendar/worktime/cache refresh, batch operations, undo/redo, or multi-module changes.

Required workflow:

- Write a complete quality plan before editing.
- Reproduce the defect or write a failing regression test before implementation.
- Run targeted unit/integration tests plus browser or DOM-level user-flow verification.
- List uncovered risks explicitly.
- Use reviewer/subagent review when the change spans multiple modules or critical flows.

## Token Control Rules

- Prefer `rg` with precise terms over broad file reading.
- Prefer targeted tests over full-suite runs while iterating.
- Do not start browser verification until the relevant code path is identified.
- Browser-check only the key path for the change, not the whole app.
- Summarize command output; do not paste long logs into the final response.
- Escalate one tier at a time when a test fails, scope expands, or the user reports a regression.

## Agent Decision Flow

1. Classify the requested change as Tier 0, 1, 2, or 3.
2. Use the matching plan and verification level.
3. Edit only after the required plan for that tier is written.
4. Run the smallest verification that proves the change.
5. Escalate if the change touches higher-risk behavior than initially expected.
6. In the final response, report evidence and any verification gaps.

## Final Response Evidence

For Tier 1 and above, include a short verification block:

```text
Verification:
- Command or check:
- Result:
- Browser/DOM path, if applicable:
- Gap, if any:
```

Do not claim a fix is complete without fresh evidence from this turn. If verification is
blocked by environment limits, say what was verified and what remains unverified.
