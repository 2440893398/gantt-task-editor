# AGENTS.md Review Checklist

Use this checklist when auditing an existing `AGENTS.md`.

## Pre-Review: Identify Workflow Intent

| User asks... | Review focus |
|--------------|--------------|
| "review AGENTS.md" | Full quality audit |
| "check if AGENTS.md is accurate" | Verify commands/paths |
| "is AGENTS.md complete?" | Check Six Core Areas coverage |
| "audit AGENTS.md quality" | All checklist items |

## Grounding Verification

Verify all content comes from real sources:

- [ ] All commands copied from real manifests (`package.json`, `Makefile`, `pyproject.toml`, etc.)
- [ ] All commands verified in CI configs or scripts
- [ ] All referenced paths exist in the repository
- [ ] Package managers and runtime versions verified
- [ ] Inferred facts clearly labeled as "inferred" or "unverified"
- [ ] No placeholder text like `[TODO]`, `[FILL IN]`, or `...`

## Six Core Areas Coverage

| Area | Required? | Check |
|------|-----------|-------|
| Build & Run | Only if has build system | Commands match actual scripts |
| Testing | Only if has tests | Framework and commands match reality |
| Project Structure | Only if >1 dir | Paths all exist |
| Code Style | Only if non-obvious | Examples from actual code |
| Git Workflow | Only if evidence exists | Matches commitlint, PR templates, CI |
| Boundaries | Recommended | Specific to this project |
| Working Principles | Optional | Actionable, provider-neutral, not generic motivation |

## Scope Consistency

- [ ] Root rules are truly global (apply everywhere)
- [ ] Nested files justified by real local differences
- [ ] Nested files **not** repeating root rules verbatim
- [ ] Parent and child instructions consistent (no conflicts)
- [ ] Nested depth ≤ 3 levels

## Safety Verification

- [ ] No secrets, tokens, credentials, or API keys
- [ ] No private endpoint URLs
- [ ] No machine-specific paths (e.g., `/home/user/...`)
- [ ] Risky operations marked "Ask first":
  - [ ] Database migrations
  - [ ] Public API changes
  - [ ] Deployment config
  - [ ] Auth/security code
  - [ ] Billing/payment code
  - [ ] Third-party integrations

## Quality Metrics

- [ ] Total lines: 30-80 for most folders
- [ ] Long explanations replaced with links to docs
- [ ] Each section adds operational value
- [ ] Future maintainer knows when to update this file
- [ ] Content is specific, not generic boilerplate

## Workflow Consistency

- [ ] Correct workflow was selected based on user intent
- [ ] Guard rules were applied correctly for the selected workflow:
  - [ ] Create workflow: skips existing
  - [ ] Review workflow: read-only
  - [ ] Update workflow: preserves existing
  - [ ] Migrate workflow: merges content
- [ ] Report reflects the workflow that was executed

## Completion Gates

Before reporting "done":

1. ✅ All commands verified in repo or marked as inferred
2. ✅ All paths verified to exist
3. ✅ No placeholder content
4. ✅ No secrets
5. ✅ Scope boundaries clear
6. ✅ Nested files don't contradict root
7. ✅ Workflow guards applied correctly
