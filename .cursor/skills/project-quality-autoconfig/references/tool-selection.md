# Tool Selection

Use this matrix to fill gaps after scanning the repo. Prefer existing tools and package managers.

## General Priority

1. Existing scripts and configs.
2. Ecosystem-standard deterministic tools.
3. Meta-linters when the repo is polyglot or lacks a clear quality setup.
4. LLM/semantic linters as advisory checks.

## JavaScript and TypeScript

- Package manager: infer from `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`, or `bun.lock`.
- Workspace signals: detect `nx.json`, `turbo.json`, `pnpm-workspace.yaml`, `lerna.json`, and `rush.json` before choosing commands.
- Lint/format: prefer existing ESLint/Prettier/Biome/Oxlint. For new projects, prefer Biome for simple JS/TS formatting/linting; prefer ESLint when framework-specific rules matter.
- Typecheck: use `tsc --noEmit` when `tsconfig.json` exists.
- Architecture: use dependency-cruiser for dependency graph rules; use Nx `enforce-module-boundaries` in Nx monorepos; use eslint-plugin-boundaries only when ESLint is already central.
- Tests: reuse package scripts. Do not invent a test framework.

## Python

- Package manager: infer from `pyproject.toml`, `uv.lock`, `poetry.lock`, `requirements*.txt`, or `Pipfile`.
- Lint/format: prefer Ruff for new setup because it covers many Flake8/Pylint/isort-style checks and formats quickly; keep Black/isort if already configured.
- Typecheck: prefer Pyright for editor-aligned type checking or MyPy if already present.
- Architecture: use Import Linter for import contracts and layered architecture.
- Security: use pip-audit for dependency vulnerability scanning; use Semgrep for source-code security/correctness patterns.
- Tests: reuse Pytest/unittest commands already present.

## Go

- Lint/format/type: use `gofmt`, `go vet`, `staticcheck`, and `go test ./...`. Add golangci-lint when the project already has CI or needs a single lint gate.
- Architecture: prefer package-level dependency rules via custom scripts only when module boundaries are explicit.

## Rust

- Lint/format/type/test: use `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`.
- Architecture: prefer crate/workspace boundaries and deny rules before custom scripts.

## Java and Kotlin

- Build tool: infer Maven or Gradle.
- Lint/static analysis: keep Checkstyle, SpotBugs, PMD, Error Prone, or Detekt if already configured.
- Kotlin: prefer Detekt for Kotlin-specific static analysis when no existing Kotlin linter is present.
- Architecture: use ArchUnit tests for Java/Kotlin architecture rules.
- Tests: use `mvn test`, `mvn verify`, `gradle test`, or `gradle check` according to the project.

## .NET

- Lint/format/type/test: use `dotnet format --verify-no-changes`, `dotnet build`, and `dotnet test`.
- Architecture: use NetArchTest or ArchUnitNET only when layers are explicit.

## Polyglot or Unknown

- Use Trunk Check when the repo needs a local, shared, multi-linter runner with managed tool versions.
- Use MegaLinter or Super-Linter for CI-only broad scanning, especially in polyglot repos.
- Use Semgrep `--config=auto` for security and correctness scanning.
- Use CodeQL default setup in GitHub-hosted repos when security scanning is in scope.
- Use alint or similar repo-shape linting for required files, workspace hygiene, workflow permissions, and agent instruction consistency.

## Monorepos

- Detect workspace tooling before recommending checks: Nx, Turborepo, pnpm workspace, Lerna, Rush, Bazel, or Pants.
- Prefer changed-project or affected-project commands when available.
- Keep root-level architecture rules focused on package boundaries and dependency direction.
- Avoid adding duplicate per-package config when the monorepo already centralizes lint/type/test commands.

## Architecture Rule Rollout

- For greenfield repos: make architecture checks blocking immediately.
- For existing repos: create a baseline or warning-only check first; block only new violations.
- Keep architecture rules concrete: dependency direction, forbidden imports, cycle detection, package boundaries, required package docs, and workflow permissions.
- Avoid broad natural-language architecture rules as hard gates.
