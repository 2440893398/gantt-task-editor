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
import { existsSync as fsExistsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateDiffGate, scnIdFromDiff } from '../../../src/features/feedback/diff-gate.js';
import { FEEDBACK_EVIDENCE_DIR } from '../../../src/features/feedback/feedback-prompt.js';
import {
    candidateRefFor,
    collectCandidateChanges,
    commitCandidate,
    committedCandidateDiff,
    createGitRunner,
    prepareCandidateWorkspace,
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

export function createWritePipeline({
    workspaceDir,
    childEnv,
    log = () => {},
    gitFactory = createGitRunner,
    runVerification = runVerificationSteps,
    runCommandImpl = runCommand,
    fsImpl = { existsSync: fsExistsSync },
} = {}) {
    if (!workspaceDir) throw new Error('EXECUTOR_WRITE_PIPELINE_WORKSPACE_REQUIRED');
    const git = gitFactory({ cwd: workspaceDir });

    /**
     * 「本轮产出了视觉证据」= evidence 目录里有 git 之外的新 png（e2e 刚写下的
     * 未跟踪文件）。不能用「目录里有 png」判定——2026-08-22 真机实测该目录躺着
     * 仓库提交过的历史截图，existsSync 判 present=true 而本轮一张图都没产出，
     * 要求视觉证据的 UI 类变更会被它假放行（C3：证据必须是本次验证专用）。
     */
    async function evidenceProducedThisRun() {
        try {
            const status = (await git('status', '--porcelain', '--', FEEDBACK_EVIDENCE_DIR)).stdout;
            return status
                .split(/\r?\n/)
                .some((line) => line.trim() && line.trim().toLowerCase().endsWith('.png'));
        } catch {
            return false;
        }
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
                return await prepareCandidateWorkspace({
                    runId,
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
