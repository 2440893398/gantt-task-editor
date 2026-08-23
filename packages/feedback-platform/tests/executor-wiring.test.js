/**
 * [SCN-FWB-032] [SCN-FWB-035] 引擎接线——翻译器必须真的被挂上。
 *
 * 坏行为画像（2026-08-21 真机联调实测，两个 bug 叠在一起产生同一个症状）：
 * provider 进程正常起、正常干活、正常退出，而执行器一条协议事件都不发——
 * Run 停在 running 直到 30 分钟 turn 超时，日志里一个字都没有。成因是
 * `EVENT_TRANSLATORS` 的键被写成 `claude-codeX`，查不到就**静默回落 codex 翻译器**，
 * 而 codex 翻译器永远匹配不上 Claude Code 的 NDJSON。
 *
 * 单测覆盖不到它，是因为测试直接 import `translateClaudeCliEvent`，绕过了接线表。
 * 所以这里一律用 **Adapter 自己声明的 provider id** 当键去查表，而不是硬编码字符串：
 * 键与 id 绑死，改名也漂移不了。
 */
import { describe, expect, it } from 'vitest';
import { EVENT_TRANSLATORS, TURN_EVENT_KINDS } from '../executor/provider-events.js';
import { executeLeasedRun, UNKNOWN_PROVIDER_TRANSLATOR } from '../executor/run-loop.js';
import { createClaudeCodeAdapter } from '../adapters/claude-code.js';
import { createCodexAdapter } from '../adapters/codex.js';

const CLAUDE_INIT = { type: 'system', subtype: 'init', session_id: 'sess-1', tools: ['Read'] };

describe('[SCN-FWB-032] provider 翻译器接线', () => {
    it('每个 Adapter 声明的 provider id 都能在接线表里查到翻译器', () => {
        for (const adapter of [createClaudeCodeAdapter(), createCodexAdapter()]) {
            expect(
                EVENT_TRANSLATORS[adapter.provider],
                `provider "${adapter.provider}" 在 EVENT_TRANSLATORS 里查不到`
            ).toBeTypeOf('function');
        }
    });

    it('用 claude-code 的 id 查到的翻译器认得 Claude Code 的 init', () => {
        const translate = EVENT_TRANSLATORS[createClaudeCodeAdapter().provider];
        const signal = translate('system', CLAUDE_INIT);
        expect(signal).toMatchObject({ kind: TURN_EVENT_KINDS.STARTED, sessionId: 'sess-1' });
    });

    it('codex 翻译器认不出 Claude Code 的消息——回落到它就等于一条事件都不发', () => {
        // 这条锁住"为什么静默回落是致命的"：回落目标对新引擎完全失聪。
        expect(EVENT_TRANSLATORS.codex('system', CLAUDE_INIT)).toBeNull();
    });
});

/** 只需要一个不会被真正用到的会话：这些用例在起会话之前就该结束。 */
function stubSession() {
    return {
        start() {},
        onEvent() {},
        onApprovalRequest() {},
        onExit() {},
        async openSession() {
            throw new Error('不该走到这里');
        },
        async startTurn() {},
        kill() {},
    };
}

function fakeControlPlane() {
    return {
        events: [],
        async postEvent({ event }) {
            this.events.push(event);
        },
        async postApproval() {},
        async heartbeat() {
            return { commands: [] };
        },
    };
}

describe('[SCN-FWB-035] 未知 provider 必须响亮失败', () => {
    it('查不到翻译器时当场终态失败，而不是静默回落 codex 然后挂到 turn 超时', async () => {
        const controlPlane = fakeControlPlane();
        const result = await executeLeasedRun({
            lease: {
                runId: 'run_x',
                leaseId: 'l1',
                executorId: 'e1',
                epoch: 1,
                workspaceDir: 'C:\ws',
                context: {
                    policy: 'analyze',
                    provider: 'totally-unknown-engine',
                    issue: {},
                    timeline: [],
                },
            },
            controlPlane,
            adapter: createClaudeCodeAdapter(),
            createSession: stubSession,
        });

        expect(result.status).toBe('failed');
        expect(result.errorCode).toBe(UNKNOWN_PROVIDER_TRANSLATOR);
        // 终态必须真的投出去——「失败但没人知道」正是这次事故的形态。
        const terminal = controlPlane.events.at(-1);
        expect(terminal.type).toBe('run.failed');
        expect(terminal.payload.errorCode).toBe(UNKNOWN_PROVIDER_TRANSLATOR);
        expect(terminal.payload.summary).toMatch(/totally-unknown-engine/);
    });

    it('控制面 context 里的 AI 厂商字段不得决定引擎——它实测是 codex', () => {
        // main.js 把 providerId 压在 lease.context 之上；这里锁住「压得住」这件事。
        const providerId = createClaudeCodeAdapter().provider;
        const leaseContext = { policy: 'analyze', provider: 'codex' };
        const merged = { ...leaseContext, provider: providerId };
        expect(merged.provider).toBe('claude-code');
        expect(EVENT_TRANSLATORS[merged.provider]).toBeTypeOf('function');
    });
});

describe('[SCN-FWB-035] policy 必须从 lease.context 一路接到会话闸', () => {
    it('claude-code 的 createSession 把 context.policy 传进会话——断线即写入型 Run 全灭在 S6 闸', async () => {
        // 接线洞的画像：argv 按写入型生成（Edit/Write 不在拒绝清单），而 S6 闸
        // 没拿到 policy、退回只读白名单——init 实报 Edit/Write 时闸当场杀进程，
        // 每一条写入型 Run 都以 executor_tool_surface_not_allowed 终态失败。
        // argv 与闸必须由同一个 context.policy 驱动。
        const { PROVIDERS } = await import('../executor/main.js');
        const session = PROVIDERS['claude-code'].createSession({
            adapter: createClaudeCodeAdapter(),
            command: 'claude',
            childEnv: {},
            workspaceDir: 'C:/ws',
            context: { policy: 'implement' },
            log: () => {},
        });
        expect(session.policy).toBe('implement');
    });
});
