# Hook Recipes

Use these patterns after selecting the repo's check command.

## Unified Check Command

Create or reuse one command that runs the project gates in this order:

1. format check
2. lint
3. typecheck or build
4. architecture/dependency check
5. targeted tests

Prefer names already common in the repo: `check`, `verify`, `quality:check`, or `ci`.

## Claude Code

Use `PostToolUse` for broad post-edit feedback. Use `Stop` only when the installed Claude Code version and project policy support final-response hooks.

Recommended pattern:

- `PostToolUse` with matcher `Edit|Write|MultiEdit` runs fast formatting/linting for changed files when possible.
- If `Stop` is available, run the unified check command there and return `decision: "block"` or exit `2` with concise feedback when checks fail.
- If `Stop` is unavailable, rely on `PostToolUse` plus Git hooks/CI for enforcement.

Keep hook scripts in `.claude/hooks/` and hook config in `.claude/settings.json` unless the project already uses another Claude config layout.

Example project hook script:

```bash
#!/usr/bin/env bash
set -euo pipefail
if ! npm run quality:check >/tmp/quality-check.log 2>&1; then
  echo "Quality gate failed. Run npm run quality:check locally." >&2
  tail -n 80 /tmp/quality-check.log >&2
  exit 2
fi
```

Example `.claude/settings.json` shape when `Stop` is supported:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/quality-stop.sh",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

## Codex

Use `.codex/hooks.json` or `.codex/config.toml`.

Recommended pattern:

- `PostToolUse` with matcher `apply_patch|Edit|Write` runs the fast check command.
- `Stop` runs the unified check command and returns `decision: "block"` with a concise reason if it fails.
- Include `commandWindows` when creating portable project hooks on Windows.

Project-local hooks only run when the `.codex/` project layer is trusted, so mention `/hooks` review if needed.

Example `.codex/hooks.json` shape:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"$(git rev-parse --show-toplevel)/scripts/quality/ai_stop_check.py\"",
            "commandWindows": "py -3 \"%CD%\\scripts\\quality\\ai_stop_check.py\"",
            "timeout": 120,
            "statusMessage": "Running quality gates"
          }
        ]
      }
    ]
  }
}
```

Example Codex stop hook output from the script when checks fail:

```json
{
  "decision": "block",
  "reason": "Quality gate failed: npm run quality:check. Fix the reported lint/type/test errors and rerun."
}
```

## Cursor

Cursor rules guide agent behavior, while Git hooks and CI enforce checks. Do not invent a project-local Cursor hook format unless the user's Cursor version documents one.

Recommended pattern:

- Add or update `.cursor/rules/*.mdc` with the unified check command and quality policy.
- Add Git hooks through pre-commit, Husky, Lefthook, or a plain `.git/hooks` installer for enforcement.
- For Cursor Background Agents, use webhook/status integration for notification or CI follow-up; keep CI as the merge gate.
- If a team has documented Cursor agent hooks, write a small project script first, then have Cursor call that script rather than duplicating commands.

Example `.cursor/rules/quality-gates.mdc` body:

```markdown
---
description: Run repository quality gates after code changes
globs:
  - "**/*"
alwaysApply: true
---

After editing code, run the repository quality command before reporting completion:

`npm run quality:check`

Treat failures as work to fix, not as optional follow-up.
```

## GitHub Copilot

GitHub Copilot project instructions guide suggestions, but they do not enforce local checks.

Recommended pattern:

- Add or update `.github/copilot-instructions.md` with the unified check command and quality policy.
- If the repo uses prompt files or chat mode instructions, reference the same command there.
- Enforce with pre-commit/Husky/Lefthook and CI, not Copilot instructions alone.

Example `.github/copilot-instructions.md` section:

```markdown
## Quality gates

After editing code, run the repository quality command before reporting completion:

`npm run quality:check`

Fix lint, typecheck, architecture, and test failures before suggesting that work is complete.
```

## Git Hooks

Use a managed hook runner when possible:

- Python/polyglot: `pre-commit`
- JS/TS: Husky with lint-staged, or Lefthook for language-neutral teams
- Multi-language repos: pre-commit or Lefthook

Keep pre-commit fast. Use pre-push or CI for full tests.

Example `.pre-commit-config.yaml` shape for repo-owned scripts:

```yaml
repos:
  - repo: local
    hooks:
      - id: quality-fast
        name: quality-fast
        entry: scripts/quality/check-fast.sh
        language: system
        pass_filenames: false
```

Example Husky shape:

```bash
npx husky init
echo "npx lint-staged && npm run quality:fast" > .husky/pre-commit
```

## CI

Add CI when the repo has no reliable merge gate. Prefer existing CI provider and style.

GitHub Actions minimal pattern:

- checkout
- set up runtime(s)
- install dependencies with lockfile-respecting commands
- run unified check command

For PRs, prefer changed-file checks locally but full deterministic checks in CI.

## Failure Output

Hooks should return short feedback:

```text
Quality gate failed: npm run typecheck
src/foo.ts:42: Type 'string' is not assignable to type 'number'.
Fix the type mismatch, then rerun npm run quality:check.
```

Do not return megabytes of logs to the agent.
