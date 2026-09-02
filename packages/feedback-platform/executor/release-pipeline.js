/**
 * 执行器交付管线（SCN-FWB-033 阶段二）：认领 Release → 实时 fetch 基线 → 集成
 * （fast-forward 或 cherry-pick 重放）→ 集成验证 → push origin 默认分支 →
 * 按面部署（pages/worker）→ 生产冒烟 → `release.completed`。
 *
 * 事件序列与 payload 形状照 GitHub 交付线（feedback-delivery.yml）：每个 payload
 * 带身份回显（`integration.started` 被服务端逐字段核验）、验证与完成事件必须带
 * `passed`、部署证据的 `deployedCommit` 恒等于集成提交（差一个就被
 * FEEDBACK_DEPLOYED_COMMIT_MISMATCH 拒收）。
 *
 * 三个已定决策（见 tests/scenarios/feedback-workbench.md 2026-08-22）：
 * - integration base 实时 fetch `origin/<defaultBranch>`——本地主仓 ref 可能落后，
 *   拿它当 base 会把已发布的改动踢出下一次部署；
 * - 「merged」= 真实 push origin（工作站凭据，2026-08-22 实测可推）；push 被拒报
 *   `default_branch_drift`（服务端视为可恢复失败，Release 状态不动，下轮重领）；
 * - cherry-pick 冲突报 `review_required`（服务端产生 HumanAction）。
 */
import { existsSync as fsExistsSync } from 'node:fs';
import { join } from 'node:path';
import { gitArgsWithIsolatedCredentials, sameGitRemote } from './admission.js';
import { createGitRunner, sanitizeCandidateRunId } from './candidate.js';
import { runCommand, runVerificationSteps } from './verification.js';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/**
 * 从 wrangler 输出解析部署 id。worker：`wrangler deploy` 打印 Current Version ID；
 * pages：deploy 后用 `wrangler pages deployment list` 找到 UUID。Worker 侧的完成
 * 核验强制 UUID 形态——短 hash、URL 前缀都不合格。
 */
export function extractDeploymentId(output) {
    const match = String(output || '').match(UUID_PATTERN);
    return match ? match[0] : '';
}

function smokeAssertionFor(path, status) {
    if (status >= 200 && status < 300) return 'status_2xx';
    if (path === '/api/feedback/issues' && (status === 401 || status === 403)) {
        return 'protected_auth_required';
    }
    return 'unexpected_status';
}

export function createReleasePipeline({
    workspaceDir,
    childEnv,
    // S2（评审 §1.2）：`{ mode: 'inherited'|'isolated', remoteUrl, pat }`，由 admission
    // 产出。isolated 时凭据经 `http.extraheader` 注入且全局 helper 被禁用；inherited
    // 时沿用开发机凭据——那种情况下 S2 不成立，交付日志里必须直说。
    credentials = { mode: 'inherited', remoteUrl: '', pat: '' },
    log = () => {},
    gitFactory = createGitRunner,
    runVerification = runVerificationSteps,
    runCommandImpl = runCommand,
    fsImpl = { existsSync: fsExistsSync },
    fetchImpl = fetch,
} = {}) {
    if (!workspaceDir) throw new Error('EXECUTOR_RELEASE_PIPELINE_WORKSPACE_REQUIRED');
    const isolatedCredentials = credentials?.mode === 'isolated';
    const git = gitFactory({
        cwd: workspaceDir,
        // S3：git 与验证子进程同一套白名单环境，不继承控制面 token 与 PAT。
        env: childEnv,
        credentialArgs: isolatedCredentials
            ? gitArgsWithIsolatedCredentials([], { pat: credentials?.pat || '' })
            : [],
    });

    async function resolveDeploymentId({ target, deployConfig, deployOutput }) {
        const direct = extractDeploymentId(deployOutput);
        if (target === 'worker' && direct) return direct;
        // pages：deploy 输出通常只有短 hash URL，查部署列表拿 UUID。
        const listed = await runCommandImpl({
            command: `npx wrangler pages deployment list --project-name ${deployConfig?.pagesProject || ''}`,
            cwd: workspaceDir,
            env: childEnv,
            timeoutMs: 120000,
            log,
        });
        return extractDeploymentId(listed.output) || direct;
    }

    return {
        /**
         * 交付一个已认领的 Release。返回 {outcome, errorCode?}；事件上报失败或
         * git 故障抛出，由守护循环兜住（Release 状态留在原地，下轮重领续跑）。
         */
        async deliver({ claim, controlPlane, resolveDeploymentIdImpl = resolveDeploymentId }) {
            const { releaseId, releaseToken, leaseEpoch, payload, deployConfig } = claim;
            const identity = {
                candidateId: payload.candidateId,
                repository: payload.repository,
                baseRef: payload.baseRef,
                baseCommit: payload.baseCommit,
                candidateRef: payload.candidateRef,
                changeCommit: payload.changeCommit,
                diffManifestSha256: payload.diffManifestSha256,
                deploymentRequired: payload.deploymentRequired,
                deploymentTarget: payload.deploymentTarget ?? '',
            };
            let sequence = 0;
            const post = (type, extra = {}) => {
                sequence += 1;
                return controlPlane.postReleaseEvent({
                    releaseId,
                    releaseToken,
                    // 租约凭证（评审 §3.2）：租约易主后本进程的每一条上报都会 409，
                    // 这正是「交付到一半被顶掉」时必须停手的信号。
                    leaseEpoch,
                    event: {
                        type,
                        // 决定性 id：同一 Release 重领后重放同一序列会被幂等去重。
                        eventId: `executor-${sequence}-${type}`,
                        payload: { ...identity, ...extra },
                    },
                });
            };
            const fail = async (errorCode, summary, extra = {}) => {
                await post('release.failed', {
                    errorCode,
                    passed: false,
                    summary: String(summary || '').slice(0, 1000),
                    ...extra,
                });
                return { outcome: 'failed', errorCode };
            };

            // S2（评审 §1.2）：isolated 模式下，被准入校验过的那个 remote 必须就是
            // git 真正会去认证的那个。origin 指向别处时，「校验了 HTTPS + 专用 PAT」
            // 与「推到哪里」是两件不相干的事——这正是接线断裂的定义。
            if (isolatedCredentials) {
                let originUrl = '';
                try {
                    originUrl = (await git('remote', 'get-url', 'origin')).stdout.trim();
                } catch (error) {
                    return fail(
                        'blocked_external',
                        `Cannot read the workspace origin URL: ${String(error?.message || error).slice(0, 200)}`
                    );
                }
                if (!sameGitRemote(originUrl, credentials?.remoteUrl)) {
                    return fail(
                        'blocked_external',
                        `Workspace origin (${originUrl}) is not the admitted FEEDBACK_EXECUTOR_REMOTE — the validated remote and the push target must be the same repository.`
                    );
                }
            } else {
                // 不成立的防线必须自己说出来，否则「准入校验过 PAT」会被读成「推送用的是 PAT」。
                log(
                    `[executor] release ${releaseId}: S2 credential isolation is OFF (inherited mode) — push/fetch use this machine's git credentials`
                );
            }

            // 清场 + 实时基线。
            await git('reset', '--hard');
            await git('clean', '-fd', '-e', 'node_modules');
            await git('fetch', 'origin', payload.baseRef);
            const originHead = (await git('rev-parse', `origin/${payload.baseRef}`)).stdout.trim();

            // 候选提交必须在对象库里（同机产出的候选一定在；不在说明工作区被换过）。
            try {
                await git('cat-file', '-e', `${payload.changeCommit}^{commit}`);
            } catch {
                return fail(
                    'candidate_commit_missing',
                    `Candidate commit ${payload.changeCommit} is not present in the workspace object store.`
                );
            }

            await post('integration.started');

            // 集成：base 未动用候选提交本身；动了则 cherry-pick 重放。
            const releaseBranch = `feedback/release/${sanitizeCandidateRunId(releaseId)}`;
            let integrationCommit;
            if (originHead === payload.baseCommit) {
                integrationCommit = payload.changeCommit;
                await git('checkout', '-B', releaseBranch, integrationCommit);
            } else {
                await git('checkout', '-B', releaseBranch, originHead);
                try {
                    await git('cherry-pick', payload.changeCommit);
                } catch (error) {
                    try {
                        await git('cherry-pick', '--abort');
                    } catch {
                        // 没有进行中的 cherry-pick 时 abort 会失败，忽略。
                    }
                    return fail(
                        'review_required',
                        `Candidate does not replay cleanly onto ${payload.baseRef}@${originHead.slice(0, 12)}: ${String(error?.message || error).slice(0, 300)}`
                    );
                }
                integrationCommit = (await git('rev-parse', 'HEAD')).stdout.trim();
            }
            await post('integration.rebased', {
                integrationCommit,
                strategy: originHead === payload.baseCommit ? 'fast_forward' : 'rebase',
            });

            // 依赖就绪（与写入管线同一判定）。
            const dependencyFilesChanged = (payload.changedFiles || []).some((file) =>
                ['package.json', 'package-lock.json'].includes(file)
            );
            if (!fsImpl.existsSync(join(workspaceDir, 'node_modules')) || dependencyFilesChanged) {
                const install = await runCommandImpl({
                    command: 'npm ci',
                    cwd: workspaceDir,
                    env: childEnv,
                    log,
                });
                if (!install.ok) {
                    return fail(
                        'executor_workspace_setup_failed',
                        `npm ci failed: ${install.output.slice(-500)}`
                    );
                }
            }

            // 集成验证：test + build（GitHub 交付线同款——交付不重跑 e2e，候选期已跑过）。
            // CI=1 同写入管线：拒绝复用开发机 vite。
            const verification = await runVerification({
                policy: 'implement',
                commands: claim.commands ?? {},
                cwd: workspaceDir,
                env: { ...childEnv, CI: '1' },
                log,
            });
            await post('integration.verification_completed', {
                passed: verification.passed === true,
                integrationCommit,
                report: verification.report,
            });
            if (!verification.passed) {
                return fail(
                    'integration_verification_failed',
                    `Integration verification failed at ${verification.failedStep}.\n${String(verification.failureOutput || '').slice(-800)}`,
                    { integrationCommit }
                );
            }

            // merged = 真实 push。被拒即基线漂移：可恢复失败，服务端状态不动，下轮重领。
            try {
                await git('push', 'origin', `${integrationCommit}:refs/heads/${payload.baseRef}`);
            } catch (error) {
                return fail(
                    'default_branch_drift',
                    `Push to origin/${payload.baseRef} was rejected: ${String(error?.message || error).slice(0, 300)}`,
                    { integrationCommit }
                );
            }
            await post('integration.merged', { integrationCommit });

            if (identity.deploymentRequired) {
                await post('deployment.started', { integrationCommit });
                const target = identity.deploymentTarget;
                const deployCommand =
                    target === 'worker'
                        ? 'npx wrangler deploy'
                        : `npx wrangler pages deploy dist --project-name ${deployConfig?.pagesProject || ''} --branch ${payload.baseRef} --commit-hash ${integrationCommit}`;
                log(`[executor] release ${releaseId}: deploying (${target})`);
                const deploy = await runCommandImpl({
                    command: deployCommand,
                    cwd: workspaceDir,
                    env: childEnv,
                    log,
                });
                if (!deploy.ok) {
                    return fail(
                        'deployment_failed',
                        `Deploy failed: ${deploy.output.slice(-800)}`,
                        {
                            integrationCommit,
                        }
                    );
                }
                const deploymentId = await resolveDeploymentIdImpl({
                    target,
                    deployConfig,
                    deployOutput: deploy.output,
                });
                if (!UUID_PATTERN.test(deploymentId)) {
                    return fail(
                        'deployment_failed',
                        'Deployment id could not be resolved to a Cloudflare UUID — completion evidence would be rejected.',
                        { integrationCommit }
                    );
                }
                await post('deployment.completed', {
                    integrationCommit,
                    deployedCommit: integrationCommit,
                    deploymentTarget: target,
                    deploymentId,
                });

                // 生产冒烟：逐路径断言，形状与 Worker 的 verifyFeedbackSmokeChecks 对齐。
                const checks = [];
                for (const path of payload.smokeUrls || []) {
                    let status = 0;
                    try {
                        const response = await fetchImpl(`${payload.productionOrigin}${path}`, {
                            method: 'GET',
                        });
                        status = Number(response.status) || 0;
                    } catch {
                        status = 0;
                    }
                    checks.push({ path, status, assertion: smokeAssertionFor(path, status) });
                }
                const smokePassed =
                    checks.length === (payload.smokeUrls || []).length &&
                    checks.every((check) => check.assertion !== 'unexpected_status');
                await post('smoke.completed', {
                    integrationCommit,
                    deployedCommit: integrationCommit,
                    deploymentTarget: target,
                    deploymentId,
                    passed: smokePassed,
                    checks,
                });
                if (!smokePassed) {
                    return fail('smoke_failed', 'Production smoke checks failed.', {
                        integrationCommit,
                    });
                }
            }

            await post('release.completed', { integrationCommit, passed: true });
            return { outcome: 'completed', integrationCommit };
        },
    };
}
