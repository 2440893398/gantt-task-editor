import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** CLI 行为用例建的临时仓库；跑完删掉。 */
const cliRepos = [];
afterAll(() => {
    while (cliRepos.length) rmSync(cliRepos.pop(), { recursive: true, force: true });
});
import {
    classifyFeedbackQualityTier,
    classifyDiffPath,
    evaluateDiffGate,
    findVerificationWeakening,
    requiresFeedbackVisualEvidence,
    normalizeDiffPath,
    scnIdFromDiff,
} from '../../../src/features/feedback/diff-gate.js';

// `scripts/feedback-diff-gate.mjs` starts with a shebang, so importing it makes
// Vitest fail to parse the whole file. The plumbing is pinned as text instead.
//
// 行尾归一化不是装饰：本仓 core.autocrlf=true，executor-ws 的候选分支每轮
// `checkout -B` 会把改动过的文件重物化成 CRLF，而本文件的多行 toContain 断言
// 写的是 `\n`——2026-08-29 写入型金丝雀 run_543befcc 因此在 executor-ws 假摔
// （主仓 LF 全绿，字节级对比 5084 CRLF vs 5183 LF）。断言的是代码形状，不是行尾。
function readProjectFile(relativePath) {
    return fs
        .readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
        .replace(/\r\n/g, '\n');
}

/**
 * The project rules in CLAUDE.md and tests/scenarios/README.md only hold if
 * something mechanical enforces them. These tests describe what an Agent must
 * not be able to do, no matter what its prompt says.
 */
describe('[SCN-FWB-012] feedback diff gate', () => {
    describe('path classification', () => {
        it('hard-denies golden answers, git internals and credential files', () => {
            const denied = [
                'tests/e2e/agent-journeys/expected/import-project-plan.json',
                'tests/e2e/agent-journeys/expected/schedule-move-cascade.json',
                '.git/config',
                '.env',
                '.env.local',
                '.dev.vars',
                '.npmrc',
                'deploy/id_rsa',
            ];

            for (const file of denied) {
                expect(classifyDiffPath(file), file).toBe('hard_deny');
            }
        });

        it('requires admin approval for build, deploy and governance paths', () => {
            const gated = [
                '.github/workflows/feedback-agent-codex.yml',
                'scripts/check-scenario-coverage.mjs',
                'wrangler.toml',
                'wrangler.jsonc',
                'AGENTS.md',
                'CLAUDE.md',
                '.agents/config.json',
                '.codex/settings.json',
            ];

            for (const file of gated) {
                expect(classifyDiffPath(file), file).toBe('needs_approval');
            }
        });

        it('treats scenario lists and the append-only CHANGES log as contract-aware', () => {
            // Blocking these outright would make a legitimate requirement change
            // impossible, so they get their own conditions instead.
            expect(classifyDiffPath('tests/scenarios/feedback-workbench.md')).toBe(
                'contract_aware'
            );
            expect(classifyDiffPath('tests/e2e/agent-journeys/expected/CHANGES.md')).toBe(
                'contract_aware'
            );
        });

        it('leaves ordinary source and test files alone', () => {
            for (const file of [
                'src/features/gantt/domain/link-ops.js',
                'tests/unit/gantt/scheduler.test.js',
                'tests/e2e/agent-journeys/import.spec.js',
                'README.md',
            ]) {
                expect(classifyDiffPath(file), file).toBe('allowed');
            }
        });

        it('normalizes separators and rejects traversal', () => {
            expect(normalizeDiffPath('.\\tests\\scenarios\\x.md')).toBe('tests/scenarios/x.md');
            expect(
                classifyDiffPath('tests\\e2e\\agent-journeys\\expected\\import-project-plan.json')
            ).toBe('hard_deny');
            expect(classifyDiffPath('tests//e2e//agent-journeys//expected//a.json')).toBe(
                'hard_deny'
            );
            expect(classifyDiffPath('../../etc/passwd')).toBe('hard_deny');
            expect(classifyDiffPath('/etc/passwd')).toBe('hard_deny');
            expect(classifyDiffPath('C:\\Users\\runner\\secret.txt')).toBe('hard_deny');
            expect(classifyDiffPath('D:/runner/secret.txt')).toBe('hard_deny');
            expect(classifyDiffPath('\\\\server\\share\\secret.txt')).toBe('hard_deny');
        });

        it('requires review for dependency and build configuration', () => {
            for (const file of ['package.json', 'package-lock.json', 'vite.config.js']) {
                expect(classifyDiffPath(file), file).toBe('needs_approval');
                expect(classifyFeedbackQualityTier([file]), file).toBe(3);
            }
        });
    });

    describe('verification weakening', () => {
        it('flags skipped tests and deleted assertions in added or removed lines', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '-    expect(result.tasks).toEqual(expected);',
                '+    it.skip("regression", () => {});',
                '+    test.only("focus", () => {});',
            ].join('\n');

            const findings = findVerificationWeakening(diff);
            const codes = findings.map((finding) => finding.code);

            expect(codes).toContain('ASSERTION_REMOVED');
            expect(codes).toContain('TEST_SKIP');
            expect(codes).toContain('TEST_ONLY');
            expect(findings.every((finding) => finding.file === 'tests/unit/example.test.js')).toBe(
                true
            );
        });

        it('[SCN-FWB-012] allows an assertion to be replaced inside the same diff hunk', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '@@ -10,1 +10,1 @@',
                "-    expect(window.location.hash).toBe('');",
                '+    expect(window.location.hash).toBe(`#issue=${issueId}`);',
            ].join('\n');

            expect(findVerificationWeakening(diff)).toEqual([]);
        });

        it('[SCN-FWB-012] does not let another hunk hide a removed assertion', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '@@ -10,1 +10,0 @@',
                '-    expect(result.saved).toBe(true);',
                '@@ -30,0 +30,1 @@',
                '+    expect(result.visible).toBe(true);',
            ].join('\n');

            expect(findVerificationWeakening(diff)).toContainEqual(
                expect.objectContaining({ code: 'ASSERTION_REMOVED' })
            );
        });

        it('[SCN-FWB-012] rejects a deep compare downgraded to a truthy matcher in the same hunk', () => {
            // README §3.2 的原话是「放宽比较（如深比较降级为 truthy）」——这个形态
            // 必须有自己的名字，且不能被「新增了一条断言」的置换额度抵掉。
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '@@ -10,1 +10,1 @@',
                '-        expect(loaded).toEqual(snapshot);',
                '+        expect(loaded).toBeTruthy();',
            ].join('\n');

            expect(findVerificationWeakening(diff)).toContainEqual(
                expect.objectContaining({ code: 'DEEP_COMPARE_WEAKENED' })
            );

            const result = evaluateDiffGate({
                changedFiles: ['tests/unit/example.test.js'],
                diffText: diff,
                writeAllowed: true,
            });
            expect(result.allowed).toBe(false);
            expect(result.violations).toContainEqual(
                expect.objectContaining({
                    code: 'VERIFICATION_WEAKENED',
                    detail: 'DEEP_COMPARE_WEAKENED',
                })
            );
        });

        it('[SCN-FWB-012] weak matchers earn no replacement credit for a removed assertion', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '@@ -10,1 +10,1 @@',
                '-        expect(result.count).toBe(3);',
                '+        expect(result.count).toBeDefined();',
            ].join('\n');

            expect(findVerificationWeakening(diff)).toContainEqual(
                expect.objectContaining({ code: 'ASSERTION_REMOVED' })
            );
        });

        it('[SCN-FWB-012] still allows replacing a deep compare with another strong assertion', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '@@ -10,1 +10,1 @@',
                '-        expect(loaded).toEqual(oldSnapshot);',
                '+        expect(loaded).toEqual(newSnapshot);',
            ].join('\n');

            expect(findVerificationWeakening(diff)).toEqual([]);
        });

        it('[SCN-FWB-012] 恒真断言抵不了置换额度：toMatchObject({}) / expect.anything() / 字面量主语', () => {
            // 二次评审 高-4 实测：三种形态在旧词表下都被计成「强断言」抵掉了
            // 被删的深比较——allowed:true 零违规。toMatchObject({}) 对任意对象
            // 恒真；toEqual(expect.anything()) 是 deep-compare 外形的恒真式；
            // expect(1).toBe(1) 断的是常量，与被测值无关。
            const alwaysTrueAdditions = [
                '+        expect(loaded).toMatchObject({});',
                '+        expect(loaded).toEqual(expect.anything());',
                '+        expect(1).toBe(1);',
            ];
            for (const added of alwaysTrueAdditions) {
                const diff = [
                    '--- a/tests/unit/example.test.js',
                    '+++ b/tests/unit/example.test.js',
                    '@@ -10,1 +10,1 @@',
                    '-        expect(loaded).toEqual(snapshot);',
                    added,
                ].join('\n');

                const result = evaluateDiffGate({
                    changedFiles: ['tests/unit/example.test.js'],
                    diffText: diff,
                    writeAllowed: true,
                });
                expect(result.allowed, added).toBe(false);
                expect(result.violations, added).toContainEqual(
                    expect.objectContaining({
                        code: 'VERIFICATION_WEAKENED',
                        detail: 'DEEP_COMPARE_WEAKENED',
                    })
                );
            }
        });

        it('[SCN-FWB-012] suite.skip / skipIf / runIf / 括号取值都是 TEST_SKIP', () => {
            // 二次评审 高-7 实测：vitest 真导出 `suite` 作为 describe 的别名，
            // skipIf(true)、runIf(false)、it['skip'] 与 `.skip` 等价——旧词表只认
            // test|it|describe 加字面 `.skip`，这些形态全链路零发现。
            const skipForms = [
                "+suite.skip('quiet the failing group', () => {});",
                "+it.skipIf(true)('flaky path', () => {});",
                "+test.runIf(false)('never runs', () => {});",
                "+it['skip']('bracket access', () => {});",
                "+it.concurrent.skip('chained modifier', () => {});",
            ];
            for (const added of skipForms) {
                const diff = [
                    '--- a/tests/unit/example.test.js',
                    '+++ b/tests/unit/example.test.js',
                    added,
                ].join('\n');
                expect(findVerificationWeakening(diff), added).toContainEqual(
                    expect.objectContaining({ code: 'TEST_SKIP' })
                );
            }
        });

        it('[SCN-FWB-012] it.fails 让失败测试假绿——与 skip 同罪且授权不放行', () => {
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                "+it.fails('now passes when it fails', () => {});",
            ].join('\n');

            expect(findVerificationWeakening(diff)).toContainEqual(
                expect.objectContaining({ code: 'TEST_FAILS' })
            );
            const result = evaluateDiffGate({
                changedFiles: ['tests/unit/example.test.js'],
                diffText: diff,
                approvedPaths: ['tests/unit/example.test.js'],
                contractRunApproved: true,
                writeAllowed: true,
            });
            expect(result.allowed).toBe(false);
        });

        it('[SCN-FWB-012] 新增行伪造 +++ b/ 头改写不了归属（diff 头注入）', () => {
            // 实测（二次评审 中-6）：新增行内容以 `++ b/<已授权路径>` 开头时，
            // diff 的 `+` 前缀拼出来恰是合法头形态——同 hunk 下方的
            // ASSERTION_REMOVED 被归属到已授权路径，从「违规」降档成「候选复核」。
            // 头必须紧跟真实的 `--- ` 行才算数。
            const diff = [
                '--- a/tests/unit/example.test.js',
                '+++ b/tests/unit/example.test.js',
                '@@ -10,2 +10,2 @@',
                '+++ b/tests/approved.test.js',
                '-        expect(loaded).toEqual(snapshot);',
            ].join('\n');

            const result = evaluateDiffGate({
                changedFiles: ['tests/unit/example.test.js'],
                diffText: diff,
                approvedPaths: ['tests/approved.test.js'],
                contractRunApproved: true,
                writeAllowed: true,
            });
            expect(result.allowed).toBe(false);
            expect(result.violations).toContainEqual(
                expect.objectContaining({
                    code: 'VERIFICATION_WEAKENED',
                    file: 'tests/unit/example.test.js',
                })
            );
        });

        it('[SCN-FWB-012] scnIdFromDiff 不认伪造头——SCN 只能来自真实契约文件的新增行', () => {
            const diff = [
                '--- a/src/features/gantt/foo.js',
                '+++ b/src/features/gantt/foo.js',
                '@@ -1,1 +1,2 @@',
                '+++ b/tests/scenarios/feedback-workbench.md',
                '+// SCN-FWB-001 planted in a non-contract file',
            ].join('\n');

            expect(scnIdFromDiff(diff)).toBe('');
        });

        it('[SCN-FWB-012] 删除整个测试文件的 `-` 行归属被删文件，不串进前一个文件', () => {
            // `+++ /dev/null` 是删除文件的合法头；不识别它的话，被删文件的每一条
            // 删除行都会误归属到 diff 里前一个文件——授权/降档判定全都跟着错位。
            const diff = [
                '--- a/tests/unit/kept.test.js',
                '+++ b/tests/unit/kept.test.js',
                '@@ -10,1 +10,1 @@',
                '+        expect(kept.total).toEqual(expected);',
                '--- a/tests/unit/deleted.test.js',
                '+++ /dev/null',
                '@@ -1,3 +0,0 @@',
                '-        expect(gone).toEqual(everything);',
            ].join('\n');

            expect(findVerificationWeakening(diff)).toContainEqual(
                expect.objectContaining({
                    code: 'ASSERTION_REMOVED',
                    file: 'tests/unit/deleted.test.js',
                })
            );
        });

        it('does not flag context lines that merely mention the pattern', () => {
            const diff = [
                '--- a/docs/testing.md',
                '+++ b/docs/testing.md',
                '     禁止使用 test.skip 消除失败',
                '+我们仍然禁止 test.skip 这种做法（说明文字）',
            ].join('\n');

            // The added line is prose, not a call — the pattern requires `(`.
            expect(findVerificationWeakening(diff)).toEqual([]);
        });
    });

    describe('gate decisions', () => {
        it('blocks a Candidate that rewrites a golden answer', () => {
            const result = evaluateDiffGate({
                changedFiles: [
                    'src/features/gantt/domain/scheduler.js',
                    'tests/e2e/agent-journeys/expected/import-project-plan.json',
                ],
            });

            expect(result.allowed).toBe(false);
            expect(result.errorCode).toBe('security_policy_violation');
            expect(result.violations).toContainEqual({
                code: 'HARD_DENY_PATH',
                file: 'tests/e2e/agent-journeys/expected/import-project-plan.json',
            });
        });

        it('cannot be unblocked by an admin scope that names a hard-denied path', () => {
            const result = evaluateDiffGate({
                changedFiles: ['tests/e2e/agent-journeys/expected/import-project-plan.json'],
                approvedPaths: ['tests/e2e/agent-journeys/expected/import-project-plan.json'],
                contractRunApproved: true,
                scnId: 'SCN-AGT-003',
            });

            // §14.4 rule 6: a signed scope releases approval-level paths only.
            expect(result.allowed).toBe(false);
            expect(result.violations[0].code).toBe('HARD_DENY_PATH');
        });

        it('blocks CI and deploy edits unless they are in the signed scope', () => {
            const blocked = evaluateDiffGate({
                changedFiles: ['.github/workflows/feedback-agent-codex.yml'],
            });
            expect(blocked.allowed).toBe(false);
            expect(blocked.violations[0].code).toBe('PATH_NOT_IN_APPROVED_SCOPE');

            const approved = evaluateDiffGate({
                changedFiles: ['.github/workflows/feedback-agent-codex.yml'],
                approvedPaths: ['.github/workflows/feedback-agent-codex.yml'],
            });
            expect(approved.allowed).toBe(true);
            expect(approved.requiresCandidateReview).toEqual([
                '.github/workflows/feedback-agent-codex.yml',
            ]);
            // An approved sensitive path always goes through review, never auto.
            expect(approved.autoDeliverAllowed).toBe(false);
        });

        it('allows a contract change only from a trusted Run that cites an SCN', () => {
            const files = ['tests/scenarios/feedback-workbench.md'];

            expect(evaluateDiffGate({ changedFiles: files }).violations[0].code).toBe(
                'CONTRACT_CHANGE_NOT_AUTHORIZED'
            );
            expect(
                evaluateDiffGate({ changedFiles: files, contractRunApproved: true }).violations[0]
                    .code
            ).toBe('CONTRACT_CHANGE_MISSING_SCN');

            const allowed = evaluateDiffGate({
                changedFiles: files,
                contractRunApproved: true,
                scnId: 'SCN-FWB-015',
            });
            expect(allowed.allowed).toBe(true);
            expect(allowed.autoDeliverAllowed).toBe(false);
        });

        it('fails a read-only policy that produced any change at all', () => {
            const result = evaluateDiffGate({
                changedFiles: ['src/features/gantt/domain/scheduler.js'],
                writeAllowed: false,
            });

            expect(result.allowed).toBe(false);
            expect(result.violations[0].code).toBe('READ_ONLY_POLICY_WROTE_FILES');
        });

        it('blocks a change set that deletes assertions even on allowed paths', () => {
            const result = evaluateDiffGate({
                changedFiles: ['tests/unit/gantt/scheduler.test.js'],
                diffText: [
                    '+++ b/tests/unit/gantt/scheduler.test.js',
                    '-        expect(task.end).toBe("2026-03-06");',
                ].join('\n'),
            });

            expect(result.allowed).toBe(false);
            expect(result.violations[0].code).toBe('VERIFICATION_WEAKENED');
            expect(result.violations[0].detail).toBe('ASSERTION_REMOVED');
        });

        it('[SCN-FWB-022] mechanically assigns quality tiers and visual evidence needs', () => {
            expect(classifyFeedbackQualityTier(['doc/feedback-copy.md'])).toBe(0);
            expect(
                classifyFeedbackQualityTier([
                    'src/utils/time-formatter.js',
                    'tests/unit/time-formatter.test.js',
                ])
            ).toBe(1);
            expect(classifyFeedbackQualityTier(['workers/feedback-workbench-ui.js'])).toBe(2);
            expect(classifyFeedbackQualityTier(['src/core/storage.js'])).toBe(3);
            expect(classifyFeedbackQualityTier(['src/features/gantt/domain/link-ops.js'])).toBe(3);
            expect(classifyFeedbackQualityTier(['src/features/ai/tools/hierarchy.js'])).toBe(3);
            expect(classifyFeedbackQualityTier(['src/features/agent-cli/commands/link.js'])).toBe(
                3
            );
            expect(
                classifyFeedbackQualityTier([
                    'src/features/ai/api.js',
                    'src/features/task-details/panel.js',
                ])
            ).toBe(3);
            expect(requiresFeedbackVisualEvidence(['workers/feedback-workbench-ui.js'])).toBe(true);
            expect(requiresFeedbackVisualEvidence(['src/utils/time-formatter.js'])).toBe(false);
        });

        it('[SCN-FWB-022] lets an ordinary low-risk fix through and marks it auto-deliverable', () => {
            const result = evaluateDiffGate({
                changedFiles: ['src/utils/time-formatter.js', 'tests/unit/time-formatter.test.js'],
                diffText: [
                    '+++ b/tests/unit/time-formatter.test.js',
                    '+        expect(formatDuration(1)).toBe("1 day");',
                ].join('\n'),
            });

            expect(result.allowed).toBe(true);
            expect(result.violations).toEqual([]);
            expect(result.qualityTier).toBe(1);
            expect(result.visualEvidenceRequired).toBe(false);
            expect(result.autoDeliverAllowed).toBe(true);
        });

        it('[SCN-FWB-022] forces Tier 3 core changes through Candidate review', () => {
            const result = evaluateDiffGate({
                changedFiles: [
                    'src/features/gantt/domain/link-ops.js',
                    'tests/unit/gantt/domain/link-ops.test.js',
                ],
            });

            expect(result.allowed).toBe(true);
            expect(result.qualityTier).toBe(3);
            expect(result.autoDeliverAllowed).toBe(false);
        });
    });

    /**
     * The rule table above was always right; nothing ever supplied its inputs.
     * `contractRunApproved` had no source in the whole pipeline, so every Run
     * that followed CLAUDE.md's "update the scenario inventory first" was
     * rejected with CONTRACT_CHANGE_NOT_AUTHORIZED — after paying for the full
     * verification sequence (run 31322835665).
     */
    describe('[SCN-FWB-012] contract-run authorization reaches the gate', () => {
        const gate = readProjectFile('scripts/feedback-diff-gate.mjs');

        it('[SCN-FWB-012] grants the authorization server-side, never in the Runner', () => {
            // 授权在控制面下发：写入型 Run 就是可改契约的 Run，执行侧不自己决定。
            //
            // 代码评审 2026-09-02 §2.3/§5.3：这条原来钉的是 share-worker.js 里两句
            // 赋值的**源码文本**（连操作数顺序一起）。§5.3 把两份 Run context 的拼装
            // 合并成一个共享构造器之后，那两句文本不复存在，而行为一个字都没变——
            // 一次纯粹的假红。真正要保护的是「执行侧拿到的授权来自服务端状态」，
            // 而这件事由 `feedback-executor-control-plane.test.js` 的行为用例钉住
            // （lease context 与 run context 对同一条 Run 给出同一个 contractRunApproved）。
            //
            // 这里只留一条源码级的实质断言：Worker 不得自己再实现一份门禁判据。
            const worker = readProjectFile('workers/share-worker.js');
            expect(worker).toContain('evaluateDiffGate');
            expect(worker).not.toContain('function evaluateDiffGate(');
        });

        it('[SCN-FWB-012] reads the SCN-ID off the change instead of trusting a declaration', () => {
            // A declared `--scn` is a string the caller picked; it can name a
            // scenario the diff never touches. The added lines cannot lie.
            //
            // 代码评审 2026-09-02 §2.3：这条原来是「源码里存在 `const scnId =
            // scnIdFromDiff(diffText);` 且可执行行里不出现 args.scn」——改个变量名就
            // 假红，把旁路挪进一个函数里就假绿。CLI 带 shebang 不能被 import
            // （见 memory: vitest-shebang-import-trap），但它**可以被 spawn**：
            // 给它一个同时声明了假 --scn 与假环境变量的调用，看它认哪一个。
            const repo = mkdtempSync(join(tmpdir(), 'diff-gate-cli-'));
            cliRepos.push(repo);
            const git = (args) =>
                spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
            git(['init', '-q']);
            git(['config', 'user.email', 'gate@localhost']);
            git(['config', 'user.name', 'gate']);
            writeFileSync(join(repo, 'seed.txt'), 'seed');
            git(['add', '-A']);
            git(['commit', '-m', 'seed']);
            const base = git(['rev-parse', 'HEAD']).stdout.trim();

            // SCN-ID 只从**契约文件**的新增行里读（CONTRACT_AWARE_PATTERNS：
            // 场景清单与 expected/CHANGES.md）——改动自己声明的是 SCN-REAL-001。
            mkdirSync(join(repo, 'tests', 'scenarios'), { recursive: true });
            writeFileSync(
                join(repo, 'tests', 'scenarios', 'demo.md'),
                '| SCN-REAL-001 | P0 | 新场景 | 验证点 | active |'
            );
            git(['add', '-A']);

            const result = spawnSync(
                process.execPath,
                [
                    path.resolve(process.cwd(), 'scripts/feedback-diff-gate.mjs'),
                    '--base',
                    base,
                    '--staged',
                    'true',
                    // 改契约本身需要授权，否则门禁直接判负、连 manifest 都不打印。
                    '--contract-run',
                    'true',
                    '--scn',
                    'SCN-DECLARED-999',
                ],
                {
                    cwd: repo,
                    encoding: 'utf8',
                    windowsHide: true,
                    // 环境变量旁路同样不该被认——GITHUB_ENV 污染在本仓是真实威胁模型。
                    env: { ...process.env, FEEDBACK_SCN_ID: 'SCN-FROM-ENV-888' },
                }
            );

            const stdoutLines = result.stdout.trim().split(/\r?\n/);
            const manifest = JSON.parse(stdoutLines[stdoutLines.length - 1]);
            expect(manifest.scnId).toBe('SCN-REAL-001');
            expect(manifest.scnId).not.toBe('SCN-DECLARED-999');
            expect(manifest.scnId).not.toBe('SCN-FROM-ENV-888');
        });

        it('[SCN-FWB-012] hands the same authorization to the workbench re-check', () => {
            // §15.3's second enforcement point re-runs this table on the
            // callback payload. Without these two fields it defaults both to
            // empty and rejects what the Runner just allowed.
            expect(gate).toContain('contractRunApproved,');
            expect(gate).toContain('scnId,');
        });
    });
});

/**
 * SCN-FWB-039：对「删掉某功能」类任务，删除该功能的测试断言是任务固有行为。
 * `#czi9c6` 的写入 Run 正是死在这里：16 条 ASSERTION_REMOVED 全部来自被移除
 * 功能自己的测试。授权（管理员对着违规清单签字）必须能放行这一类削弱——
 * 但只降档为强制候选复核，绝不放行 skip/only/todo 这类「留着测试假装还在跑」。
 */
describe('[SCN-FWB-039] approved-scope softening for verification weakening', () => {
    const removalDiff = [
        '--- a/tests/core/baseline-store.test.js',
        '+++ b/tests/core/baseline-store.test.js',
        '-        expect(store.saveBaseline(tasks)).toBe(true);',
        '-        expect(loaded).toEqual(snapshot);',
    ].join('\n');

    it('downgrades ASSERTION_REMOVED on an approved path to candidate review, not a violation', () => {
        const result = evaluateDiffGate({
            changedFiles: ['tests/core/baseline-store.test.js', 'src/features/gantt/baseline.js'],
            diffText: removalDiff,
            approvedPaths: ['tests/core/baseline-store.test.js', 'src/features/gantt/baseline.js'],
            contractRunApproved: true,
            writeAllowed: true,
        });

        expect(result.violations).toEqual([]);
        expect(result.allowed).toBe(true);
        expect(result.requiresCandidateReview).toContain('tests/core/baseline-store.test.js');
        // 授权换来的是人审，不是免审。
        expect(result.autoDeliverAllowed).toBe(false);
    });

    it('still rejects ASSERTION_REMOVED outside the approved scope', () => {
        const result = evaluateDiffGate({
            changedFiles: ['tests/core/baseline-store.test.js'],
            diffText: removalDiff,
            approvedPaths: ['src/features/gantt/baseline.js'],
            writeAllowed: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.violations).toContainEqual(
            expect.objectContaining({ code: 'VERIFICATION_WEAKENED', detail: 'ASSERTION_REMOVED' })
        );
    });

    it('never lets approval clear test.skip/only/todo — those fake a passing suite', () => {
        const skipDiff = [
            '--- a/tests/core/baseline-store.test.js',
            '+++ b/tests/core/baseline-store.test.js',
            "+        it.skip('saves a baseline snapshot', () => {",
        ].join('\n');

        const result = evaluateDiffGate({
            changedFiles: ['tests/core/baseline-store.test.js'],
            diffText: skipDiff,
            approvedPaths: ['tests/core/baseline-store.test.js'],
            contractRunApproved: true,
            writeAllowed: true,
        });

        expect(result.allowed).toBe(false);
        expect(result.violations).toContainEqual(
            expect.objectContaining({ code: 'VERIFICATION_WEAKENED', detail: 'TEST_SKIP' })
        );
    });
});
