# AGENTS.md Anti-Patterns

Avoid these patterns when creating or updating `AGENTS.md`.

## Critical Anti-Patterns

### ❌ "You are a helpful assistant"

```markdown
# Bad
You are a helpful coding assistant. Please follow best practices.
```

```markdown
# Good
Remove entirely — this adds no operational value.
```

### ❌ Generic Boilerplate

Content that could apply to **any** project:

- "Write clean code."
- "Follow best practices."
- "Make sure everything works."
- "Be careful."
- "Use good naming conventions."

**Replace with:** Concrete commands, paths, and rules specific to this project.

### ❌ Invented Commands/Paths

```markdown
# Bad
Run `npm run verify-all-the-things` to check everything.
```

```markdown
# Good
Run `npm test && npm run lint` — these match scripts in package.json.
```

Every command must be verifiable. Every path must exist.

### ❌ README Duplication

Do not copy:
- Project marketing language
- User-facing setup prose
- Long architecture essays
- Installation troubleshooting

**Do instead:** Summarize only what an agent needs to edit safely, then link to the source.

### ❌ Including Secrets

```markdown
# Bad — NEVER do this
API_KEY=sk-abc123...
DATABASE_URL=postgres://prod...
```

**AGENTS.md is version controlled.** Secrets belong in `.env.local` or secret managers.

### ❌ Confusing Workflow Guards

This is nuanced based on workflow:

| Workflow | Rule |
|----------|------|
| **Create** | Skip if exists |
| **Review** | Read-only |
| **Update** | Preserve + merge (never wholesale replace) |
| **Migrate** | Merge if exists |
| **Split** | Create if justified |

```markdown
# Bad — applying Create guard to Update workflow
User: "Update AGENTS.md to add new rules"
Agent: "AGENTS.md already exists — skipping"
```

```markdown
# Good — Update workflow preserves and merges
User: "Update AGENTS.md to add new rules"
Agent: "Reading existing AGENTS.md... Adding new rules..."
```

## Structural Anti-Patterns

### ❌ Padding Empty Sections

```markdown
# Bad
## Testing
[No tests exist in this project]
```

```markdown
# Good
[Omit the Testing section entirely]
```

If a section doesn't apply, remove it entirely.

### ❌ Over-Nesting

Don't create nested `AGENTS.md` for every directory:

```
# Bad structure
src/
  AGENTS.md
  components/
    AGENTS.md
    atoms/
      AGENTS.md  ← too deep
    molecules/
      AGENTS.md
```

Create nested files only when:
- Subtree has different commands
- Subtree has distinct conventions
- Subtree has different risk profile

### ❌ Bare Negatives

```markdown
# Bad
- Do not use var.
- Do not use eval.
- Do not use inline styles.
- Do not commit secrets.
- Do not push to main.
```

```markdown
# Good
- Use `const` or `let` instead of `var`.
- Use named exports; do not use `export default` in this codebase.
- Use CSS classes from `src/styles/theme.css`; do not use inline styles.
```

Prefer positive rules with alternatives.

### ❌ Stale or Contradictory Rules

```markdown
# Bad — conflicts with root
## Commands
npm run serve  ← but root says `npm run dev`

# Bad — outdated
Run `python manage.py migrate` ← project now uses Docker
```

Stale instructions are worse than missing instructions.

### ❌ Describing Feelings/Thoughts

```markdown
# Bad
- Think carefully before making changes.
- Be mindful of the codebase.
- Feel free to ask questions.
```

```markdown
# Good
- Before modifying `auth/`, read `auth/README.md`.
- If a change affects the public API, update `docs/api.md`.
```

### ❌ Pasting Provider-Specific Behavior Guides Wholesale

```markdown
# Bad
## Claude Instructions
- Think carefully before coding.
- Always be helpful.
- Use best practices.
```

```markdown
# Good
## Working Principles
- Ask before editing when requirements are ambiguous.
- Keep diffs focused on the requested change.
- Run `npm test -- --runInBand` for backend changes.
```

AGENTS.md is provider-neutral. Extract only actionable rules that help with this repository.

## Quick Reference

| Anti-Pattern | Fix |
|--------------|-----|
| Generic advice | Make it project-specific |
| Invented commands | Verify from manifests/CI |
| README copy | Link to README, summarize only agent needs |
| Empty sections | Remove entirely |
| Over-nesting | Only nest for real differences |
| Bare negatives | Add "Do X instead" |
| Stale rules | Remove or update |
| Secrets | Never include |
| Workflow confusion | Match guard to workflow type |
| Provider-specific behavior dumps | Extract short, actionable, provider-neutral rules |
