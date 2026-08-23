/**
 * [SCN-FWB-035] Claude Code 会话层 —— S6 工具面闸与被拒工具上报。
 *
 * 真机冒烟能证明「合规时放行」（实测 init 实报 `["Glob","Grep","Read"]`，闸放行），
 * 但证明不了「越界时拦住」——那需要一个故意越界的 provider。这里用假进程补上，
 * 顺带覆盖非交互模式特有的一条路径：CLI 没有审批请求通道，被拒的工具调用记在终态
 * 事件的 `permission_denials` 里，必须逐条上报成 HumanAction，不能只留在日志里。
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createClaudeCliSession } from '../executor/claude-cli-session.js';

function fakeClaude() {
    const stdout = new PassThrough();
    const proc = {
        stdout,
        stderr: new PassThrough(),
        stdin: {
            written: '',
            ended: false,
            write(chunk) {
                this.written += chunk;
            },
            end() {
                this.ended = true;
            },
        },
        killed: false,
        handlers: {},
        on(event, handler) {
            proc.handlers[event] = handler;
        },
        kill() {
            proc.killed = true;
        },
    };
    return { proc, emit: (message) => stdout.write(JSON.stringify(message) + '\n') };
}

const initLine = (tools, sessionId = 'sess-1') => ({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools,
});

function startSession(fake, options = {}) {
    const session = createClaudeCliSession({ spawn: () => fake.proc, ...options });
    session.start();
    return session;
}

describe('[SCN-FWB-035] S6：会话层在 init 上当场校验工具面', () => {
    it('实报只读工具集时开会话成功，并带回 session_id', async () => {
        const fake = fakeClaude();
        const session = startSession(fake);
        const opened = session.openSession({ prompt: '分析这个 Issue', timeoutMs: 5000 });
        fake.emit(initLine(['Read', 'Grep', 'Glob'], 'sess-ok'));
        await expect(opened).resolves.toEqual({ sessionId: 'sess-ok' });
        expect(fake.proc.killed).toBe(false);
    });

    it('实报里混进 Bash 时杀进程并抛出带协议错误码的错误——不是打警告继续', async () => {
        const fake = fakeClaude();
        const session = startSession(fake);
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initLine(['Read', 'Grep', 'Glob', 'Bash']));
        await expect(opened).rejects.toMatchObject({
            code: 'EXECUTOR_TOOL_SURFACE_NOT_ALLOWED',
            errorCode: 'executor_tool_surface_not_allowed',
            disallowed: ['Bash'],
        });
        expect(fake.proc.killed).toBe(true);
    });

    it('未 start 就开会话报明确错误，而不是 null 解引用', async () => {
        const session = createClaudeCliSession({ spawn: () => fakeClaude().proc });
        await expect(session.openSession({ prompt: 'p' })).rejects.toMatchObject({
            code: 'EXECUTOR_SESSION_NOT_STARTED',
        });
    });

    it('Prompt 经 stdin 送出而不是位置参数——命令行长度上限会悄悄截断长 Prompt', async () => {
        const fake = fakeClaude();
        const session = startSession(fake);
        const opened = session.openSession({ prompt: '很长的 Prompt', timeoutMs: 5000 });
        fake.emit(initLine(['Read']));
        await opened;
        expect(fake.proc.stdin.written).toBe('很长的 Prompt');
        expect(fake.proc.stdin.ended).toBe(true);
    });
});

describe('[SCN-FWB-035] 被拒的工具调用必须对 owner 可见', () => {
    it('permission_denials 逐条回调审批处理器，并按能力分类', async () => {
        const fake = fakeClaude();
        const session = startSession(fake);
        const seen = [];
        session.onApprovalRequest((kind, params) => seen.push({ kind, tool: params.tool }));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initLine(['Read']));
        await opened;

        fake.emit({
            type: 'result',
            subtype: 'success',
            is_error: false,
            permission_denials: [
                { tool_name: 'Bash', tool_use_id: 't1' },
                { tool_name: 'Write', tool_use_id: 't2' },
                { tool_name: 'WebFetch', tool_use_id: 't3' },
            ],
        });
        await new Promise((resolve) => setImmediate(resolve));

        expect(seen).toEqual([
            { kind: 'command_execution', tool: 'Bash' },
            { kind: 'file_change', tool: 'Write' },
            { kind: 'permissions', tool: 'WebFetch' },
        ]);
    });
});

describe('[SCN-FWB-032] C4：provider 进程异常退出不让 Run 干等', () => {
    it('没给终态就退出时通知 onExit，run-loop 因此能立刻走兜底', async () => {
        const fake = fakeClaude();
        const session = startSession(fake);
        const exits = [];
        session.onExit((error) => exits.push(error));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initLine(['Read']));
        await opened;

        fake.proc.handlers.close?.(1);
        expect(exits).toHaveLength(1);
        expect(exits[0].code).toBe('EXECUTOR_PROVIDER_EXITED');
    });

    it('已经给过终态再退出属于正常收尾，不触发 onExit', async () => {
        const fake = fakeClaude();
        const session = startSession(fake);
        const exits = [];
        session.onExit((error) => exits.push(error));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initLine(['Read']));
        await opened;

        fake.emit({ type: 'result', subtype: 'success', is_error: false });
        await new Promise((resolve) => setImmediate(resolve));
        fake.proc.handlers.close?.(0);
        expect(exits).toEqual([]);
    });
});

describe('[SCN-FWB-035] S6 闸按 policy 取白名单——argv 与闸由同一个输入驱动', () => {
    it('写入型 policy 下 init 实报 Edit/Write 时放行', async () => {
        const fake = fakeClaude();
        const session = startSession(fake, { policy: 'implement' });
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initLine(['Read', 'Grep', 'Glob', 'Edit', 'Write'], 'sess-w'));
        await expect(opened).resolves.toEqual({ sessionId: 'sess-w' });
        expect(fake.proc.killed).toBe(false);
    });

    it('写入型 policy 下混进 Bash 仍然杀进程——写入面没有命令通道', async () => {
        const fake = fakeClaude();
        const session = startSession(fake, { policy: 'implement' });
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initLine(['Read', 'Edit', 'Write', 'Bash']));
        await expect(opened).rejects.toMatchObject({
            code: 'EXECUTOR_TOOL_SURFACE_NOT_ALLOWED',
            disallowed: ['Bash'],
        });
        expect(fake.proc.killed).toBe(true);
    });

    it('只读 policy（含缺省）下实报 Edit 仍然拒绝——写入面不得泄漏回只读 Run', async () => {
        for (const options of [{}, { policy: 'analyze' }]) {
            const fake = fakeClaude();
            const session = startSession(fake, options);
            const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
            fake.emit(initLine(['Read', 'Grep', 'Glob', 'Edit']));
            await expect(opened).rejects.toMatchObject({
                code: 'EXECUTOR_TOOL_SURFACE_NOT_ALLOWED',
                disallowed: ['Edit'],
            });
        }
    });
});
