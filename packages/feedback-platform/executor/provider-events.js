/**
 * provider 事件翻译器（SCN-FWB-032）。
 *
 * 归一化层被拆成两半：**翻译器可换，策略不可换**。
 * 翻译器只回答「这条 provider 消息在语义上是什么」，四种答案而已：
 * turn 开始 / Agent 文本 / turn 完成 / turn 失败（其余一律 null 忽略）。
 * 「终态只认 turn 终态事件」「中间文本只收集不转发」「空输出以 empty_agent_response
 * 失败」「eventId 决定性」这四条策略留在 normalize.js 里，**只有一份**——
 * 接第二个引擎时如果需要复制这些判断，说明拆分线画错了。
 *
 * provider 私有字段名到此为止：本文件之外不得出现 `agentMessage`、`is_api_error_message`
 * 这类名字。
 */

/** 翻译器可以返回的语义种类。 */
export const TURN_EVENT_KINDS = Object.freeze({
    STARTED: 'turn_started',
    AGENT_TEXT: 'agent_text',
    COMPLETED: 'turn_completed',
    FAILED: 'turn_failed',
});

/* ------------------------------------------------------------------ codex */

/**
 * codex app-server：JSON-RPC 通知。
 *
 * M0 实测两条：item 形状是**驼峰**（`agentMessage`，不是 `agent_message`——这个笔误
 * 曾把一次成功的实验判成失败）；终态只有 `turn/completed`，同一个 turn 内可以出现
 * 多条 `phase: "final_answer"` 的 agentMessage，拿它收尾会提前结束 Run。
 */
export function translateCodexNotification(method, params) {
    if (method === 'turn/started') {
        return { kind: TURN_EVENT_KINDS.STARTED };
    }
    if (method === 'item/completed' && params?.item?.type === 'agentMessage') {
        const text = typeof params.item.text === 'string' ? params.item.text : '';
        return text ? { kind: TURN_EVENT_KINDS.AGENT_TEXT, text } : null;
    }
    if (method === 'turn/completed') {
        return { kind: TURN_EVENT_KINDS.COMPLETED };
    }
    if (method === 'turn/failed' || method === 'error') {
        return {
            kind: TURN_EVENT_KINDS.FAILED,
            summary: String(params?.error?.message || params?.message || method),
        };
    }
    return null;
}

export const CODEX_EVENT_TRANSLATOR = translateCodexNotification;

/* ------------------------------------------------------- Claude Code CLI */

/** `claude -p --output-format stream-json` 每行一条 JSON；`type` 当 method 用。 */

/**
 * provider 的**合成**消息：CLI 把自身的运维故障（未登录、API 错误）也包成
 * assistant 消息发出来，`model` 为 `<synthetic>` 且带 `is_api_error_message`。
 * 实测正文是 `Not logged in · Please run /login`——它要是被收进最终文本，
 * 用户看到的就是「Agent 对我的反馈的回答是：请运行 /login」。
 */
function isSyntheticProviderMessage(message) {
    return message?.is_api_error_message === true || message?.message?.model === '<synthetic>';
}

function extractAssistantText(message) {
    const content = message?.message?.content;
    if (!Array.isArray(content)) return '';
    return content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
        .trim();
}

export function translateClaudeCliEvent(method, message) {
    if (method === 'system' && message?.subtype === 'init') {
        return {
            kind: TURN_EVENT_KINDS.STARTED,
            sessionId: String(message.session_id || ''),
        };
    }

    if (method === 'assistant') {
        if (isSyntheticProviderMessage(message)) return null;
        const text = extractAssistantText(message);
        return text ? { kind: TURN_EVENT_KINDS.AGENT_TEXT, text } : null;
    }

    if (method === 'result') {
        // 失败判定**以 is_error 为准**：实测认证失败时 is_error 为 true 而 subtype
        // 仍是 "success"，只看 subtype 会把一个根本没跑起来的 Run 当成答完。
        const failed = message?.is_error === true || message?.subtype !== 'success';
        if (!failed) return { kind: TURN_EVENT_KINDS.COMPLETED };
        const reason = String(
            message?.terminal_reason || message?.subtype || 'provider reported failure'
        );
        return {
            kind: TURN_EVENT_KINDS.FAILED,
            summary: `Claude Code turn failed (${reason}).`,
        };
    }

    return null;
}

export const CLAUDE_CLI_EVENT_TRANSLATOR = translateClaudeCliEvent;

/** provider id → 翻译器。run-loop 与 main 只认 provider id，不认具体函数。 */
export const EVENT_TRANSLATORS = Object.freeze({
    codex: CODEX_EVENT_TRANSLATOR,
    'claude-code': CLAUDE_CLI_EVENT_TRANSLATOR,
});
