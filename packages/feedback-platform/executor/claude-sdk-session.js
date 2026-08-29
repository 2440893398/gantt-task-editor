/**
 * Claude Code 的 ProviderSession 实现之二：Agent SDK 传输（SCN-FWB-043 / M6-T3）。
 *
 * 与 claude-cli-session.js 暴露完全相同的接口，run-loop 一行不用改；两者由
 * `FEEDBACK_EXECUTOR_CLAUDE_TRANSPORT` 在 main.js 里选择（缺省 cli，未知值响亮失败）。
 *
 * 三条来自 M6-P 真机探针（2026-08-29，SDK 0.3.251 / 捆绑 CLI 2.1.251，证据
 * poc/m6-sdk-probes/）的实现纪律，改动前先读 FINDINGS.md：
 *
 * 1. **SDK 对错误终态与 abort 会 throw，且 result 消息在 throw 之前已经 yield**
 *    （r1/r4/r6 实测）。已见终态后的 throw 是正常收尾，绝不能当进程级故障——
 *    否则每个如实报错的 Run 都会额外触发一次 EXECUTOR_PROVIDER_EXITED。
 * 2. **canUseTool 只在「需要决策」时触发**（r5：acceptEdits 下区内 Write 免回调
 *    直接落盘，越界 Write 触发回调且拒绝后同时落进终态 permission_denials）。
 *    因此一律拒绝是安全的：它不会把写入管线打死。被拒调用经两条通道出现时按
 *    「工具名 + 输入」去重，同一次越界不产生两条上报。
 * 3. **init.apiKeySource 必须是 'none'（订阅 OAuth）**：r4 实测子进程 env 里的
 *    ANTHROPIC_API_KEY 会静默抢占订阅登录、改成按量计费且无任何警告——init 是
 *    唯一如实申报凭据来源的地方，所以断言放在这里，与 S6 工具面闸同址同刑
 *    （越界即拒绝开跑，不打警告继续）。
 */
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { assertToolSurfaceAllowed, toolAllowlistFor } from './tool-policy.js';

const INIT_TIMEOUT_MS = 120 * 1000;

/** 协议终态错误码：凭据来源不是订阅登录（run.failed 的 errorCode）。 */
export const BILLING_SOURCE_ERROR_CODE = 'executor_billing_source_not_allowed';

/**
 * 与 claude-cli-session.js 同一套能力分类：被拒的 Bash 和被拒的 Read 对 owner
 * 的意义完全不同。
 */
const COMMAND_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);
const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function approvalKindForTool(toolName) {
    if (COMMAND_TOOLS.has(toolName)) return 'command_execution';
    if (FILE_WRITE_TOOLS.has(toolName)) return 'file_change';
    return 'permissions';
}

/** 键序确定的 stringify——去重键不能因对象键序抖动而失配。 */
function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

function denialDedupeKey(toolName, input) {
    return `${toolName}:${stableStringify(input ?? {})}`;
}

export function createClaudeSdkSession({
    // Adapter 的 buildSessionOptions(policy, …) 产出的 SDK options 片段（工具白名单、
    // permissionMode、model/maxTurns/maxBudgetUsd/resume 等）。运行时字段（env/cwd/
    // canUseTool/abortController/stderr）由本会话补齐，Adapter 保持纯函数。
    options = {},
    env,
    cwd,
    onStderr = null,
    // 与 claude-cli-session 相同的接线约束：options 与 S6 闸必须由同一个
    // context.policy 驱动，分开传两个来源就会出现「options 是写入态、闸是只读态」
    // 的接线洞。缺省即只读。
    policy = '',
    // 测试注入点。默认真 SDK。
    queryFn = sdkQuery,
} = {}) {
    let started = false;
    let terminalSeen = false;
    let killed = false;
    const abortController = new AbortController();
    const eventHandlers = [];
    const exitHandlers = [];
    let approvalHandler = null;
    let onInit = null;
    /** canUseTool 已上报过的被拒调用——终态 permission_denials 阶段按此去重。 */
    const reportedDenials = new Set();
    let preDenialSeq = 0;

    function emit(message) {
        if (message?.type === 'result') {
            terminalSeen = true;
            for (const denial of message.permission_denials ?? []) {
                const toolName = String(denial?.tool_name || denial?.toolName || 'unknown');
                const key = denialDedupeKey(toolName, denial?.tool_input ?? denial?.toolInput);
                // canUseTool 拒绝的那次会再次出现在终态里（r5 实测）；同一次越界
                // 只上报一条，剩下的（如被规则直接拒、从未到达回调的）照常上报。
                if (reportedDenials.has(key)) continue;
                approvalHandler?.(approvalKindForTool(toolName), {
                    itemId: denial?.tool_use_id || denial?.toolUseId || toolName,
                    tool: toolName,
                });
            }
        }
        for (const handler of [...eventHandlers]) handler(message.type, message);
    }

    /**
     * M4 之前的审批答案永远是拒绝（fail-closed），但拒绝必须对 owner 可见：
     * 上报走与 codex requestApproval、CLI permission_denials 相同的通道，且发生在
     * 工具执行之前——这就是 SCN-FWB-043 的「事前拒绝即上报」。不 await 上报结果：
     * 无论控制面听没听到，答案都是拒绝。
     */
    async function canUseTool(toolName, input) {
        const name = String(toolName || 'unknown');
        reportedDenials.add(denialDedupeKey(name, input));
        preDenialSeq += 1;
        approvalHandler?.(approvalKindForTool(name), {
            itemId: `pre-denial-${preDenialSeq}`,
            tool: name,
        });
        return {
            behavior: 'deny',
            message: 'Executor declined (fail-closed until M4 approvals land).',
            interrupt: false,
        };
    }

    function assertBillingSource(initMessage) {
        const source = String(initMessage?.apiKeySource ?? '');
        if (source === 'none') return;
        const error = new Error(
            `EXECUTOR_BILLING_SOURCE_NOT_ALLOWED: init reported apiKeySource="${source}" — ` +
                'a stray API key silently preempts the subscription login and switches billing to pay-per-token'
        );
        error.code = 'EXECUTOR_BILLING_SOURCE_NOT_ALLOWED';
        error.errorCode = BILLING_SOURCE_ERROR_CODE;
        throw error;
    }

    async function consume(stream) {
        try {
            for await (const message of stream) {
                if (message?.type === 'system' && message.subtype === 'init') {
                    try {
                        assertToolSurfaceAllowed(message.tools, {
                            allowlist: toolAllowlistFor(policy),
                        });
                        assertBillingSource(message);
                    } catch (error) {
                        // 越界即拒绝开跑：abort 掉 SDK 会话（r6 实测取消后零孤儿
                        // 进程），让 beginTurn 抛出带协议错误码的错误。
                        killed = true;
                        abortController.abort();
                        onInit?.reject(error);
                        return;
                    }
                    onInit?.resolve(String(message.session_id || ''));
                }
                emit(message);
            }
            // 流正常走完却没有终态：与 CLI「进程退出但没给 result」同一形状，
            // 立刻走 C4 兜底，不干等 turn 超时。
            if (!terminalSeen && !killed) {
                const error = new Error(
                    'EXECUTOR_PROVIDER_EXITED: sdk stream ended without result'
                );
                error.code = 'EXECUTOR_PROVIDER_EXITED';
                onInit?.reject(error);
                for (const handler of [...exitHandlers]) handler(error);
            }
        } catch (error) {
            // 纪律 1：终态已 yield 过再 throw（错误终态、abort）是正常收尾。
            if (terminalSeen || killed) return;
            const wrapped = new Error(
                `EXECUTOR_PROVIDER_EXITED: sdk query failed (${String(error?.message ?? error)})`
            );
            wrapped.code = 'EXECUTOR_PROVIDER_EXITED';
            wrapped.cause = error;
            onInit?.reject(wrapped);
            for (const handler of [...exitHandlers]) handler(wrapped);
        }
    }

    return {
        provider: 'claude-code',
        transport: 'sdk',
        policy,

        /** SDK 的 prompt 在 query() 调用时交出，所以真正开跑在 openSession。 */
        start() {
            started = true;
        },

        onEvent(handler) {
            eventHandlers.push(handler);
        },

        onApprovalRequest(handler) {
            approvalHandler = handler;
        },

        onExit(handler) {
            exitHandlers.push(handler);
        },

        async openSession({ prompt, timeoutMs = INIT_TIMEOUT_MS } = {}) {
            if (!started) {
                const error = new Error('EXECUTOR_SESSION_NOT_STARTED: call start() first');
                error.code = 'EXECUTOR_SESSION_NOT_STARTED';
                throw error;
            }
            const sessionId = await new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`EXECUTOR_PROVIDER_INIT_TIMEOUT (${timeoutMs}ms)`)),
                    Math.min(timeoutMs, INIT_TIMEOUT_MS)
                );
                onInit = {
                    resolve: (value) => {
                        clearTimeout(timer);
                        resolve(value);
                    },
                    reject: (error) => {
                        clearTimeout(timer);
                        reject(error);
                    },
                };
                let stream;
                try {
                    stream = queryFn({
                        prompt: String(prompt ?? ''),
                        options: {
                            ...options,
                            ...(cwd ? { cwd } : {}),
                            ...(env ? { env } : {}),
                            abortController,
                            canUseTool,
                            ...(onStderr ? { stderr: (line) => onStderr(String(line)) } : {}),
                        },
                    });
                } catch (error) {
                    onInit.reject(error);
                    return;
                }
                void consume(stream);
            });
            return { sessionId };
        },

        /** prompt 已在 openSession 时交给 query()；这里没有第二步。 */
        async startTurn() {},

        kill() {
            killed = true;
            try {
                abortController.abort();
            } catch {
                // abort 可重入，无需处理。
            }
        },
    };
}
