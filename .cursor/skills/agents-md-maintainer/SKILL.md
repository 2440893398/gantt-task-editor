---
name: agents-md-maintainer
description: Create, update, review, split, or migrate AGENTS.md files for repositories. Use when the user asks about AGENTS.md, agents.md, coding-agent instructions, repository agent context, nested/scoped agent guidance, converting CLAUDE.md/GEMINI.md/.cursorrules/.github/copilot-instructions.md into AGENTS.md, or checking an AGENTS.md file against best practices. Do not use for normal feature coding unless the user explicitly asks to change agent instructions.
license: MIT
metadata:
  author: Cursor Agent
  version: "3.0.0"
  source: Inspired by microsoft/wiki-agents-md
---

# AGENTS.md Maintainer

Manage `AGENTS.md` files across the agent skills lifecycle: create, review, update, split, and migrate.

> **AGENTS.md complements README.md.** README is for humans; AGENTS.md is for coding agents.

---

## Workflow Router

Determine which workflow applies based on user intent:

| User says... | Workflow | Guard rule |
|--------------|----------|------------|
| "generate AGENTS.md" / "create AGENTS.md" | **Create** | Skip if exists |
| "review AGENTS.md" / "audit" / "check quality" | **Review** | Read-only |
| "update AGENTS.md" / "add rules to AGENTS" | **Update** | Preserve + merge |
| "migrate from CLAUDE.md" / "convert .cursorrules" | **Migrate** | Merge or create |
| "split AGENTS.md" / "create nested" | **Split** | Create nested if justified |

> **Critical:** Do not confuse workflows. A request to "update AGENTS.md" must NOT trigger the "skip if exists" guard from Create workflow.

---

## Cross-Platform Notes

When checking file existence or listing files, use syntax that matches the current shell:

- **Bash/Zsh:** `test -f <path>` / `find . -name "*.md"`
- **PowerShell:** `Test-Path -LiteralPath '<path>' -PathType Leaf` / `Get-ChildItem -Recurse -File`

See `references/migration-map.md` for additional cross-platform inventory commands.

---

## Workflow A: Create

**Trigger:** Generate AGENTS.md where it is missing.

### Guard: Only If Missing

Before generating for ANY folder, check with a filesystem tool or the current shell's native syntax. Do not assume Bash syntax works in every environment.

```bash
test -f <folder>/AGENTS.md
```

```powershell
Test-Path -LiteralPath '<folder>\AGENTS.md' -PathType Leaf
```

- If exists → **skip** and report: `"AGENTS.md already exists at [path] — skipping"`
- If does not exist → proceed with generation

### Folder Selection

| Priority | Folder | Reason |
|----------|--------|--------|
| **Always** | Repository root (`/`) | Global project context |
| **Candidate** | `src/`, `lib/`, `app/`, `api/` | Has source code |
| **Candidate** | `tests/`, `test/`, `__tests__/` | Has test code |
| **Candidate** | `packages/*/`, `apps/*/` | Monorepo packages |
| **Candidate** | `wiki/`, `docs/` | Has documentation |
| **Skip** | `node_modules/`, `.git/`, `dist/`, `build/` | Generated/third-party |

> **Candidate folders:** Generate only if they have independent manifest (`package.json`, `Cargo.toml`, etc.), different tech stack, different risk profile, or user explicitly requests.

### Create Steps

1. **Check existence** — use filesystem APIs or shell-appropriate checks (`test -f` in Bash, `Test-Path -PathType Leaf` in PowerShell)
2. **Scan folder** — language, framework, build tool, test runner
3. **Read configs** — `package.json`, `Makefile`, CI workflows
4. **Detect conventions** — read 3-5 source files
5. **Compose** — use only applicable sections from Six Core Areas
6. **Validate** — all commands/paths verified or marked inferred

### Six Core Areas

Use only sections that apply. **Put in this order.**

1. **Build & Run** — exact commands with flags
2. **Testing** — framework, commands, single-test, coverage
3. **Project Structure** — key directories, entry points
4. **Code Style** — conventions + one real code example
5. **Git Workflow** — only if evidence exists
6. **Boundaries** — three-tier (Always/Ask first/Never)

Optionally add a short **Working Principles** section after Boundaries when the repo already has agent behavior guidance, the user asks for it, or the project would benefit from explicit edit discipline. Keep it provider-neutral, actionable, and no longer than 3-5 bullets.

See `references/six-core-areas.md` for templates.

### Companion Adapters

When the selected workflow creates a new `AGENTS.md` (Create, or Migrate when the target is missing), also create `CLAUDE.md` — **only if `CLAUDE.md` does not exist**:

```markdown
# CLAUDE.md

<!-- Generated for repository development workflows. Do not edit directly. -->

Before beginning work in this repository, read `AGENTS.md` and follow all scoped AGENTS guidance.
```

Do not create or overwrite `GEMINI.md` by default. If the user asks for Gemini compatibility or the task is migrating an existing `GEMINI.md`, keep the source file unless asked otherwise and use `references/migration-map.md` to decide whether a lightweight adapter is appropriate.

---

## Workflow B: Review

**Trigger:** Audit existing AGENTS.md for quality, accuracy, or completeness.

### Rules

- **Read-only** — do not modify any files
- Report findings, don't fix them (unless user asks to update)
- Use `references/review-checklist.md` as guide

### Review Checklist

1. All commands verified in manifests/CI?
2. All paths exist in repository?
3. No placeholder text (`[TODO]`, `[FILL IN]`)?
4. No secrets or credentials?
5. Scope boundaries clear (root vs nested)?
6. Nested files don't contradict root?
7. Content is specific, not generic boilerplate?
8. Length appropriate (30-80 lines typical)?

---

## Workflow C: Update

**Trigger:** Add or modify rules in an existing AGENTS.md.

### Guard: NEVER Skip Existing

> **This is the key difference from Create workflow.**

When user asks to "update" or "add rules to" AGENTS.md:
- **Do NOT skip if exists** — this is the update workflow
- Preserve existing content that is still valid
- Add new content without wholesale replacement

### Update Steps

1. **Read existing** — understand current content
2. **Identify changes** — what needs adding/modifying/removing
3. **Apply changes** — merge new rules, update stale ones
4. **Validate** — no conflicts, no contradictions
5. **Report** — summarize what changed

### Update Principles

- **Preserve** — keep useful existing content
- **Merge** — add new content without erasing old
- **Replace only stale** — update outdated commands/paths
- **Never wholesale** — unless user explicitly asks for rewrite
- **Document conflicts** — if CI and local differ, note both

---

## Workflow D: Migrate

**Trigger:** Convert CLAUDE.md, GEMINI.md, .cursorrules, .github/copilot-instructions.md into AGENTS.md.

### Guard: Merge If Exists

- If target AGENTS.md exists → **merge** (don't skip)
- If target AGENTS.md does not exist → **create** (same as Create workflow)

### Migration Principles

- **Deduplicate** — if content already exists in AGENTS.md, don't duplicate
- **Keep source** — do not modify or delete the source file (unless user asks)
- **Categorize** — route content to appropriate sections

See `references/migration-map.md` for content routing rules.

---

## Workflow E: Split

**Trigger:** Create nested AGENTS.md for a subdirectory.

### Guard: Only If Justified

Create nested AGENTS.md only when the subtree has meaningful local differences from its parent: independent commands, a distinct framework or test runner, different conventions, or a different risk profile. Do not create nested files just because a folder exists.

### Scope Rule

Nested AGENTS.md should contain:
- Folder-specific commands (e.g., `cd src/api && npm test`)
- Local conventions that differ from parent
- Folder-specific boundaries

Nested AGENTS.md should NOT contain:
- Root-level rules (those belong in root AGENTS.md)
- Duplicate content from parent

### Templates

See `references/nested-template.md` for the complete nested template, decision table, anti-patterns, and scope indicator.

---

## Shared Quality Principles

Apply to all workflows.

| Principle | Good | Bad |
|-----------|------|-----|
| **Specific** | "React 18 + TypeScript + Vite" | "React project" |
| **Executable** | `pytest tests/ -v --tb=short` | "run the tests" |
| **Grounded** | Real code snippet from project | Abstract description |
| **Real paths** | `src/api/routes/` | `path/to/your/code/` |
| **Honest** | Omit section if no content | Invent content |
| **Concise** | 30-80 lines typical | 300+ lines prose |

---

## Shared Anti-Patterns

Apply to all workflows.

- ❌ **"You are a helpful assistant"** — too vague
- ❌ **Generic boilerplate** — applies to any project
- ❌ **Invented commands/paths** — must be real
- ❌ **Duplicating README** — link instead of copy
- ❌ **Including secrets** — never
- ❌ **Padding empty sections** — omit if no content
- ❌ **Describing thoughts/feelings** — describe actions

See `references/anti-patterns.md` for full list.

---

## Reference Map

| Task | Read this |
|------|-----------|
| Create AGENTS.md | `references/six-core-areas.md` |
| Create nested file | `references/nested-template.md` |
| Review AGENTS.md | `references/review-checklist.md` |
| Update AGENTS.md | (follow Update workflow above) |
| Migrate from other files | `references/migration-map.md` |
| Root template | `references/root-template.md` |
| Avoid mistakes | `references/anti-patterns.md` |
