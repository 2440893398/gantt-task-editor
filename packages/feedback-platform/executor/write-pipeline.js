/**
 * 执行器写入管线（SCN-FWB-032）——run-plan 五个 `appliesTo: 'write'` 步骤的编排：
 * diff gate 预检 → 定向测试 → 构建 → 浏览器验证 → 权威门禁，外加候选提交与
 * manifest 构造。全部发生在 Agent 接触不到的执行器进程里。
 *
 * 顺序即血泪规则（run-plan.js 的注释是权威）：
 * - 预检在一切验证之前（C2：注定不能发布的改动不得先烧完整轮验证预算）；
 * - 预检失败**跳过**验证并保留规则名，不是让整个 Run 挂掉；
 * - 权威门禁跑在提交后的 base..HEAD 上，晚于预检且不容错——预检永不授予任何东西；
 * - 被门禁拦下的候选不产生提交记录（Worker 侧同款规则：blocked Candidate 的
 *   commit 不得被记录为该 Run 的 change_commit）。
 *
 * manifest 与 GitHub 路径的 `scripts/feedback-diff-gate.mjs` 逐键同形、同一哈希
 * 算法（去 sha 字段后 JSON.stringify 再 sha256），服务端 `verifyRunCompletionManifest`
 * 与 `registerFeedbackCandidate` 用同一份代码接住两条路径——候选注册因此是纯
 * 服务端行为，执行器不需要（也没有）单独的注册端点。
 */
import { createHash } from 'node:crypto';
import {
    existsSync as fsExistsSync,
    readdirSync as fsReaddirSync,
    readFileSync as fsReadFileSync,
    rmSync as fsRmSync,
    statSync as fsStatSync,
} from 'node:fs';
import { join } from 'node:path';
import { evaluateDiffGate, scnIdFromDiff } from '../../../src/features/feedback/diff-gate.js';
import { evaluateReadAccess } from './admission.js';
import {
    FEEDBACK_DELETE_MARKER,
    FEEDBACK_EVIDENCE_DIR,
} from '../../../src/features/feedback/feedback-prompt.js';
import {
    candidateRefFor,
    collectCandidateChanges,
    commitCandidate,
    committedCandidateDiff,
    createGitRunner,
    diffGitMetadata,
    prepareCandidateWorkspace,
    prepareReadOnlyWorkspace,
    snapshotGitMetadata,
} from './candidate.js';
import { runCommand, runVerificationSteps } from './verification.js';

/** 与 diff-gate CLI 同形的 manifest。键序即哈希输入，改动键序等于改动签名。 */
export function buildDiffManifest({
    repository,
    baseRef,
    candidateRef,
    baseCommit,
    changeCommit,
    changedFiles,
    contractRunApproved,
    scnId,
    gate,
}) {
    const manifest = {
        specVersion: '1.0',
        repository: String(repository || ''),
        baseRef: String(baseRef || ''),
        candidateRef: String(candidateRef || ''),
        baseCommit: String(baseCommit || ''),
        changeCommit: String(changeCommit || ''),
        changedFiles: Array.isArray(changedFiles) ? changedFiles : [],
        contractRunApproved: contractRunApproved === true,
        scnId: String(scnId || ''),
        violations: gate?.violations ?? [],
        requiresCandidateReview: gate?.requiresCandidateReview ?? [],
        qualityTier: gate?.qualityTier ?? '',
        visualEvidenceRequired: gate?.visualEvidenceRequired === true,
        autoDeliverAllowed: gate?.autoDeliverAllowed === true,
    };
    manifest.diffManifestSha256 = createHash('sha256')
        .update(JSON.stringify({ ...manifest, diffManifestSha256: undefined }))
        .digest('hex');
    return manifest;
}

const failedStepLabel = {
    targetedTests: 'targeted tests',
    build: 'build',
    playwright: 'browser verification',
};

// SCN-FWB-041：「整个文件即单行标记」才算删除请求。允许一层注释记号包裹——
// 斜杠注释、#、分号、SQL 双横线、C 风格块注释与 HTML 注释均可（记号写进正则，
// 不在此逐字列举：字面写出块注释/HTML 注释的闭合记号会当场终结本注释）。
// 正文里出现该字符串不触发——检测对象是 trim 后的完整文件内容，不是某一行。
const DELETE_MARKER_PATTERN = new RegExp(
    `^(?:\\/\\/|#|;|--|\\/\\*|<!--)?\\s*${FEEDBACK_DELETE_MARKER}\\s*(?:\\*\\/|-->)?$`
);
/** 标记文件的体量上限（字节）。超限直接跳过，statSync 守卫在 readFileSync 之前。 */
const DELETE_MARKER_MAX_BYTES = 512;

/** `git status --porcelain` 的路径段：含特殊字符时被 C 风格双引号包裹。 */
function unquoteGitPath(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
    try {
        return JSON.parse(trimmed);
    } catch {
        return '';
    }
}

export function createWritePipeline({
    workspaceDir,
    childEnv,
    log = () => {},
    gitFactory = createGitRunner,
    runVerification = runVerificationSteps,
    runCommandImpl = runCommand,
    fsImpl = {
        existsSync: fsExistsSync,
        readdirSync: fsReaddirSync,
        readFileSync: fsReadFileSync,
        rmSync: fsRmSync,
        statSync: fsStatSync,
    },
} = {}) {
    if (!workspaceDir) throw new Error('EXECUTOR_WRITE_PIPELINE_WORKSPACE_REQUIRED');
    // S3（评审 §1.1）：git 也是子进程，也只拿白名单环境——不传 env 就等于把
    // FEEDBACK_EXECUTOR_TOKEN 与 PAT 交给一个「配置文件能定义任意命令」的程序。
    const git = gitFactory({ cwd: workspaceDir, env: childEnv });

    /**
     * 「本轮产出了视觉证据」= evidence 目录里有**未跟踪的** png。判定走文件系统而
     * 不是 git status——该目录整个在 `.gitignore` 里，porcelain 对被 ignore 的文件
     * 永远静默（加 `--ignored` 也只坍缩成 `!! tests/e2e/evidence/` 一行），旧实现
     * 因此结构性恒 false：run_5104cfc1 的截图真实躺在磁盘上（93KB，时间戳落在
     * e2e 区间内），全绿 Run 仍被判「未产出证据」。「证据必须本次验证专用」
     * （2026-08-22 教训，C3）不再靠 git 的「新文件」语义，改由 prepare 阶段的
     * `git clean -fdx -- <evidenceDir>` 清场保证：验证后目录里的 PNG 只可能是
     * 本轮写下的。已跟踪文件 clean 清不掉，故仍需排除，防历史截图冒充证据。
     */
    async function evidenceProducedThisRun() {
        let names = [];
        try {
            names = fsImpl.readdirSync(join(workspaceDir, FEEDBACK_EVIDENCE_DIR));
        } catch {
            return false; // 目录不存在 = 本轮没有证据
        }
        const pngs = names.filter((name) => String(name).toLowerCase().endsWith('.png'));
        if (!pngs.length) return false;
        try {
            const tracked = new Set(
                (await git('ls-files', '--', FEEDBACK_EVIDENCE_DIR)).stdout
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean)
            );
            return pngs.some((name) => !tracked.has(`${FEEDBACK_EVIDENCE_DIR}/${name}`));
        } catch {
            return false;
        }
    }

    /**
     * SCN-FWB-041：把 Agent 留下的删除标记文件变成真实删除。扫描对象是 porcelain
     * 报出的改动与新增（被 ignore 的文件不在其中，也不该在），删除发生在暂存之前，
     * `git add -A` 随后把删除纳入候选 diff——门禁、changedFiles、验证对删除的
     * 处理与普通改动完全一致。返回被删路径供日志留痕。
     */
    async function applyDeleteMarkers() {
        const status = (await git('status', '--porcelain')).stdout;
        const deleted = [];
        for (const line of status.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const code = line.slice(0, 2);
            // D = 已是删除；R = 改名（Agent 无命令通道，理论上不出现）——都不扫。
            if (code.includes('D')) continue;
            const rawPath = line.slice(3);
            const file = unquoteGitPath(
                rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath
            );
            if (!file) continue;
            const absolute = join(workspaceDir, file);
            // S3（§1.5）：执行器自己的读取过闸。porcelain 的路径是仓库相对的，
            // 正常情况下永远在工作区内——但「正常情况下」不是防线，`.env` 类文件
            // 更不该因为「它出现在 git status 里」就被读进内存。
            if (!evaluateReadAccess(absolute, { workspaceDir }).allowed) {
                log(`[executor] delete-marker scan skipped a denylisted path: ${file}`);
                continue;
            }
            let content = '';
            try {
                // 体量守卫在读之前：标记文件（标记 + 注释包裹 + 空白）远小于 512 字节，
                // 超限的改动文件（如大资产）不值得为看开头几个字符整个读进内存。
                if (fsImpl.statSync(absolute).size > DELETE_MARKER_MAX_BYTES) continue;
                content = String(fsImpl.readFileSync(absolute, { encoding: 'utf8' }));
            } catch {
                continue;
            }
            const trimmed = content.trim();
            if (!trimmed || trimmed.includes('\n')) continue;
            if (!DELETE_MARKER_PATTERN.test(trimmed)) continue;
            fsImpl.rmSync(join(workspaceDir, file));
            deleted.push(file);
            log(`[executor] delete marker honoured: ${file}`);
        }
        return deleted;
    }

    function skippedReport(context) {
        const commands = context?.commands ?? {};
        const playwrightRequired = context?.policy === 'implement_and_verify';
        return {
            targetedTests: {
                command: String(commands.test || 'npm test'),
                required: true,
                passed: false,
            },
            build: {
                command: String(commands.build || 'npm run build'),
                required: true,
                passed: false,
            },
            playwright: {
                command: String(commands.e2e || 'npm run test:e2e'),
                required: playwrightRequired,
                passed: !playwrightRequired,
            },
        };
    }

    return {
        /**
         * turn 开始前清场并建候选分支。失败带 errorCode，让 C4 的终态兜底
         * 能说出「工作区没备好」而不是笼统的 internal error。
         */
        async prepare({ runId, context }) {
            try {
                const prepared = await prepareCandidateWorkspace({
                    runId,
                    defaultBranch: context?.defaultBranch || 'master',
                    git,
                    // C3：清掉上一轮残留的（被 gitignore 的）证据 PNG，见 evidenceProducedThisRun。
                    evidenceDir: FEEDBACK_EVIDENCE_DIR,
                    // SCN-FWB-040：有上一轮候选就建在它之上，提交缺席时静默回落全新开工。
                    resumeFromCommit: String(context?.previousAttempt?.changeCommit || ''),
                });
                // 评审 §1.1：turn 之前的 `.git` 元数据基线。清场之后取——reset/clean/checkout
                // 本来就会动 gitdir 里的东西，基线必须是「Agent 拿到工作区的那一刻」。
                return {
                    ...prepared,
                    gitMetadata: await snapshotGitMetadata({ workspaceDir, git, fsImpl }),
                };
            } catch (error) {
                const wrapped = new Error(
                    `EXECUTOR_WORKSPACE_PREPARE_FAILED: ${String(error?.message || error)}`
                );
                wrapped.errorCode = 'executor_workspace_prepare_failed';
                throw wrapped;
            }
        },

        /**
         * 只读轮的基线同步（SCN-FWB-044）。与 prepare 同一套 errorCode 语义：
         * 「工作区没备好」必须区别于真崩溃，让 C4 的终态说得出原因。
         */
        async prepareReadOnly({ context }) {
            try {
                return await prepareReadOnlyWorkspace({
                    defaultBranch: context?.defaultBranch || 'master',
                    git,
                });
            } catch (error) {
                const wrapped = new Error(
                    `EXECUTOR_WORKSPACE_PREPARE_FAILED: ${String(error?.message || error)}`
                );
                wrapped.errorCode = 'executor_workspace_prepare_failed';
                throw wrapped;
            }
        },

        /**
         * turn 完成后的五步。返回 `{outcome: 'completed', completionPayload}` 或
         * `{outcome: 'failed', errorCode, summary, failurePayload}`——不抛业务失败，
         * 抛出的只有执行器自身故障（由 run-loop 的 C4 兜底接住）。
         */
        async finalize({ runId, context, prep, emitPhase = async () => {} }) {
            const identity = {
                repository: context?.repository || '',
                baseRef: context?.defaultBranch || 'master',
                candidateRef: prep?.candidateRef || candidateRefFor(runId),
                baseCommit: prep?.baseCommit || '',
            };
            // C5：授权只来自控制面派发载荷；执行器 context 未下发即为未授权。
            const contractRunApproved = context?.contractRunApproved === true;
            const approvedPaths = Array.isArray(context?.approvedPaths)
                ? context.approvedPaths
                : [];

            // 评审 §1.1：`.git` 被动过就地终止，先于删除标记与暂存——后面每一步
            // （add/commit/npm ci/验证）都是「在这台机器上执行东西」，而门禁看不见
            // `.git` 里的任何改动。这里是唯一能把它变成一次可见失败的地方。
            const tampered = prep?.gitMetadata
                ? diffGitMetadata(
                      prep.gitMetadata,
                      await snapshotGitMetadata({ workspaceDir, git, fsImpl })
                  )
                : [];
            if (tampered.length) {
                log(`[executor] .git metadata changed during turn: ${tampered.join(', ')}`);
                return {
                    outcome: 'failed',
                    errorCode: 'security_policy_violation',
                    summary: `交付被安全策略阻断：本轮 turn 改动了 .git 元数据（${tampered.slice(0, 8).join('、')}）——这类改动不进 diff、清不掉、跨 Run 存活。`,
                    failurePayload: {
                        violations: tampered.slice(0, 20).map((entry) => ({
                            code: 'GIT_METADATA_TAMPERED',
                            file: entry,
                        })),
                        verification: skippedReport(context),
                    },
                };
            }

            // SCN-FWB-041：删除标记先于暂存兑现，删除以普通 diff 身份走完整门禁与验证。
            await applyDeleteMarkers();

            const staged = await collectCandidateChanges({ baseCommit: identity.baseCommit, git });
            if (!staged.changedFiles.length) {
                return {
                    outcome: 'failed',
                    errorCode: 'no_changes_produced',
                    summary: 'Write-capable run finished its turn without changing any file.',
                    failurePayload: { verification: skippedReport(context) },
                };
            }

            // 步骤一：diff gate 预检（continueOnError：失败跳过验证，不挂掉 Run）。
            const stagedScnId = scnIdFromDiff(staged.diffText);
            const precheck = evaluateDiffGate({
                changedFiles: staged.changedFiles,
                diffText: staged.diffText,
                approvedPaths,
                contractRunApproved,
                scnId: stagedScnId,
                writeAllowed: true,
            });
            if (!precheck.allowed) {
                const manifest = buildDiffManifest({
                    ...identity,
                    changeCommit: '',
                    changedFiles: staged.changedFiles,
                    contractRunApproved,
                    scnId: stagedScnId,
                    gate: precheck,
                });
                return {
                    outcome: 'failed',
                    errorCode: 'security_policy_violation',
                    summary: '交付被质量门禁预检阻断：变更触及未批准路径或削弱了验证。',
                    failurePayload: {
                        diffManifest: manifest,
                        violations: precheck.violations,
                        verification: skippedReport(context),
                    },
                };
            }

            // 提交先于验证：把被验证的状态钉在一个 commit 上，权威门禁与
            // changeCommit 才有共同的、不可再变的对象。
            const { changeCommit } = await commitCandidate({ runId, git });

            // 依赖就绪：node_modules 缺席或依赖清单被本次变更改动时 npm ci。
            const dependencyFilesChanged = staged.changedFiles.some((file) =>
                ['package.json', 'package-lock.json'].includes(file)
            );
            if (!fsImpl.existsSync(join(workspaceDir, 'node_modules')) || dependencyFilesChanged) {
                log('[executor] installing workspace dependencies (npm ci)');
                const install = await runCommandImpl({
                    command: 'npm ci',
                    cwd: workspaceDir,
                    env: childEnv,
                    log,
                });
                if (!install.ok) {
                    return {
                        outcome: 'failed',
                        errorCode: 'executor_workspace_setup_failed',
                        summary: `npm ci failed in the candidate workspace: ${install.output.slice(-500)}`,
                        failurePayload: { verification: skippedReport(context) },
                    };
                }
            }

            // 步骤二～四：定向测试 → 构建 → 浏览器验证（执行器跑，Agent 无命令通道）。
            // CI=1 是必须的：本仓 playwright 配置 `reuseExistingServer: !CI`，开发机上
            // 常年有主仓的 vite 占着 e2e 端口——不设 CI 它会复用那个服务器，去验证
            // **主仓工作树**的代码而不是候选提交（e2e-hmr-stale-server 同款陷阱）。
            // 设了 CI 它自起服务器：端口被占就诚实失败，绝不产出假验证。
            const verificationEnv = { ...childEnv, CI: '1' };
            const verification = await runVerification({
                policy: context?.policy,
                commands: context?.commands ?? {},
                cwd: workspaceDir,
                env: verificationEnv,
                emitPhase,
                log,
            });

            // 步骤五：权威门禁——重读提交后的 base..HEAD，预检结果不参与。
            const committed = await committedCandidateDiff({
                baseCommit: identity.baseCommit,
                git,
            });
            const scnId = scnIdFromDiff(committed.diffText);
            const gate = evaluateDiffGate({
                changedFiles: committed.changedFiles,
                diffText: committed.diffText,
                approvedPaths,
                contractRunApproved,
                scnId,
                writeAllowed: true,
            });
            const manifest = buildDiffManifest({
                ...identity,
                changeCommit,
                changedFiles: committed.changedFiles,
                contractRunApproved,
                scnId,
                gate,
            });
            const report = {
                ...verification.report,
                visualEvidence: {
                    required: gate.visualEvidenceRequired === true,
                    present: await evidenceProducedThisRun(),
                },
            };

            if (!gate.allowed) {
                return {
                    outcome: 'failed',
                    errorCode: 'security_policy_violation',
                    summary: '交付被权威门禁阻断：提交后的变更触及未批准路径或削弱了验证。',
                    failurePayload: {
                        diffManifest: manifest,
                        violations: gate.violations,
                        verification: report,
                    },
                };
            }
            if (!verification.passed) {
                return {
                    outcome: 'failed',
                    errorCode: 'verification_failed',
                    summary: `Verification step failed: ${failedStepLabel[verification.failedStep] || verification.failedStep}.\n${String(verification.failureOutput || '').slice(-1500)}`,
                    failurePayload: { diffManifest: manifest, verification: report },
                };
            }
            if (report.visualEvidence.required && !report.visualEvidence.present) {
                // GitHub 路径同款口径：要求视觉证据而没有，就不是一次成功交付。
                return {
                    outcome: 'failed',
                    errorCode: 'verification_failed',
                    summary:
                        'Visual evidence is required for this change set but none was produced.',
                    failurePayload: { diffManifest: manifest, verification: report },
                };
            }

            return {
                outcome: 'completed',
                completionPayload: {
                    diffManifest: manifest,
                    verification: report,
                    approvedPaths,
                    contractRunApproved,
                    scnId,
                },
            };
        },
    };
}
