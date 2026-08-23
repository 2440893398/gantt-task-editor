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
import { AppServerClient } from './app-server-client.js';

export function createCodexSession({ client, workspaceDir, createClient } = {}) {
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
            // AppServerClient 把 spawn 失败与进程退出都表现为在途 request 失败；
            // 显式的退出通知是可选能力，缺席时由 request 超时兜底。
            server.onExit?.(handler);
        },
        /**
         * 开会话与开一轮分成两步，是为了让 sessionId 在**任何 turn 事件之前**就确定——
         * 否则先到的事件会缺 providerSessionId，而那正是会话续接唯一的凭据。
         */
        async openSession() {
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
