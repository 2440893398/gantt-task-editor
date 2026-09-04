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

function makePipeline({
    gitOutputs = {},
    verification = null,
    runCommandResults = {},
    fsImpl = {},
} = {}) {
    const verificationCalls = [];
    const commandCalls = [];
    const git = fakeGit(gitOutputs);
    const rmCalls = [];
    const pipeline = createWritePipeline({
        workspaceDir: 'C:/ws',
        childEnv: { PATH: 'p' },
        log: () => {},
        gitFactory: () => git,
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
            readFileSync: () => '',
            statSync: () => ({ size: 24 }),
            rmSync: (p) => rmCalls.push(String(p).replace(/\\/g, '/')),
            ...fsImpl,
        },
    });
    return { pipeline, verificationCalls, commandCalls, git, rmCalls };
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

    it('目录被 gitignore 时磁盘上的 PNG 仍算 present——git status 对 ignore 的文件永远静默', async () => {
        // 生产实锤（2026-08-27 变更日志，run_5104cfc1）：tests/e2e/evidence/ 整个在
        // .gitignore 里，旧实现拿 `git status --porcelain` 判定「本轮新增」，porcelain
        // 对被 ignore 的新文件一行不吐（--ignored 也只坍缩成目录一行）——判定结构性
        // 恒 false，测试/构建/e2e 全绿、截图真实在磁盘上的 Run 照样被判「未产出证据」。
        // 本用例的 fake git status 保持生产同款的静默；检测必须走文件系统。
        const { pipeline } = makePipeline({
            gitOutputs: { 'status --porcelain': '' },
            fsImpl: { readdirSync: () => ['baseline-controls-removed.png'] },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.completionPayload.verification.visualEvidence.present).toBe(true);
    });

    it('evidence 目录里躺着仓库提交过的旧 png 不算 present——否则 UI 类变更被假放行', async () => {
        // 2026-08-22 真机第 2 轮实测的教训不回退：prepare 的 -x 清场清不掉**已跟踪**
        // 文件，历史截图必须靠 ls-files 排除，否则又回到 existsSync 时代的假放行。
        const { pipeline } = makePipeline({
            gitOutputs: { 'ls-files -- tests/e2e/evidence': 'tests/e2e/evidence/old.png\n' },
            fsImpl: { readdirSync: () => ['old.png'] },
        });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.completionPayload.verification.visualEvidence.present).toBe(false);
    });

    it('目录不存在或没有任何 PNG → present=false', async () => {
        const missingDir = makePipeline({
            fsImpl: {
                readdirSync: () => {
                    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
                },
            },
        });
        const missing = await missingDir.pipeline.finalize({
            runId: 'run_w1',
            context: CONTEXT,
            prep,
        });
        expect(missing.completionPayload.verification.visualEvidence.present).toBe(false);

        const noPng = makePipeline({ fsImpl: { readdirSync: () => ['notes.txt'] } });
        const outcome = await noPng.pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(outcome.completionPayload.verification.visualEvidence.present).toBe(false);
    });
});

describe('[SCN-FWB-040] prepare 把候选恢复与证据清场接进 git 工作区', () => {
    it('context.previousAttempt.changeCommit 存在时建在其上，并总是 -x 清场证据目录', async () => {
        const resume = 'd'.repeat(40);
        // SCN-FWB-040（2026-09-04 收紧）：默认分支前移时恢复轮会先把整条链重放到新头。
        // 这条用例验的是「恢复建在上一轮之上 + 证据目录清场」，与重放无关，所以把
        // 分支头钉成链基线（= 没前移）。重放与冲突回落由 executor-candidate.test.js
        // 的真 git 用例覆盖。
        const { pipeline, git } = makePipeline({
            gitOutputs: {
                [`merge-base master ${resume}`]: `${BASE}\n`,
                'rev-parse master': `${BASE}\n`,
            },
        });
        const prepResult = await pipeline.prepare({
            runId: 'run_w1',
            context: { ...CONTEXT, previousAttempt: { changeCommit: resume } },
        });
        expect(git.calls).toContain('clean -fdx -- tests/e2e/evidence');
        expect(git.calls).toContain(`checkout -B feedback/candidate/run_w1 ${resume}`);
        expect(prepResult.baseCommit).toBe(BASE);
        expect(prepResult.resumedFrom).toBe(resume);
    });
});

describe('[SCN-FWB-041] 删除标记在暂存前兑现为真实删除', () => {
    const prep = { baseCommit: BASE, candidateRef: 'feedback/candidate/run_w1' };

    it('整文件单行标记（含注释包裹）被删除，且发生在 add -A 之前', async () => {
        // 坏行为下的形态：不删的话，「删掉某功能」类任务交付里永远带着壳文件，
        // Agent 只能在结果里请人工 git rm（run_5104cfc1 原话）——闭环最后一米断掉。
        const contents = {
            'src/features/gantt/baseline.js': '// FEEDBACK-DELETE-FILE\n',
            'src/other.js': 'export const keep = 1;\n',
            'doc/legacy.md': '<!-- FEEDBACK-DELETE-FILE -->',
        };
        const { pipeline, git, rmCalls } = makePipeline({
            gitOutputs: {
                'status --porcelain':
                    ' M src/features/gantt/baseline.js\n M src/other.js\n?? doc/legacy.md\n',
            },
            fsImpl: {
                readFileSync: (p) => {
                    const key = Object.keys(contents).find((file) =>
                        String(p).replace(/\\/g, '/').endsWith(file)
                    );
                    return key ? contents[key] : '';
                },
            },
        });
        await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(rmCalls).toEqual(['C:/ws/src/features/gantt/baseline.js', 'C:/ws/doc/legacy.md']);
        const statusIndex = git.calls.findIndex((call) => call.startsWith('status --porcelain'));
        const addIndex = git.calls.findIndex((call) => call === 'add -A');
        expect(statusIndex).toBeGreaterThanOrEqual(0);
        expect(addIndex).toBeGreaterThan(statusIndex);
    });

    it('正文里提到标记、或标记只是多行文件中的一行——都不触发删除', async () => {
        const contents = {
            'src/a.js': '// FEEDBACK-DELETE-FILE\nexport const x = 1;\n',
            'doc/notes.md': 'To delete a file write FEEDBACK-DELETE-FILE as its only line.\n',
        };
        const { pipeline, rmCalls } = makePipeline({
            gitOutputs: { 'status --porcelain': ' M src/a.js\n M doc/notes.md\n' },
            fsImpl: {
                readFileSync: (p) => {
                    const key = Object.keys(contents).find((file) =>
                        String(p).replace(/\\/g, '/').endsWith(file)
                    );
                    return key ? contents[key] : '';
                },
            },
        });
        await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(rmCalls).toEqual([]);
    });

    it('超过标记体量上限的文件先由 statSync 拦下，整文件不读入内存', async () => {
        // 坏行为下的形态：Agent 改动一个几百 MB 的资产文件时，扫描器把它整个
        // readFileSync 进内存只为看前几个字符——守卫必须在读之前，不是读之后截断。
        const readCalls = [];
        const { pipeline, rmCalls } = makePipeline({
            gitOutputs: { 'status --porcelain': ' M assets/huge.bin\n M src/tiny.js\n' },
            fsImpl: {
                statSync: (p) =>
                    String(p).replace(/\\/g, '/').endsWith('assets/huge.bin')
                        ? { size: 100_000_000 }
                        : { size: 24 },
                readFileSync: (p) => {
                    readCalls.push(String(p).replace(/\\/g, '/'));
                    // 即便大文件开头恰好长得像标记，也轮不到内容判定出场。
                    return '// FEEDBACK-DELETE-FILE';
                },
            },
        });
        await pipeline.finalize({ runId: 'run_w1', context: CONTEXT, prep });
        expect(readCalls).toEqual(['C:/ws/src/tiny.js']);
        expect(rmCalls).toEqual(['C:/ws/src/tiny.js']);
    });
});

describe('[SCN-FWB-035] `.git` 被动过就地终止（评审 §1.1）', () => {
    // 坏行为画像：Agent 在 turn 里写 `.git/hooks/pre-commit` 或往 `.git/config` 塞一条
    // filter 驱动。这些改动不进 diff（git 不跟踪 .git）、`reset --hard`/`clean -fd`
    // 清不掉、跨 Run 存活，并会在带真实 push 凭据的 release 阶段兑现。门禁看不见它，
    // 所以唯一的可见性只能来自 turn 前后的元数据对账。
    const context = { ...CONTEXT };

    it('turn 前后 `.git` 指纹不一致 → security_policy_violation，且不提交、不跑验证', async () => {
        const { pipeline, git, verificationCalls } = makePipeline();
        const outcome = await pipeline.finalize({
            runId: 'run_w1',
            context,
            prep: {
                baseCommit: BASE,
                candidateRef: 'feedback/candidate/run_w1',
                // prepare 阶段拍的基线；finalize 会重新采集并比对。
                gitMetadata: { digest: 'before', entries: { 'gitdir/hooks/pre-commit': 'absent' } },
            },
        });
        expect(outcome.outcome).toBe('failed');
        expect(outcome.errorCode).toBe('security_policy_violation');
        expect(outcome.failurePayload.violations).toContainEqual({
            code: 'GIT_METADATA_TAMPERED',
            file: 'gitdir/hooks/pre-commit',
        });
        // 终止必须发生在提交与验证之前：后面每一步都是「在这台机器上执行东西」。
        expect(git.calls.some((call) => call.includes('commit'))).toBe(false);
        expect(verificationCalls).toHaveLength(0);
    });

    it('`.git` 未被动过时照常走完预检→提交→验证', async () => {
        const { pipeline } = makePipeline();
        const prepared = await pipeline.prepare({ runId: 'run_w1', context });
        const outcome = await pipeline.finalize({ runId: 'run_w1', context, prep: prepared });
        expect(outcome.outcome).toBe('completed');
    });

    it('生产工厂暴露 reconcileGitMetadata——失败收场的轮次由 run-loop 补对账（二次评审 高-6）', async () => {
        // 坏行为画像：对账只在成功走到 finalize 的轮次跑。Agent 改完 `.git` 后
        // 只要让本轮以失败收场（空响应、超时、任何异常），对账即被跳过——而下
        // 一轮 prepare 会把篡改后的状态重新拍成基线，后门从此免检、跨 Run 存活。
        // run-loop 用 `writePipeline.reconcileGitMetadata?.()` 兼容旧测试 stub，
        // 生产接线由这条钉死（同 SCN-FWB-044 prepareReadOnly 的模式）。
        const { pipeline } = makePipeline();
        expect(pipeline.reconcileGitMetadata).toBeTypeOf('function');
        const tampered = await pipeline.reconcileGitMetadata({
            prep: {
                gitMetadata: { digest: 'before', entries: { 'gitdir/hooks/pre-commit': 'absent' } },
            },
        });
        expect(tampered).toContain('gitdir/hooks/pre-commit');
        // 没拍过基线（只读轮/prepare 失败）时不误报。
        expect(await pipeline.reconcileGitMetadata({ prep: null })).toEqual([]);
    });
});
