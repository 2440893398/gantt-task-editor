import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('scenario coverage title extraction', () => {
    it('does not count scenario IDs that appear only in comments or fixtures', () => {
        const root = path.resolve('.');
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-coverage-'));
        const scenariosDir = path.join(fixtureRoot, 'tests', 'scenarios');
        const inventory = path.join(scenariosDir, 'coverage.md');
        const spec = path.join(fixtureRoot, 'tests', 'coverage.spec.js');
        fs.mkdirSync(scenariosDir, { recursive: true });

        fs.writeFileSync(
            inventory,
            '| ID | P | 场景 | 验证点 | 状态 |\n|---|---|---|---|---|\n| SCN-TMP-999 | P1 | 临时测试 | 必须在标题中引用 | active |\n'
        );
        fs.writeFileSync(
            spec,
            "// test('[SCN-TMP-999] comment is not coverage', () => {});\nconst fixture = \"test('[SCN-TMP-999] string is not coverage', () => {});\";\ntest.skip('[SCN-TMP-999] skipped is not coverage', () => {});\n"
        );

        try {
            expect(() =>
                execFileSync(process.execPath, ['scripts/check-scenario-coverage.mjs'], {
                    cwd: root,
                    env: { ...process.env, SCENARIO_COVERAGE_ROOT: fixtureRoot },
                    stdio: 'pipe',
                })
            ).toThrow();
        } finally {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    it('counts runnable test.each and test.fail titles', () => {
        const root = path.resolve('.');
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-coverage-'));
        const scenariosDir = path.join(fixtureRoot, 'tests', 'scenarios');
        fs.mkdirSync(scenariosDir, { recursive: true });
        fs.writeFileSync(
            path.join(scenariosDir, 'coverage.md'),
            '| ID | P | Scenario | Verification | Status |\n|---|---|---|---|---|\n| SCN-TMP-997 | P1 | fail | runnable | active |\n| SCN-TMP-998 | P1 | each | runnable | active |\n'
        );
        fs.writeFileSync(
            path.join(fixtureRoot, 'tests', 'coverage.spec.js'),
            "test.fail('[SCN-TMP-997] expected failure', () => {});\ntest.each([[1]])('[SCN-TMP-998] parameterized %s', () => {});\n"
        );

        try {
            expect(() =>
                execFileSync(process.execPath, ['scripts/check-scenario-coverage.mjs'], {
                    cwd: root,
                    env: { ...process.env, SCENARIO_COVERAGE_ROOT: fixtureRoot },
                    stdio: 'pipe',
                })
            ).not.toThrow();
        } finally {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });

    it('does not count Playwright test.step titles as scenario coverage', () => {
        const root = path.resolve('.');
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario-coverage-'));
        const scenariosDir = path.join(fixtureRoot, 'tests', 'scenarios');
        fs.mkdirSync(scenariosDir, { recursive: true });
        fs.writeFileSync(
            path.join(scenariosDir, 'coverage.md'),
            '| ID | P | Scenario | Verification | Status |\n|---|---|---|---|---|\n| SCN-TMP-996 | P1 | step | test.step is not a test declaration | active |\n'
        );
        fs.writeFileSync(
            path.join(fixtureRoot, 'tests', 'coverage.spec.js'),
            "test('outer test without an ID', async () => { await test.step('[SCN-TMP-996] merely a step', async () => {}); });\n"
        );

        try {
            expect(() =>
                execFileSync(process.execPath, ['scripts/check-scenario-coverage.mjs'], {
                    cwd: root,
                    env: { ...process.env, SCENARIO_COVERAGE_ROOT: fixtureRoot },
                    stdio: 'pipe',
                })
            ).toThrow();
        } finally {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
    });
});
