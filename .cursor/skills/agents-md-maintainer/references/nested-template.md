# Nested AGENTS.md Template

Use nested files only when a subtree has local rules that differ from the repository root.

## Template

```markdown
# [Subfolder Name] — Agent Instructions

## Overview
[1-2 sentences: what this folder does, its role in the larger system]

## Build & Run
[Folder-specific commands, e.g., `cd this && npm run test`]

## Testing
[Folder-specific test commands]

## Project Structure
[Key files/dirs in this folder, entry points]

## Local Conventions
[Naming patterns, imports, file organization specific to this folder]

## Boundaries
- ✅ **Always do:** [folder-specific safe operations]
- ⚠️ **Ask first:** [folder-specific risky operations]
- 🚫 **Never do:** [folder-specific dangerous operations]
```

## When to Create a Nested File

| Condition | Create nested? |
|----------|----------------|
| Subtree has its own `package.json` | ✅ Yes |
| Subtree uses different framework | ✅ Yes |
| Subtree has different test runner | ✅ Yes |
| Subtree has distinct naming conventions | ✅ Yes |
| Subtree contains risky code (auth, DB, secrets) | ✅ Yes |
| Subtree follows parent conventions exactly | ❌ No |
| Only 1-2 files in subtree | ❌ No |
| Nested depth > 3 levels | ❌ No |

## Anti-Patterns

**Wrong:** Copying root rules verbatim:
```markdown
## Boundaries
- ✅ Always do: Run tests before committing  ← repeated from root
```

**Correct:** Only include local specifics:
```markdown
## Boundaries
- ✅ **Always do:** Run `cd src/api && npm test` for this module
- 🚫 **Never do:** Import from `../components/` — use shared hooks instead
```

## Scope Indicator

Always include a scope statement to clarify what this file covers:

```markdown
## Scope
This file applies to `packages/auth/` and overrides the root AGENTS.md for this package.
```
