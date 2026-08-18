/**
 * [SCN-FWB-032] C5 的**权威**检查：打真正的生产门禁 CLI，不打 Adapter 的封装。
 *
 * 为什么单独一条：符合性套件里的 C5 测的是 Adapter 接口——而 Adapter 的 hook 是新写的，
 * 天生就调 `scnIdFromDiff`，测它等于测自己刚写的代码。真正跑在 Agent job 里的是
 * `scripts/feedback-diff-gate.mjs`，而它原本写的是
 * `args.scn || process.env.FEEDBACK_SCN_ID || scnIdFromDiff(diffText)`——
 * 调用方声明优先于 diff，与 C5 相反。
 *
 * 这条测试在临时 git 仓里跑真 CLI，并注入敌意的 FEEDBACK_SCN_ID。
 * 它在修复前必然见红，是这次修复的回归保护。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE_CLI = fileURLToPath(new URL('../../../scripts/feedback-diff-gate.mjs', import.meta.url));
const HOSTILE_SCN = 'SCN-FWB-999';
const REAL_SCN = 'SCN-FWB-032';

let repoDir = '';
let baseSha = '';

function git(args, cwd) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'c5-gate-'));
    git(['init', '--quiet', '--initial-branch', 'main'], repoDir);
    git(['config', 'user.email', 'conformance@example.invalid'], repoDir);
    git(['config', 'user.name', 'Conformance'], repoDir);
    git(['config', 'commit.gpgsign', 'false'], repoDir);

    mkdirSync(join(repoDir, 'tests', 'scenarios'), { recursive: true });
    writeFileSync(join(repoDir, 'tests', 'scenarios', 'demo.md'), '# 场景清单\n');
    git(['add', '.'], repoDir);
    git(['commit', '--quiet', '-m', 'base'], repoDir);
    baseSha = git(['rev-parse', 'HEAD'], repoDir);

    // 契约文件的改动真的带上了 SCN-ID —— 这才是 C5 认可的唯一凭据
    writeFileSync(
        join(repoDir, 'tests', 'scenarios', 'demo.md'),
        `# 场景清单\n| ${REAL_SCN} | P0 | 更换执行引擎不得丢掉已有的血泪规则 |\n`
    );
    git(['add', '.'], repoDir);
});

afterAll(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
});

function runGate(env) {
    const out = join(repoDir, 'manifest.json');
    try {
        execFileSync(
            process.execPath,
            [
                GATE_CLI,
                '--base',
                baseSha,
                '--staged',
                'true',
                '--contract-run',
                'true',
                '--out',
                out,
            ],
            { cwd: repoDir, encoding: 'utf8', env: { ...process.env, ...env } }
        );
    } catch {
        // 门禁判定违规时以非零码退出，但 manifest 仍然写出——我们要断言的就是它。
    }
    return JSON.parse(readFileSync(out, 'utf8'));
}

describe('[SCN-FWB-032] C5 生产门禁：SCN-ID 只认 diff', () => {
    it('敌意的 FEEDBACK_SCN_ID 不能顶替 diff 里的真实 SCN-ID', () => {
        const manifest = runGate({ FEEDBACK_SCN_ID: HOSTILE_SCN });
        expect(manifest.scnId).toBe(REAL_SCN);
        expect(manifest.scnId).not.toBe(HOSTILE_SCN);
    });

    it('没有敌意注入时结果相同——环境变量根本不参与判定', () => {
        const manifest = runGate({});
        expect(manifest.scnId).toBe(REAL_SCN);
    });

    it('授权仍由控制面的 --contract-run 决定，并原样写进 manifest 供二次门禁复核', () => {
        const manifest = runGate({ FEEDBACK_SCN_ID: HOSTILE_SCN });
        expect(manifest.contractRunApproved).toBe(true);
        expect(manifest.changedFiles).toContain('tests/scenarios/demo.md');
    });
});
