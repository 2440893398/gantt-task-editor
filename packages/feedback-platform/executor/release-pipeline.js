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
 * 拼进 shell 命令的标识符必须先过字符集（代码评审 2026-09-02 §1.7）。
 *
 * 部署命令是 `shell: true` 下的字符串拼接，插进去的 `pagesProject`/`baseRef`/
 * `integrationCommit` 全部来自控制面数据。信任模型是「控制面受信」，但那是一层
 * **假设**而不是一道防线：Worker 被攻破或 D1 被注入的那一刻，它等价于开发机上的
 * 任意命令执行。字符集断言把这条链掐断在执行器侧——一个分号或反引号根本走不到
 * shell 面前。
 *
 * 注意与 `commands_json` 的区别：那些**本来就是**项目配置的 shell 命令
 * （`npm test` 之类），按设计可以是任意命令行，不适用这道闸；这里管的是被拼进
 * 命令的**标识符**。
 */
const SHELL_SAFE_TOKEN = /^[A-Za-z0-9._/@-]+$/;

export function assertShellSafeToken(name, value) {
    const token = String(value ?? '');
    if (!token || !SHELL_SAFE_TOKEN.test(token)) {
        const error = new Error(
            `EXECUTOR_UNSAFE_SHELL_TOKEN: ${name} contains characters that must never reach a shell`
        );
        error.code = 'EXECUTOR_UNSAFE_SHELL_TOKEN';
        error.field = name;
        throw error;
    }
    return token;
}

/**
 * 从 wrangler 输出解析部署 id。worker：`wrangler deploy` 打印 Current Version ID；
 * pages：deploy 后用 `wrangler pages deployment list` 找到 UUID。Worker 侧的完成
 * 核验强制 UUID 形态——短 hash、URL 前缀都不合格。
 */
export function extractDeploymentId(output) {
    const match = String(output || '').match(UUID_PATTERN);
    return match ? match[0] : '';
}

/**
 * 生产事故 2026-09-03：坏部署把 Pages 换成纯静态站后，`/` 与 `/feedback` 依旧
 * 200——SPA 静态兜底对任意路径都回首页 HTML，只看状态码的冒烟因此全绿放行，
 * 而 `/feedback` 工作台和全部 `/api/*` 实际已经不由 Worker 回答了。所以 API 路径
 * 的判据必须落在响应体裁上：JSON 才算「Functions 仍在接管」。
 */
function smokeAssertionFor(path, status, contentType = '') {
    const isApi = path.startsWith('/api/');
    if (isApi && (status === 401 || status === 403)) {
        return 'protected_auth_required';
    }
    if (status >= 200 && status < 300) {
        if (isApi && !String(contentType).toLowerCase().includes('json')) {
            return 'unexpected_content_type';
        }
        return 'status_2xx';
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
        const pagesProject = assertShellSafeToken(
            'deployConfig.pagesProject',
            deployConfig?.pagesProject
        );
        const listed = await runCommandImpl({
            command: `npx wrangler pages deployment list --project-name ${pagesProject}`,
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
                        // 决定性 id：同一 Release 重领后重放**同一条**序列会被幂等去重。
                        // 掺进 leaseEpoch（评审 §3.9）：重领意味着新 epoch，而重跑携带的
                        // 事实可能与上一轮不同（典型：push 成功 deploy 失败后重跑，
                        // integrationCommit 走的是另一条路径算出来的）。同 eventId 会让
                        // 服务端把**带着新事实的事件**当重放丢掉，时间线于是停在旧事实上。
                        eventId: `executor-e${leaseEpoch ?? 0}-${sequence}-${type}`,
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

            // 集成：base 未动用候选提交本身（它已经带着整条链）；动了则把整条链
            // `base..change` 重放到新头上。两条路带入的改动集合必须相同——差别只在
            // 「要不要重放」，不在「重放多少」。
            const releaseBranch = `feedback/release/${sanitizeCandidateRunId(releaseId)}`;
            let integrationCommit;
            // 代码评审 2026-09-02 §3.9：**先看这次交付是不是已经推上去了**。
            // 「push 成功但 deploy 失败」之后重领，originHead 已经不等于 baseCommit，
            // 于是走 cherry-pick 分支——而那个提交已经在 origin 的历史里，
            // cherry-pick 会以「空提交」报错，被判成 `review_required`：一次本该
            // 只重跑部署的恢复，变成了一张「候选无法安全集成」的人工卡。
            let alreadyMerged = false;
            try {
                await git('merge-base', '--is-ancestor', payload.changeCommit, originHead);
                alreadyMerged = true;
            } catch {
                // 非零退出 = 不是祖先，正常走下面的集成。
            }
            if (alreadyMerged) {
                integrationCommit = payload.changeCommit;
                log(
                    `[executor] release ${releaseId}: candidate ${integrationCommit.slice(0, 12)} is already on origin/${payload.baseRef}; skipping integration and resuming at deployment`
                );
                await git('checkout', '-B', releaseBranch, integrationCommit);
            } else if (originHead === payload.baseCommit) {
                integrationCommit = payload.changeCommit;
                await git('checkout', '-B', releaseBranch, integrationCommit);
            } else {
                await git('checkout', '-B', releaseBranch, originHead);
                try {
                    // SCN-FWB-023：重放的是**整条链**（`base..change`），不是链尾一个提交。
                    //
                    // 候选经 SCN-FWB-040 恢复过就是多提交的，而 `baseCommit` 取的是链基线
                    // （merge-base，见 candidate.js 的说明——授权范围要从 base..HEAD 全量
                    // 推导）。对链尾单提交做 cherry-pick 有两种错法，都发生过：
                    //   1. 链尾是恢复轮的 `--allow-empty` 标记提交 → git 以「now empty」
                    //      退出 1 → 被兜成 `review_required`，报一个根本不存在的冲突。
                    //      生产实录 #czi9c6 2026-09-03。
                    //   2. 链尾非空 → 只带入末轮增量，前几轮改动静默丢失，交付出去的
                    //      比管理员在候选上审过的少。这一种没报过错，因为它不报错。
                    //
                    // `--allow-empty` 收下本来就空的提交（形态 1），
                    // `--keep-redundant-commits` 收下重放后变空的提交（改动已在 master 上，
                    // 典型是两条候选改了同一处）。少任一个都会让一条无害的链中途退出 1。
                    await git(
                        'cherry-pick',
                        '--allow-empty',
                        '--keep-redundant-commits',
                        `${payload.baseCommit}..${payload.changeCommit}`
                    );
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
                strategy: alreadyMerged
                    ? 'already_merged'
                    : originHead === payload.baseCommit
                      ? 'fast_forward'
                      : 'rebase',
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
            // 已合入的候选**不 push**：它本来就在 origin 历史里，而 origin 若又前进了，
            // push 祖先提交会被 non-fast-forward 拒绝——「已合入 → push 被拒 →
            // default_branch_drift 放租约 → 重领又判已合入」是一个每轮烧完整验证、
            // 永不终态的死循环。
            if (!alreadyMerged) {
                try {
                    await git(
                        'push',
                        'origin',
                        `${integrationCommit}:refs/heads/${payload.baseRef}`
                    );
                } catch (error) {
                    return fail(
                        'default_branch_drift',
                        `Push to origin/${payload.baseRef} was rejected: ${String(error?.message || error).slice(0, 300)}`,
                        { integrationCommit }
                    );
                }
            }
            await post('integration.merged', { integrationCommit });

            if (identity.deploymentRequired) {
                await post('deployment.started', { integrationCommit });
                const target = identity.deploymentTarget;
                let deployCommand;
                let pagesBuildCommand = '';
                try {
                    if (target === 'worker') {
                        deployCommand = 'npx wrangler deploy';
                    } else {
                        // 产物目录是项目数据，绝不回落默认值。写死 `dist` 的那版把本仓
                        // Pages 换成了国际版静态站：`_worker.js` 消失，/feedback 与全部
                        // /api/* 落到 SPA 静态兜底，首页从 vendored dhtmlx 改引 CDN
                        // （生产事故 2026-09-03）。配置没说部署什么，就停下来问人。
                        const pagesProject = assertShellSafeToken(
                            'deployConfig.pagesProject',
                            deployConfig?.pagesProject
                        );
                        const outputDir = assertShellSafeToken(
                            'deployConfig.pagesOutputDir',
                            deployConfig?.pagesOutputDir
                        );
                        // 部署前按项目命令重建产物：跑的是 CN 构建还是国际构建，同样是
                        // 项目数据。缺省则沿用集成验证阶段已经产出的产物。
                        pagesBuildCommand = String(deployConfig?.pagesBuildCommand || '').trim();
                        deployCommand = `npx wrangler pages deploy ${outputDir} --project-name ${pagesProject} --branch ${assertShellSafeToken(
                            'payload.baseRef',
                            payload.baseRef
                        )} --commit-hash ${assertShellSafeToken(
                            'integrationCommit',
                            integrationCommit
                        )}`;
                    }
                } catch (error) {
                    // §1.7：拼不安全的东西进 shell 之前先停。这属于外部配置问题，
                    // 走 blocked_external——它会立卡请人修，而不是把 Release 判死。
                    return fail(
                        'blocked_external',
                        `Refusing to build a deploy command: ${error.message}`,
                        { integrationCommit }
                    );
                }
                if (pagesBuildCommand) {
                    log(`[executor] release ${releaseId}: building pages artifact`);
                    const build = await runCommandImpl({
                        command: pagesBuildCommand,
                        cwd: workspaceDir,
                        env: childEnv,
                        log,
                    });
                    if (!build.ok) {
                        return fail(
                            'deployment_failed',
                            `Pages build failed: ${build.output.slice(-800)}`,
                            { integrationCommit }
                        );
                    }
                }
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
                    let contentType = '';
                    try {
                        const response = await fetchImpl(`${payload.productionOrigin}${path}`, {
                            method: 'GET',
                        });
                        status = Number(response.status) || 0;
                        contentType = String(response.headers?.get?.('content-type') || '');
                    } catch {
                        status = 0;
                    }
                    checks.push({
                        path,
                        status,
                        assertion: smokeAssertionFor(path, status, contentType),
                    });
                }
                // 白名单而不是黑名单：新增一种失败断言时，忘记同步这里会让它静默通过
                // ——`unexpected_content_type` 第一次落地时就正是这么漏的。
                const smokePassed =
                    checks.length === (payload.smokeUrls || []).length &&
                    checks.every((check) =>
                        ['status_2xx', 'protected_auth_required'].includes(check.assertion)
                    );
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
