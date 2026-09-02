/**
 * [SCN-FWB-035] S1～S3 准入守卫——机械执行，不靠 prompt。
 *
 * 坏行为画像：没有这些守卫时，执行器可以把主工作区当工作区（Agent 撞上未提交改动）、
 * 用开发者的 SSH key 推分支（凭据外溢）、读走 `.dev.vars` 和浏览器 profile（密钥外泄）。
 * EXC-FWB-005 拍板的是「不容器化」，没有拍板「不设防」。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    admitExecutor,
    assertDedicatedCredentials,
    assertIndependentWorkspace,
    buildChildEnv,
    evaluateReadAccess,
    gitArgsWithIsolatedCredentials,
    PRIMARY_WORKTREE_ROOT,
    resolveGitCredentialMode,
    sameGitRemote,
} from '../executor/admission.js';

const cleanups = [];
function makeClone() {
    const dir = mkdtempSync(join(tmpdir(), 'executor-ws-'));
    mkdirSync(join(dir, '.git'));
    cleanups.push(dir);
    return dir;
}

afterEach(() => {
    while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});

describe('[SCN-FWB-035] S1 独立 checkout', () => {
    it('主工作区被拒绝——包括它的子目录与父目录', () => {
        expect(() => assertIndependentWorkspace(PRIMARY_WORKTREE_ROOT)).toThrow(
            'EXECUTOR_WORKSPACE_IS_PRIMARY'
        );
        expect(() => assertIndependentWorkspace(join(PRIMARY_WORKTREE_ROOT, 'packages'))).toThrow(
            /EXECUTOR_WORKSPACE/
        );
        expect(() => assertIndependentWorkspace(join(PRIMARY_WORKTREE_ROOT, '..'))).toThrow(
            /EXECUTOR_WORKSPACE/
        );
    });

    it('独立克隆通过；空目录（不是克隆）与不存在的路径被拒绝', () => {
        const clone = makeClone();
        expect(assertIndependentWorkspace(clone)).toBeTruthy();

        const empty = mkdtempSync(join(tmpdir(), 'executor-empty-'));
        cleanups.push(empty);
        expect(() => assertIndependentWorkspace(empty)).toThrow('EXECUTOR_WORKSPACE_NOT_A_CLONE');
        expect(() => assertIndependentWorkspace(join(empty, 'missing'))).toThrow(
            'EXECUTOR_WORKSPACE_MISSING'
        );
    });
});

describe('[SCN-FWB-035] S2 专用凭据', () => {
    it('SSH remote 被拒绝——那会落到开发者的 SSH agent 上', () => {
        expect(() =>
            assertDedicatedCredentials({ remoteUrl: 'git@github.com:a/b.git', pat: 'x' })
        ).toThrow('EXECUTOR_REMOTE_NOT_HTTPS');
        expect(() =>
            assertDedicatedCredentials({ remoteUrl: 'ssh://github.com/a/b', pat: 'x' })
        ).toThrow('EXECUTOR_REMOTE_NOT_HTTPS');
    });

    it('PAT 必须显式注入，私钥内容不当 PAT 用', () => {
        expect(() =>
            assertDedicatedCredentials({ remoteUrl: 'https://github.com/a/b', pat: '' })
        ).toThrow('EXECUTOR_GIT_PAT_REQUIRED');
        expect(() =>
            assertDedicatedCredentials({
                remoteUrl: 'https://github.com/a/b',
                pat: '-----BEGIN OPENSSH PRIVATE KEY-----',
            })
        ).toThrow('EXECUTOR_GIT_PAT_IS_PRIVATE_KEY');
    });

    it('git 调用显式清空 credential helper 与 sshCommand', () => {
        const args = gitArgsWithIsolatedCredentials(['fetch', 'origin'], { pat: 'tok' });
        expect(args).toContain('credential.helper=');
        expect(args).toContain('core.sshCommand=false');
        expect(args.join(' ')).toContain('http.extraheader=Authorization: Basic ');
        // PAT 原文不出现在命令行参数里
        expect(args.join(' ')).not.toContain('tok');
    });
});

describe('[SCN-FWB-035] S3 读取拒绝清单与环境白名单', () => {
    const workspace = () => makeClone();

    it('拒读 .dev.vars 与 .env*，无论它在哪个目录', () => {
        const ws = workspace();
        writeFileSync(join(ws, '.dev.vars'), 'SECRET=1');
        expect(evaluateReadAccess(join(ws, '.dev.vars'), { workspaceDir: ws }).allowed).toBe(false);
        expect(evaluateReadAccess('.env.production', { workspaceDir: ws }).allowed).toBe(false);
        expect(evaluateReadAccess(join(ws, 'src', 'app.js'), { workspaceDir: ws }).allowed).toBe(
            true
        );
    });

    it('拒读 ~/.ssh、~/.aws 与浏览器 profile', () => {
        const ws = workspace();
        const home = mkdtempSync(join(tmpdir(), 'executor-home-'));
        cleanups.push(home);
        for (const denied of [
            join(home, '.ssh', 'id_ed25519'),
            join(home, '.aws', 'credentials'),
            join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Cookies'),
        ]) {
            expect(evaluateReadAccess(denied, { workspaceDir: ws, home }), denied).toEqual(
                expect.objectContaining({ allowed: false })
            );
        }
    });

    it('越出工作区的读取默认拒绝', () => {
        const ws = workspace();
        const outside = mkdtempSync(join(tmpdir(), 'executor-outside-'));
        cleanups.push(outside);
        expect(evaluateReadAccess(join(outside, 'notes.txt'), { workspaceDir: ws })).toEqual(
            expect.objectContaining({ allowed: false, reason: 'EXECUTOR_READ_OUTSIDE_WORKSPACE' })
        );
    });

    it('子进程环境只继承白名单——token 与开发者密钥不进 Agent 进程', () => {
        const child = buildChildEnv({
            PATH: 'C:\\bin',
            USERPROFILE: 'C:\\Users\\dev',
            FEEDBACK_EXECUTOR_TOKEN: 'secret-bearer',
            FEEDBACK_EXECUTOR_GIT_PAT: 'github_pat_x',
            GITHUB_TOKEN: 'ghp_dev',
            AWS_SECRET_ACCESS_KEY: 'aws',
            OPENAI_API_KEY: 'sk-x',
        });
        expect(child.PATH).toBe('C:\\bin');
        expect(child.USERPROFILE).toBe('C:\\Users\\dev');
        for (const leaked of [
            'FEEDBACK_EXECUTOR_TOKEN',
            'FEEDBACK_EXECUTOR_GIT_PAT',
            'GITHUB_TOKEN',
            'AWS_SECRET_ACCESS_KEY',
            'OPENAI_API_KEY',
        ]) {
            expect(child[leaked], leaked).toBeUndefined();
        }
    });

    it('强制 NO_COLOR——子进程输出会原样进时间线给人读', () => {
        // 2026-09-01 实测：vitest 在管道里（非 TTY）仍强制上色，`FORCE_COLOR=0`
        // 压不住、只有 `NO_COLOR=1` 有效。不关掉的话时间线里就是满屏 `[90m303|`。
        expect(buildChildEnv({ PATH: 'C:\\bin' }).NO_COLOR).toBe('1');

        // 但它是默认值不是铁律：extra 排在展开顺序后面，调用方仍能覆盖。
        expect(buildChildEnv({}, { extra: { NO_COLOR: '0' } }).NO_COLOR).toBe('0');
    });
});

describe('[SCN-FWB-035] S3 代理变量必须放行', () => {
    it('代理变量透传——剥掉它们，provider 直连出网被拒且报错伪装成未登录', () => {
        // 2026-08-21 真机实测：本机经本地代理出网。白名单剥掉 HTTPS_PROXY 后，
        // `claude -p` 的终态是 `403 Request not allowed` + `is_error: true`，
        // 读起来像凭据失效，会把排障引向反复重新登录——而凭据完好。
        // 安全白名单把功能打死、且报错指向错误方向，比不安全更贵。
        const child = buildChildEnv({
            PATH: 'C:\bin',
            HTTP_PROXY: 'http://127.0.0.1:10808',
            HTTPS_PROXY: 'http://127.0.0.1:10808',
            NO_PROXY: 'localhost,127.0.0.1',
            ALL_PROXY: 'socks5://127.0.0.1:10808',
            GITHUB_TOKEN: 'ghp_dev',
        });
        expect(child.HTTP_PROXY).toBe('http://127.0.0.1:10808');
        expect(child.HTTPS_PROXY).toBe('http://127.0.0.1:10808');
        expect(child.NO_PROXY).toBe('localhost,127.0.0.1');
        expect(child.ALL_PROXY).toBe('socks5://127.0.0.1:10808');
        // 放行代理不等于放行别的开发者变量。
        expect(child.GITHUB_TOKEN).toBeUndefined();
    });

    it('小写形态同样放行——POSIX 侧惯用 https_proxy', () => {
        const child = buildChildEnv({ https_proxy: 'http://127.0.0.1:10808' });
        expect(child.https_proxy).toBe('http://127.0.0.1:10808');
    });
});

describe('[SCN-FWB-035] 准入汇总入口', () => {
    it('三条全过才放行；控制面 token 缺席直接拒', () => {
        const clone = makeClone();
        expect(() => admitExecutor({ workspaceDir: clone, controlPlaneToken: '' })).toThrow(
            'EXECUTOR_CONTROL_PLANE_TOKEN_REQUIRED'
        );

        const admitted = admitExecutor({ workspaceDir: clone, controlPlaneToken: 'bearer' });
        expect(admitted.workspaceDir).toBeTruthy();

        // 声明了 remote 就必须同时给合规 PAT——没有中间态
        expect(() =>
            admitExecutor({
                workspaceDir: clone,
                controlPlaneToken: 'bearer',
                remoteUrl: 'https://github.com/a/b',
            })
        ).toThrow('EXECUTOR_GIT_PAT_REQUIRED');
    });
});

describe('[SCN-FWB-035] 工作区路径保留真实大小写', () => {
    it('返回的 workspaceDir 不被小写化——小写只许用于同一性比较', () => {
        // 2026-08-22 真机回合实测：admission 把小写化的比较用路径当返回值，成为
        // 全部子进程的 cwd。Windows 文件系统不在乎，但 vite 的 html-inline-proxy
        // 内部缓存键大小写敏感——candidate 构建以「No matching HTML proxy module」
        // 失败，报错里一行提到大小写的字都没有。npm ci 的 existsSync 判定同因误触发。
        const clone = makeClone();
        const mixed = clone.replace(/^([a-z]):/, (m, d) => `${d.toUpperCase()}:`);
        const admitted = assertIndependentWorkspace(mixed);
        expect(admitted).toBe(admitted.replace(/^([a-z]):/, (m, d) => `${d.toUpperCase()}:`));
        // 同一路径的大小写变体仍然被主工作区检查认出（比较仍是不区分大小写的）。
        expect(() =>
            assertIndependentWorkspace(
                PRIMARY_WORKTREE_ROOT.replace(/^([A-Za-z]):/, (m, d) => `${d.toLowerCase()}:`)
            )
        ).toThrow('EXECUTOR_WORKSPACE_IS_PRIMARY');
    });
});

describe('[SCN-FWB-035] S2 凭据模式必须是显式的（评审 §1.2）', () => {
    // 历史坏行为：准入强制校验 HTTPS remote + PAT，而 `gitArgsWithIsolatedCredentials`
    // 全仓没有生产调用点——push 走的是开发机凭据。校验过的 remote 与实际推送的
    // remote 甚至可以不同源。「安检在前门、货从后门进」比没有安检更糟：它让人以为
    // 隔离已生效。现在模式摆上台面，两条路都可执行、都可观测。
    it('缺省是 inherited；isolated 合法；未知值拒绝启动而不是静默回落', () => {
        expect(resolveGitCredentialMode({})).toBe('inherited');
        expect(resolveGitCredentialMode({ FEEDBACK_EXECUTOR_GIT_CREDENTIALS: 'isolated' })).toBe(
            'isolated'
        );
        expect(() =>
            resolveGitCredentialMode({ FEEDBACK_EXECUTOR_GIT_CREDENTIALS: 'islolated' })
        ).toThrow('EXECUTOR_UNKNOWN_GIT_CREDENTIAL_MODE');
    });

    it('isolated 模式必须有 HTTPS remote 与 PAT，并把 PAT 交给调用方接线', () => {
        const clone = makeClone();
        expect(() =>
            admitExecutor({
                workspaceDir: clone,
                controlPlaneToken: 'bearer',
                gitCredentialMode: 'isolated',
            })
        ).toThrow('EXECUTOR_REMOTE_NOT_HTTPS');

        const admitted = admitExecutor({
            workspaceDir: clone,
            controlPlaneToken: 'bearer',
            remoteUrl: 'https://github.com/a/b.git',
            gitPat: 'github_pat_x',
            gitCredentialMode: 'isolated',
        });
        expect(admitted.gitCredentials).toEqual({
            mode: 'isolated',
            remoteUrl: 'https://github.com/a/b.git',
            pat: 'github_pat_x',
        });
    });

    it('inherited 模式不把 PAT 递给下游——它在那条路上根本不会被用到', () => {
        const clone = makeClone();
        const admitted = admitExecutor({
            workspaceDir: clone,
            controlPlaneToken: 'bearer',
            remoteUrl: 'https://github.com/a/b.git',
            gitPat: 'github_pat_x',
        });
        expect(admitted.gitCredentials.mode).toBe('inherited');
        expect(admitted.gitCredentials.pat).toBe('');
    });

    it('sameGitRemote 忽略 .git 后缀、结尾斜杠与大小写，其余一律算不同源', () => {
        expect(sameGitRemote('https://github.com/a/b.git', 'https://github.com/A/B')).toBe(true);
        expect(sameGitRemote('https://github.com/a/b/', 'https://github.com/a/b')).toBe(true);
        expect(sameGitRemote('https://github.com/a/b', 'https://github.com/evil/b')).toBe(false);
        expect(sameGitRemote('', 'https://github.com/a/b')).toBe(false);
    });
});

/**
 * [SCN-FWB-035] S3 读取闸的**实际**覆盖面（代码评审 2026-09-02 §1.5）。
 *
 * 此前 `evaluateReadAccess`/`assertReadAllowed` 全仓只有测试引用，而注释写的是
 * 「执行器每次文件读取都过闸」——声明与接线断裂。现在执行器自己的三处读取真的过闸，
 * 覆盖边界也在 admission.js 里写清楚了（Agent 的读取由 provider 的目录边界拦，
 * 验证步骤跑任意仓库代码是 EXC-FWB-005 已接受的缺口）。
 */
describe('[SCN-FWB-035] S3 读取闸的覆盖面', () => {
    it('requireInsideWorkspace=false 时仍拒绝清单路径——`.git` 对账要读工作区外的 common dir', () => {
        const ws = makeClone();
        const outside = join(homedir(), '.ssh', 'id_rsa');

        // 默认口径：工作区外一律拒。
        expect(evaluateReadAccess(outside, { workspaceDir: ws }).allowed).toBe(false);
        // 放宽工作区边界之后，拒绝清单依然生效——这正是 `.git` common dir 需要的形状。
        const verdict = evaluateReadAccess(outside, {
            workspaceDir: ws,
            requireInsideWorkspace: false,
        });
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('EXECUTOR_READ_DENYLISTED_ROOT');
    });

    it('放宽工作区边界只放行普通路径，不放行 .env 类文件', () => {
        const ws = makeClone();
        const sibling = join(ws, '..', 'other-repo', '.git', 'config');
        expect(
            evaluateReadAccess(sibling, { workspaceDir: ws, requireInsideWorkspace: false }).allowed
        ).toBe(true);
        expect(
            evaluateReadAccess(join(ws, '..', 'other', '.dev.vars'), {
                workspaceDir: ws,
                requireInsideWorkspace: false,
            }).allowed
        ).toBe(false);
    });
});
