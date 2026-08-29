/**
 * [SCN-FWB-043] Claude Code SDK 传输的会话层。
 *
 * 镜像 executor-claude-session.test.js 的全部关口（S6 闸、被拒上报、异常退出），
 * 再补 SDK 专属的四条：`apiKeySource` 计费断言、canUseTool 事前拒绝即上报、
 * 事前/终态两条通道按「工具名 + 输入」去重、「终态已 yield 再 throw 是正常收尾」。
 * 真机形状的依据是 M6-P 探针（poc/m6-sdk-probes/FINDINGS.md）；这里用假 queryFn
 * 覆盖真机冒烟证明不了的越界分支。
 */
import { describe, expect, it } from 'vitest';
import {
    BILLING_SOURCE_ERROR_CODE,
    createClaudeSdkSession,
} from '../executor/claude-sdk-session.js';
import { createClaudeCodeAdapter } from '../adapters/claude-code.js';

/** 可控的假 SDK：消息手动推入，支持正常结束、抛错两种收尾。 */
function fakeSdk() {
    const queue = [];
    let wake = null;
    let ended = false;
    let failure = null;
    const calls = [];
    async function* stream() {
        for (;;) {
            if (queue.length) {
                yield queue.shift();
                continue;
            }
            if (failure) throw failure;
            if (ended) return;
            await new Promise((resolve) => {
                wake = resolve;
            });
        }
    }
    const poke = () => {
        wake?.();
        wake = null;
    };
    return {
        calls,
        queryFn(args) {
            calls.push(args);
            return stream();
        },
        emit(message) {
            queue.push(message);
            poke();
        },
        end() {
            ended = true;
            poke();
        },
        fail(error) {
            failure = error;
            poke();
        },
    };
}

const initMessage = (tools, { sessionId = 'sess-1', apiKeySource = 'none' } = {}) => ({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    apiKeySource,
    tools,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function startSession(fake, options = {}) {
    const session = createClaudeSdkSession({ queryFn: fake.queryFn, ...options });
    session.start();
    return session;
}

describe('[SCN-FWB-043] S6：SDK init 实报上原样过闸', () => {
    it('实报只读三件套且 apiKeySource=none 时开会话成功，带回 session_id', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const opened = session.openSession({ prompt: '分析这个 Issue', timeoutMs: 5000 });
        fake.emit(initMessage(['Read', 'Grep', 'Glob'], { sessionId: 'sess-ok' }));
        await expect(opened).resolves.toEqual({ sessionId: 'sess-ok' });
        expect(fake.calls[0].options.abortController.signal.aborted).toBe(false);
    });

    it('[SCN-FWB-043] 实报里混进 Bash 时 abort 会话并抛协议错误码——不是打警告继续', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read', 'Grep', 'Glob', 'Bash']));
        await expect(opened).rejects.toMatchObject({
            code: 'EXECUTOR_TOOL_SURFACE_NOT_ALLOWED',
            errorCode: 'executor_tool_surface_not_allowed',
            disallowed: ['Bash'],
        });
        expect(fake.calls[0].options.abortController.signal.aborted).toBe(true);
    });

    it('写入型 policy 下实报 Edit/Write 放行；混进 Bash 仍拒——写入面没有命令通道', async () => {
        const ok = fakeSdk();
        const okSession = startSession(ok, { policy: 'implement' });
        const okOpened = okSession.openSession({ prompt: 'p', timeoutMs: 5000 });
        ok.emit(initMessage(['Read', 'Grep', 'Glob', 'Edit', 'Write'], { sessionId: 'sess-w' }));
        await expect(okOpened).resolves.toEqual({ sessionId: 'sess-w' });

        const bad = fakeSdk();
        const badSession = startSession(bad, { policy: 'implement' });
        const badOpened = badSession.openSession({ prompt: 'p', timeoutMs: 5000 });
        bad.emit(initMessage(['Read', 'Edit', 'Write', 'Bash']));
        await expect(badOpened).rejects.toMatchObject({ disallowed: ['Bash'] });
    });

    it('未 start 就开会话报明确错误', async () => {
        const session = createClaudeSdkSession({ queryFn: fakeSdk().queryFn });
        await expect(session.openSession({ prompt: 'p' })).rejects.toMatchObject({
            code: 'EXECUTOR_SESSION_NOT_STARTED',
        });
    });
});

describe('[SCN-FWB-043] 计费断言：apiKeySource 不是订阅登录就拒绝开跑', () => {
    it('[SCN-FWB-043] init 申报 ANTHROPIC_API_KEY 时 abort 并抛协议错误码——伪 key 静默抢占订阅（M6-P r4）', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read'], { apiKeySource: 'ANTHROPIC_API_KEY' }));
        await expect(opened).rejects.toMatchObject({
            code: 'EXECUTOR_BILLING_SOURCE_NOT_ALLOWED',
            errorCode: BILLING_SOURCE_ERROR_CODE,
        });
        expect(fake.calls[0].options.abortController.signal.aborted).toBe(true);
    });
});

describe('[SCN-FWB-043] 事前拒绝即上报 + 两条通道去重', () => {
    it('canUseTool 一律拒绝、立即按能力分类上报，且不中断 turn', async () => {
        const fake = fakeSdk();
        const session = startSession(fake, { policy: 'implement' });
        const seen = [];
        session.onApprovalRequest((kind, params) => seen.push({ kind, tool: params.tool }));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read', 'Edit', 'Write'], { sessionId: 's' }));
        await opened;

        const decision = await fake.calls[0].options.canUseTool('Write', {
            file_path: 'C:\\outside\\x.txt',
        });
        expect(decision).toMatchObject({ behavior: 'deny', interrupt: false });
        expect(seen).toEqual([{ kind: 'file_change', tool: 'Write' }]);
    });

    it('[SCN-FWB-043] 同一次被拒出现在终态 permission_denials 里不重复上报；未经回调的照常上报', async () => {
        const fake = fakeSdk();
        const session = startSession(fake, { policy: 'implement' });
        const seen = [];
        session.onApprovalRequest((kind, params) => seen.push({ kind, tool: params.tool }));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read', 'Edit', 'Write']));
        await opened;

        // 事前通道：canUseTool 拒了一次越界 Write。
        await fake.calls[0].options.canUseTool('Write', { file_path: 'C:\\outside\\x.txt' });
        // 终态通道：同一次 Write 再次出现（M6-P r5 实测形状），外加一条从未到达
        // 回调的 WebFetch（被规则直接拒的形态）。
        fake.emit({
            type: 'result',
            subtype: 'success',
            is_error: false,
            permission_denials: [
                {
                    tool_name: 'Write',
                    tool_use_id: 't1',
                    tool_input: { file_path: 'C:\\outside\\x.txt' },
                },
                { tool_name: 'WebFetch', tool_use_id: 't2', tool_input: { url: 'https://x' } },
            ],
        });
        await flush();

        expect(seen).toEqual([
            { kind: 'file_change', tool: 'Write' },
            { kind: 'permissions', tool: 'WebFetch' },
        ]);
    });
});

describe('[SCN-FWB-043] SDK 的 throw 语义：终态已 yield 再 throw 是正常收尾', () => {
    it('[SCN-FWB-043] 错误终态先 yield 后 throw（M6-P r1 形状）不触发 onExit', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const exits = [];
        session.onExit((error) => exits.push(error));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read']));
        await opened;

        fake.emit({ type: 'result', subtype: 'success', is_error: true });
        await flush();
        fake.fail(new Error('Claude Code returned an error result: Not logged in'));
        await flush();
        expect(exits).toEqual([]);
    });

    it('没给终态就 throw 时通知 onExit，run-loop 因此能立刻走 C4 兜底', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const exits = [];
        session.onExit((error) => exits.push(error));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read']));
        await opened;

        fake.fail(new Error('socket hang up'));
        await flush();
        expect(exits).toHaveLength(1);
        expect(exits[0].code).toBe('EXECUTOR_PROVIDER_EXITED');
        expect(String(exits[0].message)).toMatch(/socket hang up/);
    });

    it('流正常走完却没有终态 → 同样走 EXECUTOR_PROVIDER_EXITED', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const exits = [];
        session.onExit((error) => exits.push(error));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read']));
        await opened;

        fake.end();
        await flush();
        expect(exits).toHaveLength(1);
        expect(exits[0].code).toBe('EXECUTOR_PROVIDER_EXITED');
    });

    it('kill() 之后的 throw 不再当异常退出——abort 是我们自己按的', async () => {
        const fake = fakeSdk();
        const session = startSession(fake);
        const exits = [];
        session.onExit((error) => exits.push(error));
        const opened = session.openSession({ prompt: 'p', timeoutMs: 5000 });
        fake.emit(initMessage(['Read']));
        await opened;

        session.kill();
        expect(fake.calls[0].options.abortController.signal.aborted).toBe(true);
        fake.fail(new Error('Operation aborted'));
        await flush();
        expect(exits).toEqual([]);
    });
});

describe('[SCN-FWB-043] 事件与配置接线', () => {
    it('消息以 (type, message) 转发；prompt 与运行时字段进了 query()', async () => {
        const fake = fakeSdk();
        const session = startSession(fake, {
            env: { PATH: 'x' },
            cwd: 'C:/ws',
            options: { model: 'claude-haiku-4-5' },
        });
        const events = [];
        session.onEvent((type, message) => events.push({ type, text: message?.message?.content }));
        const opened = session.openSession({ prompt: '很长的 Prompt', timeoutMs: 5000 });
        fake.emit(initMessage(['Read']));
        await opened;
        fake.emit({ type: 'assistant', message: { content: 'hi' } });
        await flush();

        expect(events.map((e) => e.type)).toEqual(['system', 'assistant']);
        const call = fake.calls[0];
        expect(call.prompt).toBe('很长的 Prompt');
        expect(call.options).toMatchObject({ model: 'claude-haiku-4-5', cwd: 'C:/ws' });
        expect(call.options.env).toEqual({ PATH: 'x' });
        expect(call.options.canUseTool).toBeTypeOf('function');
    });
});

describe('[SCN-FWB-043] Adapter 的 buildSessionOptions 与 S8', () => {
    const adapter = createClaudeCodeAdapter();

    it('只读 policy：tools 正面白名单收到三件套，无 permissionMode、无 allowedTools', () => {
        const options = adapter.buildSessionOptions({ policy: 'analyze' });
        expect(options.tools).toEqual(['Glob', 'Grep', 'Read']);
        expect(options).not.toHaveProperty('permissionMode');
        // S8：allowedTools 是 auto-approve 语义，会拆掉 cwd 边界——任何 policy 都不得出现。
        expect(options).not.toHaveProperty('allowedTools');
        expect(options.settingSources).toEqual(['project']);
        expect(options.strictMcpConfig).toBe(true);
        expect(options.extraArgs).toEqual({ 'disable-slash-commands': null });
    });

    it('[SCN-FWB-043] 写入型 policy：白名单加 Edit/Write，permissionMode=acceptEdits，仍无命令通道', () => {
        const options = adapter.buildSessionOptions({
            policy: 'implement_and_verify',
            resumeSessionId: 'sess-9',
            model: 'claude-haiku-4-5',
            maxTurns: 3,
            maxBudgetUsd: 1.5,
        });
        expect(options.tools).toEqual(['Glob', 'Grep', 'Read', 'Edit', 'Write']);
        expect(options.permissionMode).toBe('acceptEdits');
        expect(options.tools).not.toContain('Bash');
        expect(options).toMatchObject({ resume: 'sess-9', maxTurns: 3, maxBudgetUsd: 1.5 });
    });
});

describe('[SCN-FWB-043] 传输选择：未知值响亮失败，policy 一路接到 SDK 会话', () => {
    it('[SCN-FWB-043] 缺省 cli、显式 sdk 都合法；未知值抛 EXECUTOR_UNKNOWN_CLAUDE_TRANSPORT', async () => {
        const { resolveClaudeTransport } = await import('../executor/main.js');
        expect(resolveClaudeTransport({})).toBe('cli');
        expect(resolveClaudeTransport({ FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT: 'sdk' })).toBe('sdk');
        expect(() =>
            resolveClaudeTransport({ FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT: 'sdK' })
        ).toThrowError(/EXECUTOR_UNKNOWN_CLAUDE_TRANSPORT/);
    });

    it('transport=sdk 时 createSession 产出 SDK 会话且 policy 已接上（接线洞防线）', async () => {
        const { PROVIDERS } = await import('../executor/main.js');
        const previous = process.env.FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT;
        process.env.FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT = 'sdk';
        try {
            const session = PROVIDERS['claude-code'].createSession({
                adapter: createClaudeCodeAdapter(),
                command: 'claude',
                childEnv: {},
                workspaceDir: 'C:/ws',
                context: { policy: 'implement' },
                log: () => {},
            });
            expect(session.transport).toBe('sdk');
            expect(session.policy).toBe('implement');
        } finally {
            if (previous === undefined) delete process.env.FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT;
            else process.env.FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT = previous;
        }
    });
});
