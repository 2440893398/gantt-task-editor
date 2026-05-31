#!/usr/bin/env python3
"""Regression tests for analyze_quality_gates.py."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import analyze_quality_gates as aqg


class AnalyzeQualityGatesTest(unittest.TestCase):
    def make_repo(self) -> tempfile.TemporaryDirectory[str]:
        return tempfile.TemporaryDirectory()

    def write(self, root: Path, relative: str, content: str = "") -> None:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_python_manifest_detects_python_without_source_walk(self) -> None:
        with self.make_repo() as repo:
            root = Path(repo)
            self.write(root, "pyproject.toml", "[project]\nname = 'demo'\n")

            data = aqg.analyze(root, limit=10)

            self.assertIn("python", data["languages"])

    def test_monorepo_configs_are_detected(self) -> None:
        with self.make_repo() as repo:
            root = Path(repo)
            self.write(root, "package.json", json.dumps({"devDependencies": {"nx": "latest", "turbo": "latest"}}))
            self.write(root, "nx.json", "{}")
            self.write(root, "turbo.json", "{}")
            self.write(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n")
            self.write(root, "packages/app/src/index.ts", "export const ok = true;\n")

            data = aqg.analyze(root, limit=50)

            self.assertIn("nx", data["configs"])
            self.assertIn("turborepo", data["configs"])
            self.assertIn("pnpm-workspace", data["configs"])
            self.assertIn("nx", data["package_tools"])
            self.assertIn("turbo", data["package_tools"])

    def test_scan_limit_reports_truncation(self) -> None:
        with self.make_repo() as repo:
            root = Path(repo)
            for index in range(5):
                self.write(root, f"src/file_{index}.ts", "export {};\n")

            data = aqg.analyze(root, limit=2)

            self.assertTrue(data["scan"]["truncated"])
            self.assertEqual(data["scan"]["file_limit"], 2)

    def test_test_script_matching_avoids_false_positive_names(self) -> None:
        gates = aqg.classify_gates(
            languages={"javascript": 1},
            configs={},
            scripts={"contest": "echo no tests", "pretest": "echo setup"},
            package_tools=[],
        )

        self.assertFalse(gates["present"]["tests"])

        gates = aqg.classify_gates(
            languages={"javascript": 1},
            configs={},
            scripts={"test:coverage": "vitest run --coverage"},
            package_tools=[],
        )

        self.assertTrue(gates["present"]["tests"])

    def test_markdown_output_is_valid_for_empty_repo(self) -> None:
        with self.make_repo() as repo:
            data = aqg.analyze(Path(repo), limit=10)
            markdown = aqg.to_markdown(data)

            self.assertIn("## Package Managers", markdown)
            self.assertIn("- none detected", markdown)


if __name__ == "__main__":
    unittest.main()
