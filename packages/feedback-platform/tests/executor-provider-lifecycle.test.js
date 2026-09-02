/**
 * [SCN-FWB-035] provider 会话的生命周期：进程死了要有人知道，租约没了要停手，
 * 杀进程要连着子树一起杀（代码评审 2026-09-02 §3.4/§3.5/§3.6/§3.7）。
 *
 * 这四条是同一个失效模式的不同切面——**执行器以为自己在跑一轮，实际那一轮早就
 * 没有意义了**：provider 已经崩了、租约已经易主、或者这个引擎根本没有写权限。
 * 每一条的代价都是十几到三十分钟的空转与真金白银的额度。
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { AppServerClient } from '../executor/app-server-client.js';
import { createClaudeCliSession } from '../executor/claude-cli-session.js';
import { createCodexSession } from '../executor/codex-session.js';
import { PROVIDERS } from '../executor/main.js';

/** 最小可用的假子进程：stdout/stderr 是流，stdin 可写，进程本身可发 close。 */
function fakeProc({ stdinThrows = false } = {}) {
    const proc = new EventEmitter();
    proc.pid = 4242;
    // readline 要的是真流（它会调 resume/pause），EventEmitter 顶不上。
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = Object.assign(new EventEmitter(), {
        write() {
            if (stdinThrows) {
                const error = new Error('write EPIPE');
                error.code = 'EPIPE';
                throw error;
            }
            return true;
        },
        end() {},
    });
    proc.kill = vi.fn();
    return proc;
}

describe('[SCN-FWB-035] §3.5 codex app-server 进程退出必须是一个事件', () => {
    it('进程退出时在途 request 立刻失败，而不是干等 30 分钟超时', async () => {
        const proc = fakeProc();
        const client = new AppServerClient({ spawn: () => proc }).start();

        const pending = client.request('turn/start', {}, { timeoutMs: 30 * 60 * 1000 });
        proc.emit('close', 1, null);

        const error = await pending.catch((e) => e);
        expect(error.code).toBe('EXECUTOR_PROVIDER_EXITED');
        expect(String(error.message)).toContain('code=1');
    });

    it('退出通知发给 onExit 监听者，且只发一次', async () => {
        const proc = fakeProc();
        const client = new AppServerClient({ spawn: () => proc }).start();
        const seen = [];
        client.onExit((error) => seen.push(error));

        proc.emit('close', 0, 'SIGKILL');
        proc.emit('close', 0, 'SIGKILL');

        expect(seen).toHaveLength(1);
        expect(seen[0].code).toBe('EXECUTOR_PROVIDER_EXITED');
    });

    it('对已死进程写 stdin 不得打死守护进程——EPIPE 留在这一轮里', () => {
        const proc = fakeProc({ stdinThrows: true });
        const client = new AppServerClient({ spawn: () => proc }).start();
        // 坏行为下这一句会把 EPIPE 抛成 unhandled stream error，死的是守护进程本身。
        expect(() => client.notify('initialized', {})).not.toThrow();
    });

    it('codex 会话在客户端不报告退出时响亮失败，而不是静默不注册', () => {
        // 坏行为画像：`server.onExit?.(handler)` —— AppServerClient 当时根本没有
        // onExit，可选链把「接口没实现」变成一次空操作，run-loop 那条「provider 死了
        // 立刻走 C4 兜底」的路因此永不触发（与 SCN-FWB-032 的翻译器失聪同型）。
        const session = createCodexSession({
            client: { start() {}, onNotification() {}, onServerRequest() {} },
            workspaceDir: 'C:/ws',
        });
        expect(() => session.onExit(() => {})).toThrow('EXECUTOR_SESSION_ONEXIT_MISSING');
    });
});

describe('[SCN-FWB-035] §3.4 codex 不申报也不接受写入型 Run', () => {
    it('能力申报按 provider 派生：codex 只有只读两项，claude-code 才有写入', () => {
        expect(PROVIDERS.codex.policies).toEqual(['analyze', 'review']);
        expect(PROVIDERS['claude-code'].policies).toEqual(
            expect.arrayContaining(['implement', 'implement_and_verify'])
        );
        expect(PROVIDERS.codex.policies).not.toContain('implement');
    });

    it('真被派了写入型 Run 就当场说明原因，而不是跑一轮空转', async () => {
        // 坏行为：codex 会话恒为 read-only 沙箱，写入型 Run 必然以
        // no_changes_produced 收场——烧掉一次修复回路名额，读起来还像是 Agent 偷懒。
        const session = createCodexSession({
            client: { start() {}, onNotification() {}, onServerRequest() {}, onExit() {} },
            workspaceDir: 'C:/ws',
            policy: 'implement_and_verify',
        });
        const error = await session.openSession().catch((e) => e);
        expect(error.code).toBe('EXECUTOR_PROVIDER_CANNOT_WRITE');
        expect(error.errorCode).toBe('executor_provider_cannot_write');
    });

    it('只读 policy 照常开会话', async () => {
        const requests = [];
        const session = createCodexSession({
            client: {
                start() {},
                onNotification() {},
                onServerRequest() {},
                onExit() {},
                async initialize() {
                    return {};
                },
                async request(method, params) {
                    requests.push({ method, params });
                    return { threadId: 'thread-1' };
                },
            },
            workspaceDir: 'C:/ws',
            policy: 'analyze',
        });
        expect(await session.openSession()).toEqual({ sessionId: 'thread-1' });
        expect(requests[0].params.sandbox).toBe('read-only');
    });
});

describe('[SCN-FWB-035] §3.7 杀会话要连子树一起杀', () => {
    it('claude 会话的 kill 走树级——只杀直接子进程会留下孤儿继续跑', () => {
        // verification.js 已经为此付过一次代价：`shell:true` 下杀壳留树，孤儿进程
        // 在超时之后又跑了 17 分钟。同一条教训不在两个地方各犯一遍。
        const proc = fakeProc();
        const killed = [];
        const session = createClaudeCliSession({
            spawn: () => proc,
            killTree: (pid) => killed.push(pid),
        });
        session.start();
        session.kill();

        expect(killed).toEqual([4242]);
        expect(proc.kill).toHaveBeenCalled();
    });

    it('树级 kill 失败也仍然补一刀直接子进程', () => {
        const proc = fakeProc();
        const session = createClaudeCliSession({
            spawn: () => proc,
            killTree: () => {
                throw new Error('taskkill missing');
            },
        });
        session.start();
        expect(() => session.kill()).not.toThrow();
        expect(proc.kill).toHaveBeenCalled();
    });
});
