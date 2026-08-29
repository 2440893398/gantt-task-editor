/**
 * [SCN-FWB-032] Claude Code CLI 的事件翻译层 —— 第二个 provider 接入归一化层。
 *
 * 契约要求：provider 差异只落在**可换的翻译器**里，归一化策略仍是单一份
 * （终态只认 turn 终态、中间文本只收集不逐条转发、空输出 `empty_agent_response`、
 * eventId 决定性）。所以本文件断言的是「同一个 normalizer 换个翻译器」的行为，
 * 而不是另写一套归一化。
 *
 * 三条实测事实（2026-08-20 真机探针）在此机械落地：
 * 1. 终态是 `{"type":"result"}`，失败判定以 `is_error` 为准——认证失败时
 *    `is_error: true` 而 `subtype` 仍是 `"success"`，只看 subtype 会把没跑起来的 Run 当答完；
 * 2. CLI 会以 assistant 形态发 `model: "<synthetic>"` / `is_api_error_message: true`
 *    的运维错误（实测正文 `Not logged in · Please run /login`），收进最终文本就会
 *    把 provider 故障当成对用户的回答投递出去；
 * 3. 文本在 `message.content[].text`，可与 `tool_use` 块混在同一条消息里。
 */
import { describe, expect, it } from 'vitest';
import {
    CLAUDE_CLI_EVENT_TRANSLATOR,
    translateClaudeCliEvent,
} from '../executor/provider-events.js';
import { createTurnNormalizer } from '../executor/normalize.js';

const RUN_ID = 'run_claude_1';

function claudeNormalizer() {
    return createTurnNormalizer({
        runId: RUN_ID,
        provider: 'claude-code',
        translate: CLAUDE_CLI_EVENT_TRANSLATOR,
        now: () => '2026-08-20T00:00:00.000Z',
    });
}

/** CLI 每行一条 JSON，`type` 当 method 用，整条消息当 params 用。 */
const feed = (normalizer, message) => normalizer.handleNotification(message.type, message);

const initEvent = (sessionId = 'sess-1') => ({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: ['Read', 'Grep', 'Glob'],
});

const assistantText = (text) => ({
    type: 'assistant',
    message: { model: 'claude-opus-5', content: [{ type: 'text', text }] },
});

const successResult = (extra = {}) => ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    terminal_reason: 'completed',
    result: 'ignored — 最终文本取自 assistant 消息，与 codex 同一条策略',
    ...extra,
});

describe('[SCN-FWB-032] Claude CLI 事件翻译器', () => {
    it('init 是 turn 开始，并带出 provider 会话 id（续接的凭据）', () => {
        expect(translateClaudeCliEvent('system', initEvent('abc'))).toEqual({
            kind: 'turn_started',
            sessionId: 'abc',
        });
    });

    it('非 init 的 system 消息与噪音事件一律忽略', () => {
        for (const message of [
            { type: 'system', subtype: 'thinking_tokens' },
            { type: 'system', subtype: 'post_turn_summary' },
            { type: 'rate_limit_event' },
            { type: 'user', message: { content: [{ type: 'tool_result' }] } },
            { type: 'stream_event' },
        ]) {
            expect(translateClaudeCliEvent(message.type, message)).toBeNull();
        }
    });

    it('assistant 文本被取出；与 tool_use 混排时只取文本块', () => {
        const mixed = {
            type: 'assistant',
            message: {
                model: 'claude-opus-5',
                content: [
                    { type: 'text', text: '先看一下调用点。' },
                    { type: 'tool_use', name: 'Read', input: {} },
                ],
            },
        };
        expect(translateClaudeCliEvent('assistant', mixed)).toEqual({
            kind: 'agent_text',
            text: '先看一下调用点。',
        });
    });

    it('纯 tool_use 的 assistant 消息没有文本可收，忽略而不是产生空文本', () => {
        const toolOnly = {
            type: 'assistant',
            message: { model: 'claude-opus-5', content: [{ type: 'tool_use', name: 'Read' }] },
        };
        expect(translateClaudeCliEvent('assistant', toolOnly)).toBeNull();
    });

    it('合成的 provider 运维错误不是 Agent 产出——必须丢弃', () => {
        const synthetic = {
            type: 'assistant',
            is_api_error_message: true,
            message: {
                model: '<synthetic>',
                content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
            },
        };
        expect(translateClaudeCliEvent('assistant', synthetic)).toBeNull();
    });

    it('result 的失败判定以 is_error 为准——subtype 会撒谎', () => {
        // 实测的认证失败形态：is_error 为真，subtype 仍是 success。
        const authFailure = translateClaudeCliEvent('result', {
            type: 'result',
            subtype: 'success',
            is_error: true,
            terminal_reason: 'api_error',
        });
        expect(authFailure.kind).toBe('turn_failed');
        expect(String(authFailure.summary)).toMatch(/api_error/);

        // 撞穿 turn 上限同样是失败，不得与答完同形。
        const maxTurns = translateClaudeCliEvent('result', {
            type: 'result',
            subtype: 'error_max_turns',
            is_error: true,
            terminal_reason: 'max_turns',
        });
        expect(maxTurns.kind).toBe('turn_failed');
        expect(String(maxTurns.summary)).toMatch(/max_turns/);

        expect(translateClaudeCliEvent('result', successResult())).toEqual({
            kind: 'turn_completed',
        });
    });

    it('[SCN-FWB-032] 失败结果带出 provider 报错原文：SDK 放 errors[]，is_error 版放 result', () => {
        const sdkError = translateClaudeCliEvent('result', {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            terminal_reason: 'api_error',
            errors: ['API Error: 500 upstream connect error', 'retry exhausted'],
        });
        expect(sdkError.detail).toBe('API Error: 500 upstream connect error | retry exhausted');

        // `subtype: success` + `is_error: true` 这一支把错误正文放在 result 字段。
        const authFailure = translateClaudeCliEvent('result', {
            type: 'result',
            subtype: 'success',
            is_error: true,
            terminal_reason: 'api_error',
            result: 'Not logged in · Please run /login',
        });
        expect(authFailure.detail).toBe('Not logged in · Please run /login');

        // 成功的 result 字段是最终文本，不是错误——不得被当成失败详情。
        expect(translateClaudeCliEvent('result', successResult()).detail).toBeUndefined();
    });
});

describe('[SCN-FWB-032] 换翻译器不换归一化策略', () => {
    it('中间文本只收集不转发，终态一次性给出最后一条', () => {
        const normalizer = claudeNormalizer();
        expect(feed(normalizer, initEvent()).map((e) => e.type)).toEqual(['run.started']);
        expect(feed(normalizer, assistantText('先读代码'))).toEqual([]);
        expect(feed(normalizer, assistantText('结论如下'))).toEqual([]);

        const terminal = feed(normalizer, successResult());
        expect(terminal.map((e) => e.type)).toEqual(['agent.message', 'run.completed']);
        expect(terminal[0].payload.message).toBe('结论如下');
        expect(terminal[0].provider).toBe('claude-code');
        expect(terminal[0].providerSessionId).toBe('sess-1');
    });

    it('eventId 由 runId + 单调序号决定性生成，重发幂等', () => {
        const ids = [];
        const normalizer = claudeNormalizer();
        for (const event of feed(normalizer, initEvent())) ids.push(event.eventId);
        feed(normalizer, assistantText('答案'));
        for (const event of feed(normalizer, successResult())) ids.push(event.eventId);
        expect(ids).toEqual([
            `${RUN_ID}:executor:1`,
            `${RUN_ID}:executor:2`,
            `${RUN_ID}:executor:3`,
        ]);
    });

    it('一条文本都没有的成功 turn 以 empty_agent_response 失败，不发空回复', () => {
        const normalizer = claudeNormalizer();
        feed(normalizer, initEvent());
        const terminal = feed(normalizer, successResult());
        expect(terminal.map((e) => e.type)).toEqual(['run.failed']);
        expect(terminal[0].payload.errorCode).toBe('empty_agent_response');
    });

    it('认证失败的整轮：合成消息不入最终文本，Run 以 provider 失败收尾', () => {
        const normalizer = claudeNormalizer();
        feed(normalizer, initEvent());
        feed(normalizer, {
            type: 'assistant',
            is_api_error_message: true,
            message: {
                model: '<synthetic>',
                content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
            },
        });
        const terminal = feed(normalizer, {
            type: 'result',
            subtype: 'success',
            is_error: true,
            terminal_reason: 'api_error',
        });
        expect(terminal.map((e) => e.type)).toEqual(['run.failed']);
        expect(terminal[0].payload.errorCode).toBe('provider_turn_failed');
        expect(JSON.stringify(terminal)).not.toMatch(/Please run \/login/);
        expect(normalizer.finalAgentText).toBe('');
    });

    it('[SCN-FWB-032] provider 报错原文只暂存给日志，绝不进 run.failed 的 payload', () => {
        // 金丝雀 #5 实录：修复回合两轮都以 api_error 在 2 秒内失败，`errors[]` 里的原文
        // 谁都没读，日志只剩 "(api_error)" 三个字——预算烧光了却查不出为什么。
        const normalizer = claudeNormalizer();
        feed(normalizer, initEvent());
        const terminal = feed(normalizer, {
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            terminal_reason: 'api_error',
            errors: ['API Error: 500 {"type":"error","error":{"type":"api_error"}}'],
        });
        expect(terminal.map((e) => e.type)).toEqual(['run.failed']);
        expect(terminal[0].payload.summary).toBe('Claude Code turn failed (api_error).');
        // 用户看到的失败说明里不得出现 provider 的运维原文。
        expect(JSON.stringify(terminal)).not.toMatch(/API Error: 500/);
        // 但本机必须留得住证据。
        expect(normalizer.providerFailureDetail).toMatch(/API Error: 500/);
    });

    it('终态之后的事件一律不再产生新事件', () => {
        const normalizer = claudeNormalizer();
        feed(normalizer, initEvent());
        feed(normalizer, assistantText('答案'));
        feed(normalizer, successResult());
        expect(feed(normalizer, assistantText('迟到的话'))).toEqual([]);
        expect(feed(normalizer, successResult())).toEqual([]);
    });
});
