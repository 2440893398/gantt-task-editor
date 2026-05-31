#!/usr/bin/env python3
"""Read-only repository quality gate inventory.

This script intentionally does not edit the target repository. It detects common
languages, package managers, quality tools, existing scripts, AI-agent configs,
and likely missing gates so Codex can make small, repo-appropriate edits.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any


DEFAULT_FILE_LIMIT = 20000

SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".nuxt",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "target",
    "vendor",
}


EXT_LANGUAGE = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".cs": "dotnet",
    ".php": "php",
    ".rb": "ruby",
    ".swift": "swift",
}


PYTHON_MANIFESTS = [
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "requirements.txt",
    "requirements-dev.txt",
    "uv.lock",
    "poetry.lock",
    "Pipfile",
    "Pipfile.lock",
]


AI_FILES = {
    "CLAUDE.md": "Claude Code",
    ".claude/settings.json": "Claude Code",
    ".claude/settings.local.json": "Claude Code",
    ".claude/hooks": "Claude Code hooks",
    ".codex/hooks.json": "Codex hooks",
    ".codex/config.toml": "Codex config",
    "AGENTS.md": "Codex / generic agents",
    ".cursor/rules": "Cursor rules",
    ".cursorrules": "Cursor legacy rules",
    ".github/copilot-instructions.md": "GitHub Copilot",
    "GEMINI.md": "Gemini CLI",
    ".windsurfrules": "Windsurf",
}


CONFIG_PATTERNS = {
    "eslint": [".eslintrc", ".eslintrc.json", ".eslintrc.cjs", ".eslintrc.js", "eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"],
    "prettier": [".prettierrc", ".prettierrc.json", ".prettierrc.yml", ".prettierrc.yaml", ".prettierrc.cjs", "prettier.config.js"],
    "biome": ["biome.json", "biome.jsonc"],
    "oxlint": [".oxlintrc.json", "oxlint.json"],
    "nx": ["nx.json"],
    "turborepo": ["turbo.json", "turborepo.json"],
    "pnpm-workspace": ["pnpm-workspace.yaml"],
    "lerna": ["lerna.json"],
    "rush": ["rush.json"],
    "dependency-cruiser": [".dependency-cruiser.js", ".dependency-cruiser.cjs", ".dependency-cruiser.json", "dependency-cruiser.config.js"],
    "depcheck": [".depcheckrc"],
    "import-linter": [".importlinter"],
    "mypy": ["mypy.ini", ".mypy.ini"],
    "pyright": ["pyrightconfig.json"],
    "pytest": ["pytest.ini"],
    "ruff": ["ruff.toml", ".ruff.toml"],
    "golangci-lint": [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"],
    "staticcheck": ["staticcheck.conf"],
    "clippy": ["Cargo.toml"],
    "checkstyle": ["checkstyle.xml"],
    "spotbugs": ["spotbugs-exclude.xml"],
    "pmd": ["pmd.xml", "ruleset.xml"],
    "detekt": ["detekt.yml", "detekt.yaml", "detekt-config.yml"],
    "editorconfig": [".editorconfig"],
    "pre-commit": [".pre-commit-config.yaml", ".pre-commit-config.yml"],
    "lefthook": ["lefthook.yml", "lefthook.yaml"],
    "husky": [".husky/pre-commit", ".husky/pre-push"],
    "github-actions": [".github/workflows"],
    "trunk": [".trunk/trunk.yaml"],
    "megalinter": [".mega-linter.yml", ".mega-linter.yaml"],
    "semgrep": [".semgrep.yml", ".semgrep.yaml", "semgrep.yml", "semgrep.yaml"],
    "alint": [".alint.yml", ".alint.yaml"],
}


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def path_exists(root: Path, pattern: str) -> list[str]:
    if "*" in pattern:
        return [rel(p, root) for p in root.glob(pattern)]
    p = root / pattern
    return [pattern] if p.exists() else []


def walk_files(root: Path, limit: int = DEFAULT_FILE_LIMIT) -> tuple[list[Path], bool]:
    found: list[Path] = []
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            found.append(Path(current) / name)
            if limit > 0 and len(found) >= limit:
                return found, True
    return found, False


def read_package_json(root: Path) -> dict[str, Any]:
    path = root / "package.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"_parse_error": True}


def detect_package_manager(root: Path) -> list[str]:
    managers = []
    for filename, manager in [
        ("pnpm-lock.yaml", "pnpm"),
        ("pnpm-workspace.yaml", "pnpm"),
        ("yarn.lock", "yarn"),
        ("package-lock.json", "npm"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
        ("uv.lock", "uv"),
        ("poetry.lock", "poetry"),
        ("Pipfile.lock", "pipenv"),
        ("go.mod", "go"),
        ("Cargo.lock", "cargo"),
        ("pom.xml", "maven"),
        ("build.gradle", "gradle"),
        ("build.gradle.kts", "gradle"),
    ]:
        if (root / filename).exists():
            managers.append(manager)
    if (root / "package.json").exists() and not any(m in managers for m in ["pnpm", "yarn", "npm", "bun"]):
        managers.append("npm")
    return sorted(set(managers))


def detect_languages(root: Path, files: list[Path]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in files:
        language = EXT_LANGUAGE.get(path.suffix.lower())
        if language:
            counts[language] = counts.get(language, 0) + 1

    if any((root / manifest).exists() for manifest in PYTHON_MANIFESTS):
        counts.setdefault("python", 0)
    if (root / "tsconfig.json").exists():
        counts.setdefault("typescript", 0)
    if (root / "package.json").exists():
        counts.setdefault("javascript", 0)
    if (root / "go.mod").exists():
        counts.setdefault("go", 0)
    if (root / "Cargo.toml").exists():
        counts.setdefault("rust", 0)
    if (root / "pom.xml").exists() or (root / "build.gradle").exists() or (root / "build.gradle.kts").exists():
        counts.setdefault("java", 0)

    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def detect_configs(root: Path) -> dict[str, list[str]]:
    configs: dict[str, list[str]] = {}
    for tool, patterns in CONFIG_PATTERNS.items():
        matches: list[str] = []
        for pattern in patterns:
            matches.extend(path_exists(root, pattern))
        if matches:
            configs[tool] = sorted(set(matches))
    return configs


def detect_ai_tools(root: Path) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for pattern, tool in AI_FILES.items():
        matches = path_exists(root, pattern)
        if matches:
            found.setdefault(tool, []).extend(matches)
    return {tool: sorted(set(paths)) for tool, paths in found.items()}


def detect_scripts(package_json: dict[str, Any]) -> dict[str, str]:
    scripts = package_json.get("scripts")
    if isinstance(scripts, dict):
        return {str(k): str(v) for k, v in sorted(scripts.items())}
    return {}


def detect_tooling_from_package(package_json: dict[str, Any]) -> list[str]:
    deps: dict[str, Any] = {}
    for key in ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]:
        value = package_json.get(key)
        if isinstance(value, dict):
            deps.update(value)
    names = set(deps)
    detected = []
    candidates = {
        "eslint": ["eslint"],
        "prettier": ["prettier"],
        "biome": ["@biomejs/biome"],
        "oxlint": ["oxlint"],
        "typescript": ["typescript"],
        "dependency-cruiser": ["dependency-cruiser"],
        "madge": ["madge"],
        "eslint-plugin-boundaries": ["eslint-plugin-boundaries"],
        "nx": ["nx", "@nx/workspace", "@nx/devkit", "@nx/js"],
        "turbo": ["turbo", "turborepo"],
        "lerna": ["lerna"],
        "rush": ["@microsoft/rush"],
        "jest": ["jest"],
        "vitest": ["vitest"],
        "playwright": ["@playwright/test", "playwright"],
        "husky": ["husky"],
        "lint-staged": ["lint-staged"],
        "lefthook": ["lefthook"],
        "trunk": ["@trunkio/launcher"],
        "alint": ["@asamarts/alint"],
    }
    for tool, packages in candidates.items():
        if any(pkg in names for pkg in packages):
            detected.append(tool)
    return sorted(detected)


def script_named(scripts: dict[str, str], name: str) -> bool:
    keys = [key.lower() for key in scripts]
    return any(key == name or key.startswith(f"{name}:") or key.endswith(f":{name}") for key in keys)


def any_script_named(scripts: dict[str, str], names: set[str]) -> bool:
    return any(script_named(scripts, name) for name in names)


def script_text_contains(scripts: dict[str, str], needles: set[str]) -> bool:
    script_text = "\n".join(f"{k}: {v}" for k, v in scripts.items()).lower()
    return any(needle in script_text for needle in needles)


def classify_gates(languages: dict[str, int], configs: dict[str, list[str]], scripts: dict[str, str], package_tools: list[str]) -> dict[str, Any]:
    tools = set(configs) | set(package_tools)
    gates = {
        "format": bool({"prettier", "biome", "ruff", "editorconfig"} & tools) or any_script_named(scripts, {"format", "fmt"}),
        "lint": bool({"eslint", "biome", "oxlint", "ruff", "golangci-lint", "staticcheck", "clippy", "checkstyle", "spotbugs", "pmd", "detekt"} & tools) or script_named(scripts, "lint") or script_text_contains(scripts, {"clippy", "staticcheck"}),
        "typecheck": bool({"typescript", "mypy", "pyright"} & tools) or any_script_named(scripts, {"typecheck", "type-check"}) or script_text_contains(scripts, {"tsc", "mypy", "pyright"}),
        "architecture": bool({"dependency-cruiser", "import-linter", "eslint-plugin-boundaries", "nx"} & tools) or any_script_named(scripts, {"arch", "architecture"}) or script_text_contains(scripts, {"depcruise", "lint-imports", "archunit"}),
        "tests": script_named(scripts, "test") or script_text_contains(scripts, {"pytest", "cargo test", "go test", "mvn test", "gradle test", "vitest", "jest"}),
        "security": bool({"semgrep"} & tools) or any_script_named(scripts, {"security", "audit"}) or script_text_contains(scripts, {"semgrep", "codeql", "pip-audit", "npm audit"}),
        "hooks": bool({"pre-commit", "husky", "lefthook"} & tools),
        "ci": "github-actions" in tools,
    }
    missing = [name for name, present in gates.items() if not present and name not in {"ci", "hooks"}]
    return {"present": gates, "missing": missing}


def recommendations(languages: dict[str, int], managers: list[str], gates: dict[str, Any], configs: dict[str, list[str]], package_tools: list[str]) -> list[str]:
    recs: list[str] = []
    langs = set(languages)
    missing = set(gates["missing"])
    monorepo_tools = {"nx", "turborepo", "pnpm-workspace", "lerna", "rush"} & (set(configs) | set(package_tools))

    if {"javascript", "typescript"} & langs:
        pm = next((m for m in managers if m in ["pnpm", "yarn", "npm", "bun"]), "npm")
        runner = {"pnpm": "pnpm", "yarn": "yarn", "npm": "npm run", "bun": "bun run"}[pm]
        if "lint" in missing:
            recs.append("JS/TS: add or reuse ESLint/Biome linting; prefer existing framework config before introducing a new linter.")
        if "typecheck" in missing and "typescript" in langs:
            recs.append(f"TypeScript: add a typecheck script such as `{runner} typecheck` -> `tsc --noEmit`.")
        if "architecture" in missing:
            recs.append("JS/TS architecture: consider dependency-cruiser for dependency rules or Nx module boundaries in Nx monorepos.")

    if "python" in langs:
        if "lint" in missing:
            recs.append("Python: prefer Ruff for new lint/format setup unless Black/isort/Flake8/Pylint already exist.")
        if "typecheck" in missing:
            recs.append("Python: add Pyright or MyPy only if the project uses type hints or has typing goals.")
        if "architecture" in missing:
            recs.append("Python architecture: use Import Linter contracts for forbidden imports, layers, independence, or acyclic siblings.")
        if "security" in missing:
            recs.append("Python security: consider pip-audit for dependency vulnerabilities and Semgrep for source-code patterns.")

    if "go" in langs:
        recs.append("Go: use `gofmt`, `go vet`, `staticcheck`, and `go test ./...`; add golangci-lint when a single lint gate is needed.")

    if "rust" in langs:
        recs.append("Rust: use `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo test`.")

    if {"java", "kotlin"} & langs:
        if "architecture" in missing:
            recs.append("Java/Kotlin architecture: add ArchUnit tests when package/layer rules are explicit.")
        recs.append("Java/Kotlin: prefer existing Maven/Gradle `check` or `verify` lifecycle; keep Detekt when Kotlin uses it.")

    if "dotnet" in langs:
        recs.append(".NET: use `dotnet format --verify-no-changes`, `dotnet build`, and `dotnet test`; use NetArchTest or ArchUnitNET for explicit architecture rules.")

    if monorepo_tools:
        recs.append(f"Monorepo: detected {', '.join(sorted(monorepo_tools))}; prefer workspace-aware checks and changed-project filters.")

    if len(langs) > 2 and not any(tool in configs for tool in ["trunk", "megalinter"]):
        recs.append("Polyglot: consider Trunk Check for local managed linters or MegaLinter/Super-Linter for CI scanning.")

    if "security" in missing:
        recs.append("Security: consider Semgrep `--config=auto` or GitHub CodeQL default setup for supported GitHub repositories.")

    if not gates["present"].get("hooks"):
        recs.append("Hooks: add pre-commit/Husky/Lefthook for fast local checks; keep full tests in CI.")

    return recs


def analyze(root: Path, limit: int = DEFAULT_FILE_LIMIT) -> dict[str, Any]:
    root = root.resolve()
    files, truncated = walk_files(root, limit)
    package_json = read_package_json(root)
    configs = detect_configs(root)
    scripts = detect_scripts(package_json)
    package_tools = detect_tooling_from_package(package_json)
    languages = detect_languages(root, files)
    managers = detect_package_manager(root)
    ai_tools = detect_ai_tools(root)
    gates = classify_gates(languages, configs, scripts, package_tools)
    return {
        "repo": str(root),
        "scan": {
            "files_scanned": len(files),
            "file_limit": limit,
            "truncated": truncated,
        },
        "languages": languages,
        "package_managers": managers,
        "configs": configs,
        "package_tools": package_tools,
        "package_scripts": scripts,
        "ai_tools": ai_tools,
        "gates": gates,
        "recommendations": recommendations(languages, managers, gates, configs, package_tools),
    }


def to_markdown(data: dict[str, Any]) -> str:
    lines = ["# Quality Gate Inventory", "", f"Repo: `{data['repo']}`", ""]
    scan = data.get("scan")
    if scan:
        lines.append("## Scan")
        lines.append(f"- files scanned: {scan['files_scanned']}")
        lines.append(f"- file limit: {scan['file_limit']}")
        lines.append(f"- truncated: {'yes' if scan['truncated'] else 'no'}")
        lines.append("")

    lines.append("## Languages")
    if data["languages"]:
        for lang, count in data["languages"].items():
            lines.append(f"- {lang}: {count} files")
    else:
        lines.append("- none detected")

    lines.append("\n## Package Managers")
    if data["package_managers"]:
        lines.extend(f"- {m}" for m in data["package_managers"])
    else:
        lines.append("- none detected")

    lines.append("\n## Existing Configs")
    if data["configs"]:
        for tool, paths in data["configs"].items():
            lines.append(f"- {tool}: {', '.join(paths)}")
    else:
        lines.append("- none detected")

    if data["package_tools"]:
        lines.append("\n## Package Tools")
        lines.extend(f"- {tool}" for tool in data["package_tools"])

    if data["package_scripts"]:
        lines.append("\n## Package Scripts")
        for name, command in data["package_scripts"].items():
            lines.append(f"- `{name}`: `{command}`")

    lines.append("\n## AI Tools")
    if data["ai_tools"]:
        for tool, paths in data["ai_tools"].items():
            lines.append(f"- {tool}: {', '.join(paths)}")
    else:
        lines.append("- none detected")

    lines.append("\n## Gates")
    for gate, present in data["gates"]["present"].items():
        mark = "present" if present else "missing"
        lines.append(f"- {gate}: {mark}")

    lines.append("\n## Recommendations")
    if data["recommendations"]:
        lines.extend(f"- {rec}" for rec in data["recommendations"])
    else:
        lines.append("- No obvious gaps detected.")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".", help="Repository root to inspect")
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    parser.add_argument("--limit", type=int, default=DEFAULT_FILE_LIMIT, help="Maximum number of files to scan; use 0 for unlimited")
    args = parser.parse_args()

    data = analyze(Path(args.repo), limit=args.limit)
    if args.format == "json":
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(to_markdown(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
