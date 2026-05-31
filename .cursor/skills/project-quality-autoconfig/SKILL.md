---
name: project-quality-autoconfig
description: Use when users ask to set up, configure, or audit lint, formatter, typecheck, test, security, or architecture quality gates; create AI coding hooks (Claude Code, Codex, Cursor, GitHub Copilot); add pre-commit hooks, CI checks; or automate project quality validation and best-practice enforcement.
---

# Project Quality Autoconfig

## Quick Reference

| Need | Action |
| --- | --- |
| Inventory a repo | Run `scripts/analyze_quality_gates.py --repo <repo-root> --format markdown` |
| Pick missing tools | Read `references/tool-selection.md` |
| Add AI/Git hooks | Read `references/hook-recipes.md` |
| Change analyzer behavior | Add or update `scripts/test_analyze_quality_gates.py` first |
| Validate the skill | Run analyzer tests, then `quick_validate.py` |

## When NOT to Use

- When the user only wants to run a single linter, formatter, or test command without configuring a quality pipeline.
- When the repo is a temporary experiment or one-off script and the user does not want durable project configuration.
- When the user explicitly requests a specific tool and workflow they have already defined.

## Workflow

1. Locate the repository root and inspect the working tree before editing. Preserve unrelated user changes.
2. Run the bundled analyzer:

```bash
python path/to/this/skill/scripts/analyze_quality_gates.py --repo <repo-root> --format markdown
```

Use `--format json` for structured output and `--limit 0` only when full traversal is acceptable.

3. Read only the needed reference:
   - `references/tool-selection.md` for missing lint, typecheck, architecture, security, and test tools.
   - `references/hook-recipes.md` for Claude Code, Codex, Cursor, GitHub Copilot, Git hook, and CI patterns.
4. Prefer existing project tools and scripts. If the repo already has `lint`, `typecheck`, `test`, `check`, `verify`, or architecture scripts, compose them instead of replacing them.
5. If a gate is missing, add the smallest conventional setup for the detected stack. Never install every possible tool.
6. Add one repo command such as `check`, `verify`, or `quality:check` that runs: format check, lint, typecheck/build, architecture/dependency check, then targeted tests.
7. Add AI hooks only for tools the user uses or that are detected in the repo. If ambiguous, support Git hooks first and ask before adding tool-specific AI hooks.
8. Run the new check command and fix configuration mistakes. If dependencies cannot be installed or commands cannot run, report the exact blocker and leave the repo coherent.

## Configuration Rules

- Existing config wins over generic best practices.
- Put fast checks in local or AI hooks: formatting, changed-file lint, typecheck, dependency boundary checks, and targeted tests.
- Put full checks in CI: full test suite, build, SAST/security scan, architecture checks, and generated-artifact checks.
- Introduce architecture rules as warning or baseline first for established projects. Make them blocking only after current violations are accepted or fixed.
- Prefer deterministic tools for hard gates. Use LLM/semantic linters only as advisory PR comments or non-blocking hooks unless the user explicitly asks for blocking behavior.
- Keep hook output short and actionable: command, failing file, line, rule, and suggested fix.
- Do not create tool-specific hooks that bypass CI or replace Git hooks. AI hooks provide fast feedback; CI remains the merge gate.

## TDD and Verification

- Before changing analyzer detection behavior, add or update a failing case in `scripts/test_analyze_quality_gates.py`.
- Cover at least these fixtures when changing core logic: empty repo, JS/TS monorepo, Python package, Go service, mixed-language repo, existing custom `check` command, and hook-permission failure.
- After implementation, run:

```bash
python scripts/test_analyze_quality_gates.py
python path/to/skill-creator/scripts/quick_validate.py path/to/project-quality-autoconfig
```

## Expected Deliverables

When applying the skill to a repo, usually produce:

- A short inventory of detected languages, package managers, existing check scripts, and AI coding tools.
- Minimal config edits or new files for missing quality gates.
- A unified check command that can run locally and in CI.
- Hook config for the detected AI tool(s) and/or `pre-commit`, Husky, Lefthook, or a plain Git hook.
- Verification output from running the configured checks, or a clear blocker.

## Edge Cases

- Empty repo: report the absence of stack signals and avoid adding durable tooling until the stack is known.
- Mixed-language repo: prefer existing per-language commands; use Trunk/MegaLinter only when a shared runner is useful.
- Existing custom check command: wrap or reuse it; do not replace it.
- No permission to install Git hooks: create project scripts/config and report the manual enable step.

## Resource Use

Use `scripts/analyze_quality_gates.py` before deciding what to add. Load `references/tool-selection.md` only when picking tools, and `references/hook-recipes.md` only when writing hook configuration.
