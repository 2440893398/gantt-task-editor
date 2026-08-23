/**
 * [SCN-FWB-032] 执行器写入管线——run-plan 五个写入步骤的编排 + manifest 构造。
 *
 * 两条不可失手的兼容性契约：
 * 1. manifest 的哈希算法必须与 Worker 的 `verifyRunCompletionManifest` 自洽——
 *    这里用 Worker 的原样算法（去掉 sha 字段后 JSON.stringify 再 sha256）复核；
 * 2. candidateRef / 键形状与 `scripts/feedback-diff-gate.mjs`（GitHub 路径）一致，
 *    服务端 `registerFeedbackCandidate` 才能以同一份代码接住两条路径。
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDiffManifest, createWritePipeline } from '../executor/write-pipeline.js';

/** Worker `verifyRunCompletionManifest` 的哈希核验原样重演。 */
function workerAcceptsHash(manifest) {
    const unsigned = { ...manifest };
    delete unsigned.diffManifestSha256;
    const actual = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    return actual === manifest.diffManifestSha256;
}

describe('[SCN-FWB-032] buildDiffManifest', () => {
    const gate = {
        violations: [],
        requiresCandidateReview: [],
        qualityTier: 'standard',
        visualEvidenceRequired: false,
        autoDeliverAllowed: false,
    };

    it('哈希用 Worker 的原样算法可核验通过', () => {
        const manifest = buildDiffManifest({
            repository: '2440893398/gantt-task-editor',
            baseRef: 'master',
            candidateRef: 'feedback/candidate/run_1',
            baseCommit: 'a'.repeat(40),
            changeCommit: 'b'.repeat(40),
            changedFiles: ['src/a.js'],
            contractRunApproved: false,
            scnId: '',
            gate,
        });
        expect(workerAcceptsHash(manifest)).toBe(true);
        // 任何字段被篡改后哈希必须失配——这就是签名存在的意义。
        expect(workerAcceptsHash({ ...manifest, changedFiles: ['src/EVIL.js'] })).toBe(false);
    });

    it('键形状与 GitHub 路径的 diff-gate CLI 一致，sha 排尾', () => {
        const manifest = buildDiffManifest({
            repository: 'r',
            baseRef: 'master',
            candidateRef: 'feedback/candidate/run_1',
            baseCommit: 'a'.repeat(40),
            changeCommit: 'b'.repeat(40),
            changedFiles: [],
            contractRunApproved: false,
            scnId: '',
            gate,
        });
        expect(Object.keys(manifest)).toEqual([
            'specVersion',
            'repository',
            'baseRef',
            'candidateRef',
            'baseCommit',
            'changeCommit',
            'changedFiles',
            'contractRunApproved',
            'scnId',
            'violations',
            'requiresCandidateReview',
            'qualityTier',
            'visualEvidenceRequired',
            'autoDeliverAllowed',
            'diffManifestSha256',
        ]);
        expect(manifest.specVersion).toBe('1.0');
    });
});

const BASE = 'a'.repeat(40);
const CHANGE = 'b'.repeat(40);

function fakeGit(overrides = {}) {
    const outputs = {
        'rev-parse HEAD': `${CHANGE}\n`,
        'diff --cached --name-only': 'src/ok.js\n',
        'diff --cached --unified=0': '+++ b/src/ok.js\n+fixed\n',
        'diff --name-only': 'src/ok.js\n',
        'diff --unified=0': '+++ b/src/ok.js\n+fixed\n',
        ...overrides,
    };
    const calls = [];
    const git = async (...args) => {
        calls.push(args.join(' '));
        const joined = args.join(' ');
        const key = Object.keys(outputs).find((prefix) => joined.startsWith(prefix));
        return { code: 0, stdout: key ? outputs[key] : '', stderr: '' };
    };
    git.calls = calls;
    return git;
}

function makePipeline({ gitOutputs = {}, verification = null, runCommandResults = {} } = {}) {
    const verificationCalls = [];
    const commandCalls = [];
    const pipeline = createWritePipeline({
        workspaceDir: 'C:/ws',
        childEnv: { PATH: 'p' },
        log: () => {},
        gitFactory: () => fakeGit(gitOutputs),
        runVerification: async (options) => {
            verificationCalls.push(options);
            return (
                verification ?? {
                    passed: true,
                    report: {
                        targetedTests: { command: 'npm test', required: true, passed: true },
                        build: { command: 'npm run build', required: true, passed: true },
                        playwright: { command: 'npm run test:e2e', required: false, passed: true },
                    },
                }
            );
        },
        runCommandImpl: async ({ command }) => {
            commandCalls.push(command);
            return (
                runCommandResults[command] ?? { ok: true, exitCode: 0, timedOut: false, output: '' }
            );
        },
        fsImpl: {
            existsSync: (p) => String(p).includes('node_modules'),
            readdirSync: () => [],
        },
    });
    return { pipeline, verificationCalls, commandCalls };
}

const CONTEXT = {
    policy: 'implement',
    repository: '2440893398/gantt-task-editor',
    defaultBranch: 'master',
    commands: { test: 'npm test', build: 'npm run build', e2e: 'npm run test:e2e' },
};

describe('[SCN-FWB-032] 写入管线 finalize', () => {
    const prep = { baseCommit: BASE, candidateRef: 'feedback/candidate/run_w1' };

    it('成功路径：预检→提交→验证→权威门禁→manifest 完整且 Worker 可核验', async () => {
        const { pipeline, verificationCalls } = makePipeline();
        const phases = [];
        const outcome = await pipeline.finalize({
            runId: 'run_w1',
            context: CONTEXT,
            prep,
            emitPhase: async (phase) => phases.push(phase),
        });
        expect(outcome.outcome).toBe('completed');
        const manifest = outcome.completionPayload.diffManifest;
        expect(manifest.repository).toBe('2440893398/gantt-task-editor');
        expect(manifest.baseRef).toBe('master');
        expect(manifest.candidateRef).toBe('feedback/candidate/run_w1');
        expect(manifest.baseCommit).toBe(BASE);
        expect(manifest.changeCommit).toBe(CHANGE);
        expect(manifest.changedFiles).toEqual(['src/ok.js']);
        expect(workerAcceptsHash(manifest)).toBe(true);
        expect(outcome.completionPayload.verification.visualEvidence).toEqual({
            required: false,
            present: false,
        });
        expect(verificationCalls).toHaveLength(1);
        expect(verificationCalls[0].commands).toEqual(CONTEXT.commands);
    });

    it('验证环境强制 CI=1——playwright 的 reuseExistingServer 会复用开发机上在跑的 vite 去验证错误的代码', async () => {
        // 本仓 e2e 配置是 `reuseExistingServer: !process.env.CI`，主仓 dev server 常年
        // 占着 5273（e2e-hmr-stale-server 前科）。CI=1 让它拒绝复用、自起服务器：
        // 端口被占就诚实失败，绝不产出「验证的是别人代码」的假绿。
        const { pipeline, verificationCalls } = makePipeline();
        await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(verificationCalls[0].env.CI).toBe('1');
        expect(verificationCalls[0].env.PATH).toBe('p');
    });

    it('零变更如实失败——写入型 Run 没改任何东西不是一种成功', async () => {
        const { pipeline, verificationCalls } = makePipeline({
            gitOutputs: {
                'diff --cached --name-only': '',
                'diff --cached --unified=0': '',
            },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.outcome).toBe('failed');
        expect(outcome.errorCode).toBe('no_changes_produced');
        expect(verificationCalls).toHaveLength(0);
    });

    it('预检违规：跳过验证（C2），终态带违规规则名与变更清单，不产生提交记录', async () => {
        const { pipeline, verificationCalls } = makePipeline({
            gitOutputs: {
                'diff --cached --name-only': 'tests/e2e/agent-journeys/expected/x.json\n',
                'diff --cached --unified=0':
                    '+++ b/tests/e2e/agent-journeys/expected/x.json\n+{}\n',
            },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.outcome).toBe('failed');
        expect(outcome.errorCode).toBe('security_policy_violation');
        expect(verificationCalls).toHaveLength(0);
        expect(outcome.failurePayload.violations.map((v) => v.code)).toContain('HARD_DENY_PATH');
        expect(outcome.failurePayload.diffManifest.changedFiles).toEqual([
            'tests/e2e/agent-journeys/expected/x.json',
        ]);
        // 被门禁拦下的候选没有提交——它的 commit 不得被记录（Worker 侧同款规则）。
        expect(outcome.failurePayload.diffManifest.changeCommit).toBe('');
    });

    it('验证失败：verification_failed 终态带报告与 manifest', async () => {
        const { pipeline } = makePipeline({
            verification: {
                passed: false,
                failedStep: 'targetedTests',
                failureOutput: '2 failed',
                report: {
                    targetedTests: { command: 'npm test', required: true, passed: false },
                    build: { command: 'npm run build', required: true, passed: false },
                    playwright: { command: 'npm run test:e2e', required: false, passed: false },
                },
            },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.outcome).toBe('failed');
        expect(outcome.errorCode).toBe('verification_failed');
        expect(outcome.failurePayload.verification.targetedTests.passed).toBe(false);
        expect(outcome.failurePayload.diffManifest.changeCommit).toBe(CHANGE);
    });

    it('权威门禁跑在提交后的 base..HEAD 上——暂存区预检干净不算数', async () => {
        // 暂存区看是干净路径，提交后的 diff 却混进硬拒路径（Agent 竞态/藏匿的画像）。
        const { pipeline } = makePipeline({
            gitOutputs: {
                'diff --cached --name-only': 'src/ok.js\n',
                'diff --cached --unified=0': '+++ b/src/ok.js\n+fixed\n',
                'diff --name-only': 'tests/e2e/agent-journeys/expected/x.json\n',
                'diff --unified=0': '+++ b/tests/e2e/agent-journeys/expected/x.json\n+{}\n',
            },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.outcome).toBe('failed');
        expect(outcome.errorCode).toBe('security_policy_violation');
    });
});

describe('[SCN-FWB-032] visualEvidence.present 只认本轮产出（C3）', () => {
    const prep = { baseCommit: BASE, candidateRef: 'feedback/candidate/run_w1' };

    it('evidence 目录里躺着仓库提交过的旧 png 不算 present——否则 UI 类变更被假放行', async () => {
        // 2026-08-22 真机第 2 轮实测：tests/e2e/evidence/ 里有仓库自带的历史截图，
        // existsSync+readdir 判定 present=true，而本轮一张图都没产出。
        const { pipeline } = makePipeline();
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        // 默认 fake git 对 status --porcelain 返回空 → 本轮无新产出 → present=false
        expect(outcome.completionPayload.verification.visualEvidence.present).toBe(false);
    });

    it('e2e 产出的未跟踪 png 才算 present', async () => {
        const { pipeline } = makePipeline({
            gitOutputs: {
                'status --porcelain':
                    '?? tests/e2e/evidence/fix-proof.png\n?? tests/e2e/evidence/notes.txt\n',
            },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.completionPayload.verification.visualEvidence.present).toBe(true);
    });
});
