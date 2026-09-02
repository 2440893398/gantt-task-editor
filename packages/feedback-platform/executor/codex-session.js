/**
 * codex app-server 的 ProviderSession 实现（SCN-FWB-032）。
 *
 * ProviderSession 是 run-loop 认识的**唯一**执行引擎接口，四件事而已：
 *   start()                      起进程
 *   onEvent(fn) / onApprovalRequest(fn) / onExit(fn)
 *   beginTurn({prompt,timeoutMs}) → { sessionId }   开一轮，事件随后从 onEvent 流出
 *   kill()
 * run-loop 里的租约信封、重试、心跳、C4 兜底与 provider 无关，因此只有一份。
 *
 * 本文件保留 codex 侧的只读会话配置：工作区只读 + 永不弹本地审批
 * （审批一律经协议上报，见 run-loop 的 fail-closed 说明）。
 */
import { isWriteCapablePolicy } from '../../../src/features/feedback/feedback-prompt.js';
import { AppServerClient } from './app-server-client.js';

export function createCodexSession({ client, workspaceDir, createClient, policy = '' } = {}) {
    const server = client ?? createClient?.() ?? new AppServerClient();
    let threadId = '';

    return {
        provider: 'codex',
        start() {
            server.start();
        },
        onEvent(handler) {
            server.onNotification(handler);
        },
        onApprovalRequest(handler) {
            server.onServerRequest(handler);
        },
        onExit(handler) {
            // 代码评审 §3.5：这里原本写的是 `server.onExit?.(handler)`——而
            // AppServerClient 当时根本没有 onExit，可选链把「接口没实现」变成了一次
            // 静默的空操作。run-loop 靠这个回调在 provider 中途死掉时立刻走 C4 兜底；
            // 注册失败 = 那条路永不触发 = 干等 30 分钟 turn 超时。缺接口必须响亮失败。
            if (typeof server.onExit !== 'function') {
                const error = new Error(
                    'EXECUTOR_SESSION_ONEXIT_MISSING: app-server client does not report process exit'
                );
                error.code = 'EXECUTOR_SESSION_ONEXIT_MISSING';
                throw error;
            }
            server.onExit(handler);
        },
        /**
         * 开会话与开一轮分成两步，是为了让 sessionId 在**任何 turn 事件之前**就确定——
         * 否则先到的事件会缺 providerSessionId，而那正是会话续接唯一的凭据。
         */
        async openSession() {
            // 代码评审 §3.4：codex 的会话恒为只读沙箱（下面那行 `sandbox: 'read-only'`
            // 与 policy 无关），所以写入型 Run 派到这里必然以 no_changes_produced 收场，
            // 白烧一次修复回路名额。能力申报侧已按 provider 收窄（main.js），这里是
            // 第二道：万一控制面仍派下来，说清楚原因，而不是假装干了一轮活。
            if (isWriteCapablePolicy(policy)) {
                const error = new Error(
                    `EXECUTOR_PROVIDER_CANNOT_WRITE: codex sessions are read-only sandboxes; policy "${policy}" needs write access`
                );
                error.code = 'EXECUTOR_PROVIDER_CANNOT_WRITE';
                error.errorCode = 'executor_provider_cannot_write';
                throw error;
            }
            await server.initialize();
            const thread = await server.request('thread/start', {
                cwd: workspaceDir,
                // 读取型 Run：工作区只读 + 永不弹本地审批。
                sandbox: 'read-only',
                approvalPolicy: 'never',
            });
            const sessionId = thread?.threadId ?? thread?.thread?.id ?? thread?.id ?? '';
            threadId = sessionId;
            return { sessionId };
        },

        async startTurn({ prompt, timeoutMs }) {
            await server.request(
                'turn/start',
                { threadId, input: [{ type: 'text', text: prompt }] },
                { timeoutMs }
            );
        },
        kill() {
            server.kill();
        },
    };
}
