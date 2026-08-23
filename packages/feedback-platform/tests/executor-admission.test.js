/**
 * [SCN-FWB-035] S1～S3 准入守卫——机械执行，不靠 prompt。
 *
 * 坏行为画像：没有这些守卫时，执行器可以把主工作区当工作区（Agent 撞上未提交改动）、
 * 用开发者的 SSH key 推分支（凭据外溢）、读走 `.dev.vars` 和浏览器 profile（密钥外泄）。
 * EXC-FWB-005 拍板的是「不容器化」，没有拍板「不设防」。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
