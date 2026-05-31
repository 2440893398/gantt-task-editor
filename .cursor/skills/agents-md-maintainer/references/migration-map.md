# Migration Map

Guide for migrating from other instruction files to AGENTS.md.

---

## Source File Taxonomy

Not all instruction files are the same. Route content appropriately:

| Source | Type | Migrate to AGENTS.md? | Keep as-is? | Notes |
|--------|------|----------------------|-------------|-------|
| `CLAUDE.md` | Companion adapter or agent behavior guidance | ✅ Selective | Optional | Redirects can stay as adapters; actionable behavior rules can become Working Principles or Boundaries |
| `GEMINI.md` | Companion adapter or agent behavior guidance | ✅ Selective | Optional | Same routing as `CLAUDE.md`; do not create or overwrite by default |
| `.cursorrules` | Coding conventions | ✅ Yes (merge) | Optional | Keep if user prefers |
| `.cursor/rules/*.md` | Path/glob-scoped rules | ⚠️ Conditional | ✅ Yes | Migrate only directory-scoped content into nested AGENTS.md; keep glob/file-type rules separate |
| `.github/copilot-instructions.md` | Workspace instructions | ✅ Yes (merge) | Optional | Deduplicate with existing |
| `.github/instructions/*.md` | Path/glob-scoped instructions | ⚠️ Conditional | ✅ Yes | Migrate only directory-scoped content into nested AGENTS.md; keep glob/file-type rules separate |
| `.github/agents/*.agent.md` | **Agent persona** | ❌ Never | ✅ Yes | Not for AGENTS.md — different purpose |

---

## What Goes Into AGENTS.md

Content that tells agents **what to do with this codebase**:

| Category | Content | Example |
|----------|---------|---------|
| **Commands** | Build, test, lint, format commands | `npm run test`, `make build` |
| **Structure** | Directory layout, entry points | `src/api/`, `src/main.ts` |
| **Conventions** | Naming, imports, patterns | `snake_case` for Python |
| **Boundaries** | Always/Ask first/Never rules | `⚠️ Ask before DB migration` |
| **Verification** | What to check before commit | `Run tests and lint` |
| **Workflows** | Step-by-step fragile tasks | `How to add a new API endpoint` |
| **Working principles** | Provider-neutral edit discipline | `Keep diffs focused; ask when requirements are ambiguous` |

---

## What Stays Separate

### Companion Adapters

Files that only redirect to AGENTS.md — keep as simple redirectors:

```markdown
# CLAUDE.md
Before working in this repo, read `AGENTS.md`.
```

```markdown
# GEMINI.md
See `AGENTS.md` for project-specific guidance.
```

These are lightweight and tell other agents where to find the authoritative instructions.

### Agent Behavior Guidelines

Files like `CLAUDE.md` sometimes contain general coding-agent behavior guidance instead of a redirect. Migrate selectively:

| Source content | Destination |
|----------------|-------------|
| Ask when requirements are ambiguous | `## Working Principles` |
| Keep changes scoped to the request | `## Working Principles` or `## Boundaries` |
| Avoid speculative abstractions | `## Working Principles` or `## Code Style` |
| Run focused tests or checks before finishing | `## Testing` or `## Working Principles` |
| Provider-specific phrasing like "Claude should..." | Rewrite provider-neutral or skip |

Do not paste a generic behavior guide wholesale. Keep at most 3-5 bullets, make each bullet actionable, and prefer repo-specific commands or paths when available.

### Path-Scoped Rules

Content that is **file-pattern-specific, IDE-specific, or tool-specific** should stay in its original system unless the user explicitly asks to move it:

| Content | Keep separate? | Alternative |
|---------|---------------|-------------|
| Rules for specific file types (e.g., "for `.graphql` files...") | ✅ Yes | Keep existing `.cursor/rules/graphql.md` or `.github/instructions/graphql.instructions.md` |
| Editor config (format on save, etc.) | ✅ Yes | `.editorconfig` |
| Language server config | ✅ Yes | `*.config.js` |
| Pre-commit hooks | ✅ Yes | `.husky/` |
| IDE-specific settings | ✅ Yes | `.vscode/settings.json` |

### Agent Personas

`.github/agents/*.agent.md` defines **who the agent is**, not **what to do with the code**:

```markdown
---
name: code-reviewer
description: Reviews code for security vulnerabilities
tools: [Read, Grep, Shell]
---

You are a security-focused code reviewer. Focus on:
- SQL injection vulnerabilities
- XSS attack vectors
- Authentication bypass patterns
```

**Never migrate agent personas to AGENTS.md.** They serve a different purpose.

---

## Migration Decision Tree

```
Is the content about WHAT to do with this codebase?
│
├── YES: Does it fit in AGENTS.md sections?
│   ├── YES: Migrate to AGENTS.md (merge if exists)
│   └── NO: Is it directory-scoped and useful for a subtree?
│       ├── YES: Migrate to nested AGENTS.md if justified
│       └── NO: Is it glob/file-type scoped?
│           ├── YES: Keep the original path-scoped instruction file
│           └── NO: Drop (generic enough to skip)
│
└── NO: Is it about WHO the agent is?
    ├── YES: Keep in .github/agents/*.agent.md
    └── NO: Is it editor/IDE config?
        └── YES: Keep in .vscode/, .editorconfig, etc.
```

---

## Migration Steps

### 1. Inventory Source Files

List all instruction files present with the current shell's native syntax:

```bash
find . -maxdepth 3 \( -name "AGENTS.md" -o -name "CLAUDE.md" -o -name "GEMINI.md" -o -name ".cursorrules" -o -path "*/.cursor/rules/*" -o -path "*/.github/instructions/*" -o -name "copilot-instructions.md" \)
```

```powershell
Get-ChildItem -Recurse -File -Include AGENTS.md,CLAUDE.md,GEMINI.md,.cursorrules,copilot-instructions.md,*.instructions.md |
  Select-Object -ExpandProperty FullName
```

### 2. Read and Categorize

For each source file:

1. What type is it? (Companion / Agent behavior / Conventions / Persona / Path-scoped)
2. What content is AGENTS.md-relevant?
3. What content should stay separate?

### 3. Execute Migration

| Scenario | Action |
|----------|--------|
| Target AGENTS.md doesn't exist | Create with migrated content |
| Target AGENTS.md exists | Merge content, preserve existing |
| Content is agent behavior guidance | Extract only actionable, provider-neutral rules into Working Principles, Boundaries, or Testing |
| Content is persona | Skip, leave in `.github/agents/` |
| Content is directory-scoped | Merge into nearest justified nested `AGENTS.md` |
| Content is glob/file-type scoped | Keep original `.cursor/rules/` or `.github/instructions/` file; optionally summarize/link from AGENTS.md |

### 4. Deduplicate

- Don't copy the same rule twice
- If content already exists in AGENTS.md, skip it
- If similar content exists, merge and clarify

### 5. Keep Source Files

> **Important:** Do not delete source files unless user explicitly asks.

Migrations are additive. Keep the originals so users can verify and rollback.

---

## Examples

### Example: Migrating .cursorrules

**.cursorrules content:**
```markdown
- Always use type hints
- Prefer const over let
- No var
- Use async/await
```

**AGENTS.md Code Style section:**
```markdown
## Code Style

- Type hints required on all function signatures
- Use `const` or `let`; never `var`
- Prefer async/await over raw promises
```

### Example: Migrating Agent Behavior Guidance

**Source content:** General rules such as clarify ambiguous requirements, keep changes focused, avoid unnecessary abstractions, and verify before finishing.

**AGENTS.md Working Principles section:**
```markdown
## Working Principles

- Ask before editing when requirements are ambiguous.
- Keep diffs focused on the requested change; mention unrelated issues instead of fixing them.
- Match existing patterns before adding new abstractions.
- Run the closest relevant verification before finishing.
```

**Decision:** Keep the guidance only if it would change agent behavior in this repository. Skip provider-specific framing and generic motivation.

### Example: Keeping Path-Scoped Rules

**Content:** "For all `.graphql` files, use the schema-first approach"

**Decision:** This is file-type scoped and AGENTS.md can't express glob activation precisely.

**Action:** Keep the original `.cursor/rules/graphql.md` or `.github/instructions/graphql.instructions.md`. If useful, add a brief pointer in AGENTS.md such as "GraphQL-specific rules live in `.cursor/rules/graphql.md`."

### Example: Never Migrate Agent Persona

**.github/agents/security-reviewer.agent.md:**
```markdown
---
name: security-reviewer
description: Analyzes code for security vulnerabilities
---

You are a security expert. Always check for:
- SQL injection
- XSS
- Authentication issues
```

**Decision:** This defines the agent's identity, not project context.

**Action:** Keep as-is. Don't migrate to AGENTS.md.

---

## Anti-Patterns

### ❌ Migrating Everything

Don't migrate every line from every file. Be selective:

```markdown
# Bad
# Migrated from CLAUDE.md
You are a helpful AI assistant...

# This repo is a React project...

# Always use best practices...
```

```markdown
# Good
# Only AGENTS.md-relevant content
## Code Style
- TypeScript strict mode required
- No `any` type without comment
```

### ❌ Deleting Sources During Migration

```markdown
# Bad
# Just migrated .cursorrules to AGENTS.md
# Deleting original...
```

Keep sources until user confirms migration is successful.

### ❌ Mixing Personas with Context

```markdown
# Bad — mixing agent persona with AGENTS.md
## You are a security-focused reviewer
Always look for vulnerabilities...
```

AGENTS.md is for context, not personas. Personas go in `.github/agents/`.
