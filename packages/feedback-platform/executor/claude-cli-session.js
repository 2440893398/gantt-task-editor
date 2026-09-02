/**
 * Claude Code CLI 的 ProviderSession 实现（SCN-FWB-032 / SCN-FWB-035 S6）。
 *
 * 传输是 `claude -p --output-format stream-json`：每行一条 JSON，进程一轮一命。
 * 与 codex 的 JSON-RPC 相比少一样东西——**没有服务端 → 客户端的审批请求通道**。
 * 这不是"审批更宽松"，恰恰相反：非交互模式下未获许可的工具调用直接被拒，
 * 结果记在终态事件的 `permission_denials` 里。执行器把每一条转成 HumanAction 上报，
 * 语义与 codex 路径拒绝 requestApproval 后上报是一致的。
 *
 * **S6 工具暴露面闸在这里落地**：init 事件带 provider 实报的工具集，出现只读白名单
 * 以外的任何工具，本会话立刻杀进程并让 beginTurn 抛错——不打警告继续。实测
 * `--allowed-tools` 根本不收窄工具面（见 tool-policy.js 的说明），所以这道闸不是冗余
 * 检查，而是唯一的保证。
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { assertToolSurfaceAllowed, toolAllowlistFor } from './tool-policy.js';
import { defaultKillTree } from './verification.js';

const INIT_TIMEOUT_MS = 120 * 1000;

/**
 * 被拒工具 → HumanAction 类别。按工具的**能力**分类而不是按名字随手归一类：
 * 一次被拒的 `Bash` 和一次被拒的 `Read` 对 owner 的意义完全不同。
 */
const COMMAND_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell']);
const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function approvalKindForTool(toolName) {
    if (COMMAND_TOOLS.has(toolName)) return 'command_execution';
    if (FILE_WRITE_TOOLS.has(toolName)) return 'file_change';
    return 'permissions';
}

export function createClaudeCliSession({
    command = 'claude',
    args = [],
    env,
    cwd,
    spawn = nodeSpawn,
    onStderr = null,
    killTree = defaultKillTree,
    // S6 闸按 policy 取白名单。argv（buildSessionArgs）与这道闸必须由同一个
    // context.policy 驱动——分开传两个来源就会出现「argv 是写入态、闸是只读态」
    // 的接线洞，届时每条写入型 Run 都会在 init 上被闸当场杀掉。缺省即只读。
    policy = '',
} = {}) {
    let proc = null;
    let spawnError = null;
    let terminalSeen = false;
    const eventHandlers = [];
    const exitHandlers = [];
    let onInit = null;
    let approvalHandler = null;

    function emit(message) {
        if (message?.type === 'result') {
            terminalSeen = true;
            // 非交互模式下被拒的工具调用记在终态事件里。每一条转成一次审批上报，
            // 与 codex 路径拒绝 requestApproval 后上报 HumanAction 语义一致——
            // 「Agent 想做但没被允许」这件事必须对 owner 可见，不能只留在日志里。
            for (const denial of message.permission_denials ?? []) {
                const toolName = String(denial?.tool_name || denial?.toolName || 'unknown');
                approvalHandler?.(approvalKindForTool(toolName), {
                    itemId: denial?.tool_use_id || denial?.toolUseId || toolName,
                    tool: toolName,
                });
            }
        }
        for (const handler of [...eventHandlers]) handler(message.type, message);
    }

    return {
        provider: 'claude-code',
        // 只读介绍字段：让接线测试能断言「policy 真的传到了会话层」。
        policy,

        start() {
            proc = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
                ...(cwd ? { cwd } : {}),
                ...(env ? { env } : {}),
            });
            // spawn 失败是 'error' 事件不是异常；不接住会打死执行器进程
            // （codex 路径上实测过一次，同一个坑不踩第二遍）。
            proc.on('error', (error) => {
                spawnError = error;
                onInit?.reject(error);
                for (const handler of [...exitHandlers]) handler(error);
            });
            createInterface({ input: proc.stdout }).on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                let message;
                try {
                    message = JSON.parse(trimmed);
                } catch {
                    // CLI 偶尔会往 stdout 写非 JSON 的诊断行；忽略而不是整轮失败。
                    return;
                }
                if (message?.type === 'system' && message.subtype === 'init') {
                    try {
                        assertToolSurfaceAllowed(message.tools, {
                            allowlist: toolAllowlistFor(policy),
                        });
                    } catch (error) {
                        // 越界即拒绝开跑：先杀进程，再让 beginTurn 抛出带协议
                        // errorCode 的错误，run-loop 的 C4 兜底负责送到终态。
                        try {
                            proc?.kill('SIGKILL');
                        } catch {
                            // 进程可能已退出。
                        }
                        onInit?.reject(error);
                        return;
                    }
                    onInit?.resolve(String(message.session_id || ''));
                }
                emit(message);
            });
            if (proc.stderr) {
                createInterface({ input: proc.stderr }).on('line', (line) => onStderr?.(line));
            }
            proc.on('close', (code) => {
                if (!terminalSeen) {
                    const error = new Error(`EXECUTOR_PROVIDER_EXITED: claude exited (${code})`);
                    error.code = 'EXECUTOR_PROVIDER_EXITED';
                    onInit?.reject(error);
                    for (const handler of [...exitHandlers]) handler(error);
                }
            });
        },

        onEvent(handler) {
            eventHandlers.push(handler);
        },

        /**
         * CLI 非交互模式没有审批请求通道——未获许可的工具调用直接被拒，
         * 拒绝记录在终态事件里，由 run-loop 从 `permission_denials` 提取上报。
         */
        onApprovalRequest(handler) {
            approvalHandler = handler;
        },

        onExit(handler) {
            exitHandlers.push(handler);
        },

        /**
         * Claude Code 的 prompt 在进程启动时就要交出去（走 stdin），所以「开会话」
         * 与「送 prompt」实际是同一件事；session_id 由 init 事件带回。
         */
        async openSession({ prompt, timeoutMs = INIT_TIMEOUT_MS }) {
            if (spawnError) throw spawnError;
            if (!proc) {
                // 没有这道守卫时报的是 `Cannot read properties of null (reading 'stdin')`，
                // 运维照着这句话查不出任何东西。
                const error = new Error('EXECUTOR_SESSION_NOT_STARTED: call start() first');
                error.code = 'EXECUTOR_SESSION_NOT_STARTED';
                throw error;
            }
            const sessionId = await new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => {
                        reject(new Error(`EXECUTOR_PROVIDER_INIT_TIMEOUT (${timeoutMs}ms)`));
                    },
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
                // Prompt 走 stdin 而不是位置参数：Prompt 可以很长，而 Windows 的
                // 命令行长度上限会把它悄悄截断成一个语义不同的指令。
                proc.stdin.write(String(prompt ?? ''));
                proc.stdin.end();
            });
            return { sessionId };
        },

        /** prompt 已在 openSession 时经 stdin 送出；这里没有第二步。 */
        async startTurn() {},

        /**
         * 树级 kill（代码评审 §3.7）。`proc.kill('SIGKILL')` 只杀直接子进程，而
         * `claude` 之下还挂着它自己起的工具子进程；Windows 上更是没有进程组可杀。
         * verification.js 为此已经论证过一次（孤儿进程在超时之后又跑了 17 分钟，
         * 输出管道被孙进程握着、close 迟迟不触发）——同一条教训不在两个地方各犯一遍。
         * 先杀树再补一刀直接子进程：树级失败（进程已消亡、taskkill 不在）也不至于
         * 什么都没做。
         */
        kill(signal = 'SIGKILL') {
            const pid = proc?.pid;
            if (pid) {
                try {
                    killTree(pid);
                } catch {
                    // taskkill 不可用或树已消亡。
                }
            }
            try {
                proc?.kill(signal);
            } catch {
                // 进程可能从未启动或已退出。
            }
        },
    };
}
