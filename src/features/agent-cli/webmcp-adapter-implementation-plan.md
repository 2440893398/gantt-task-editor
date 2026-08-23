# Agent CLI WebMCP Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing agent-cli command layer as WebMCP tools (`document.modelContext.registerTool`) so browser-native agents that cannot inject JS (Chrome built-in agent, Cloudflare Browser Run, WebMCP-aware extensions) can operate the app. `window.app` stays the primary channel; WebMCP is a second, additive outlet generated from the same command registry.

**Scenario contract:** SCN-AGT-028 ~ SCN-AGT-033 in [tests/scenarios/agent-cli.md](../../../tests/scenarios/agent-cli.md) (decisions recorded in its 2026-08-20 changelog entry). Research basis: Cloudflare WebMCP preview (blog.cloudflare.com/webmcp, InfoQ 2026-08).

**Architecture:** One new adapter module walks the manifest command set (registry commands + `batch`/`operation.*` synthetic descriptors), maps each to an MCP tool, and bridges `execute(args)` to the already-built public `app` surface. Everything security-critical (caller-option allowlist, readOnly enforcement, rev guards, settle, undo, logging) is reused by construction because the adapter never talks to `dispatch()` directly — it calls the same public functions an injected agent would.

**Tech Stack:** Vanilla ES modules, Vitest/jsdom (mocked `modelContext`), Playwright with `addInitScript` stub for e2e, no new dependencies.

## Global Constraints

- Do not modify `runtime/dispatch.js`, `runtime/guards.js`, or any command handler — the adapter is a pure consumer of the public surface.
- Do not weaken the `CALLER_EXEC_OPTIONS` allowlist: WebMCP tool args must pass through the same public wrappers (`app.<path>()`, `app.batch()`, `app.operation.*`), never a raw context spread.
- WebMCP standard is experimental (Chrome 145+ behind a flag; `document.modelContext` vs `navigator.modelContext` still in flux). Feature-detect both, exit silently when absent, and never let adapter failure break `initAgentCli`.
- Reuse existing switches: `?agentApi=off` disables the whole layer (adapter included, for free — it is wired inside `initAgentCli` after the `enabled` early-return); `?agentReadOnly=1` filters registration (see Task 2). No new URL params.
- Progressive disclosure is preserved through read tools (`form_describe`, `schedule_describe`, `help`): do NOT inline dynamic form schemas into tool registration, and do NOT build a re-registration mechanism (schema changes are served live by the read tools; the registered tool set itself is static per page load).
- Follow scenario-loop discipline: each task starts with a failing targeted test; flip SCN rows `todo → active` only when the covering test lands; `npm run check:scenarios` green before every commit.
- Named ES module exports, `.js` import suffixes, four-space indentation, single quotes.

---

## File Map

**Create**

- `src/features/agent-cli/adapters/webmcp.js` — feature detection, name mapping, tool building, execute bridge, result envelope.
- `tests/unit/agent-cli/webmcp-adapter.test.js` — unit coverage with a mocked `modelContext`.
- `tests/e2e/agent-cli-webmcp.spec.js` — Playwright spec, `addInitScript` stub capturing registrations and driving `execute` ([SCN-AGT-028/029/030/031/032/033]).

**Modify**

- `src/features/agent-cli/index.js` — wire `registerWebmcpTools({ app, readOnly })` at the end of `initAgentCli`.
- `src/features/agent-cli/discovery/index.js` (+ its test) — advertise `webmcp: true|false` in the discovery blob so JS-injecting agents know the second channel exists.
- `tests/scenarios/agent-cli.md` — flip SCN-AGT-028~033 statuses as coverage lands.

---

### Task 1: Adapter core — tool descriptors from the single source of truth

**Failing test first** (`tests/unit/agent-cli/webmcp-adapter.test.js`):

- [ ] `buildWebmcpTools(commands)` returns one descriptor per manifest command **including** `batch` and `operation.*` synthetic commands (reuse `buildHelp`/`withSyntheticCommands` from `runtime/manifest.js`; export the helper from manifest.js if needed rather than duplicating the synthetic list).
- [ ] Name mapping: `task.create` → `task_create`; mapping is reversible (`toWebmcpName`/`fromWebmcpName` round-trip on every command); result matches `^[a-zA-Z0-9_-]{1,64}$`.
- [ ] `inputSchema` equals `help(command).params` deep-equal, plus an optional top-level `options` object exposing ONLY `ifRev`/`schemaRev`/`policyRev`/`dryRun`/`sync` (mirrors `CALLER_EXEC_OPTIONS`; `x-batch-ref` stays — unknown JSON Schema keywords are legal in MCP `inputSchema`).
- [ ] `description` = command summary + discovery guidance rendered from `help(command).discovery` with target command names converted to WebMCP names (e.g. "Before filling dynamic task values, call `form_describe` … to read schemaRev") — this is SCN-AGT-033's contract.

**Implementation notes:** pure functions, no DOM access in this layer; keep descriptor building separate from registration so unit tests need no `modelContext` mock here.

- [ ] Commit: `feat(agent-cli): webmcp tool descriptor builder [SCN-AGT-028][SCN-AGT-033]`

### Task 2: Execute bridge, result envelope, readOnly filter

**Failing tests first:**

- [ ] `registerWebmcpTools({ app, readOnly, modelContext })` calls `modelContext.registerTool` once per tool; count equals manifest command count (SCN-AGT-028).
- [ ] `execute(args)` for a structured command resolves the dotted path on `app` (`app.task.create(args, args.options)`); for `batch` calls `app.batch(args.steps, args.options)`; for `operation.*` calls `app.operation.<method>(...)`. Assert a spy `app` receives exactly the caller args + options — nothing else (allowlist preserved).
- [ ] Result envelope (SCN-AGT-030): success → `{ content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }`; command-level failure (`ok:false`) → same shape with `isError: true`, `text` still containing `code` and `nextAction`; a thrown exception → `isError: true` with a synthesized `{ ok:false, code:'INTERNAL' }` body, never a rejected promise escaping to the browser.
- [ ] `readOnly: true` → no `mutating:true` command is registered (assert `task_create`/`batch`/`operation_start` absent, `state_snapshot`/`form_describe` present) (SCN-AGT-032).
- [ ] Feature detection: `resolveModelContext()` checks `document.modelContext` then `navigator.modelContext`; when both absent `registerWebmcpTools` is a silent no-op returning `{ registered: 0 }` (SCN-AGT-031); a throwing `registerTool` is caught and does not propagate.

- [ ] Commit: `feat(agent-cli): webmcp execute bridge + readOnly filter [SCN-AGT-029][SCN-AGT-030][SCN-AGT-031][SCN-AGT-032]`

### Task 3: Wiring + discovery advertisement

- [ ] Failing test: `initAgentCli()` with a stubbed `document.modelContext` registers tools; with `enabled:false` registers nothing (SCN-AGT-031); adapter throw does not prevent `window.app` from being returned.
- [ ] Wire `registerWebmcpTools({ app, readOnly: resolved.readOnly })` at the end of `initAgentCli` in `index.js`, wrapped so failure only `console.warn`s.
- [ ] Extend discovery blob (`discovery/index.js`) with `webmcp: { available: <bool>, naming: 'dots-to-underscores' }`; update `discovery-commands.test.js` golden expectations accordingly (unit-level only — the e2e discovery contract JSON, if touched, needs an `expected/CHANGES.md` entry per scenario-loop rule 1).
- [ ] Commit: `feat(agent-cli): wire webmcp outlet into initAgentCli + discovery [SCN-AGT-028][SCN-AGT-031]`

### Task 4: E2E coverage and scenario flip

- [ ] `tests/e2e/agent-cli-webmcp.spec.js`: `addInitScript` installs a capturing stub `document.modelContext = { registerTool(t){...} }` **before** app load; assertions per scenario:
  - [SCN-AGT-028] tool count == `window.app.manifest().commands.length`; names map reversibly; sampled `inputSchema` deep-equals `help(...).params` (+`options`).
  - [SCN-AGT-029] drive `task_create.execute(...)` → parse envelope → `window.app.task.get` shows the task; rev +1; same invalid payload via tool and via `window.app` yields the same error code.
  - [SCN-AGT-030] envelope shape checks for success and failure, `nextAction` preserved.
  - [SCN-AGT-031] `?agentApi=off` → zero registrations; no-stub run → app fully functional.
  - [SCN-AGT-032] `?agentReadOnly=1` → no mutating tools registered; `state_snapshot.execute` ok.
  - [SCN-AGT-033] `task_create` description contains `form_describe` guidance.
- [ ] Business-state assertions can reuse `window.app` reads directly (this spec is contract-style like `agent-cli.spec.js`, not a golden-answer journey; no `expected/*.json` needed — if a journey variant is added later it follows `UPDATE_GOLDEN=1` discipline).
- [ ] Flip SCN-AGT-028~033 `todo → active` in `tests/scenarios/agent-cli.md`; `npm run check:scenarios` green; changelog row noting the flip.
- [ ] Manual check (keeps standard-flux risk visible): note in SCN changelog that real-Chrome (145+, flag on) verification remains a manual walkthrough until WebMCP ships stable; do NOT add a blocking CI step on the experimental flag.
- [ ] Commit: `test(agent-cli): webmcp e2e contract coverage [SCN-AGT-028..033]`

---

## Explicitly Out of Scope (YAGNI, aligned with design spec §1.4)

- No server-side `/mcp` endpoint and no Cloudflare dashboard WebMCP toggle — our state and write path live in the browser (gantt + IndexedDB); Cloudflare's Site MCP Server pack cannot reach them and is not needed since we own the frontend and register tools directly.
- No tool re-registration on schema/project change (read tools serve live data).
- No `unregisterTool`/lifecycle management beyond page lifetime.
- No changes to the `window.app` contract, discovery DOM runner fallback, or golden answers.
