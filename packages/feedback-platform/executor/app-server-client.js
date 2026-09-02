/**
 * codex app-server 的 JSON-RPC over stdio 客户端（M3-T4）。
 *
 * 从 M0 PoC 的 client.mjs 生产化而来，保留三条实测纪律：
 * 1. 永远不发无超时的 request——V3 实验曾因此静默挂了 25 分钟；
 * 2. 服务端 → 客户端的请求（审批等）必须回，否则服务端阻塞整个 turn；
 * 3. app-server 只在本机 stdio 上被调用，绝不监听网络（架构约束，不可协商）。
 *
 * spawn 可注入：单元测试用假进程验证协议行为，不依赖真实 codex 安装。
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { defaultKillTree } from './verification.js';

export class AppServerClient {
    constructor({
        command = 'codex',
        args = ['app-server'],
        env,
        spawn = nodeSpawn,
        onStderr = null,
        killTree = defaultKillTree,
    } = {}) {
        this.command = command;
        this.args = args;
        this.env = env;
        this.spawn = spawn;
        this.onStderr = onStderr;
        this.killTree = killTree;
        this.nextId = 1;
        this.pending = new Map();
        this.notificationHandlers = [];
        this.serverRequestHandler = null;
        this.exitHandlers = [];
        this.exited = false;
        this.proc = null;
    }

    /**
     * 进程退出通知（代码评审 2026-09-02 §3.5）。
     *
     * 之前这个方法根本不存在，而 codex-session 用 `server.onExit?.(handler)` 去注册——
     * 可选链把「接口没实现」变成了一次静默的空操作（与 SCN-FWB-032 的翻译器失聪同型）。
     * 后果：codex 中途崩溃时，run-loop 那条「provider 死了就立刻走 C4 兜底」的路
     * 永远不会触发，Run 干等到 30 分钟 turn 超时。
     */
    onExit(handler) {
        this.exitHandlers.push(handler);
        return () => {
            const index = this.exitHandlers.indexOf(handler);
            if (index >= 0) this.exitHandlers.splice(index, 1);
        };
    }

    /** 进程死了：在途 request 全部立刻失败，退出监听者各收到一次通知（只发一次）。 */
    _handleExit(error) {
        if (this.exited) return;
        this.exited = true;
        for (const [id, pending] of [...this.pending]) {
            this.pending.delete(id);
            pending.reject(error);
        }
        for (const handler of [...this.exitHandlers]) handler(error);
    }

    start() {
        this.proc = this.spawn(this.command, this.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            ...(this.env ? { env: this.env } : {}),
        });
        // spawn 失败（ENOENT 等）是 'error' 事件而不是异常。不接住它会打死整个
        // 执行器进程（冒烟实测）；接住后让所有在途与后续 request 立刻失败，
        // run-loop 的 C4 兜底才有机会把 Run 送到终态。
        this.proc.on('error', (error) => {
            this.spawnError = error;
            this._handleExit(error);
        });
        // §3.5：进程退出必须是一个事件，而不是「等 request 超时」。
        this.proc.on('close', (code, signal) => {
            const error = new Error(
                `EXECUTOR_PROVIDER_EXITED: codex app-server exited (code=${code} signal=${signal ?? 'none'})`
            );
            error.code = 'EXECUTOR_PROVIDER_EXITED';
            this._handleExit(this.spawnError ?? error);
        });
        // §3.5：进程已死时往 stdin 写会以 EPIPE 冒成 unhandled stream error，
        // 打死的是**守护进程**而不是这一轮 Run。接住它，让失败留在这一轮里。
        if (typeof this.proc.stdin?.on === 'function') {
            this.proc.stdin.on('error', (error) => {
                this.stdinError = error;
            });
        }
        createInterface({ input: this.proc.stdout }).on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            let message;
            try {
                message = JSON.parse(trimmed);
            } catch {
                return;
            }
            this._dispatch(message);
        });
        if (this.proc.stderr) {
            createInterface({ input: this.proc.stderr }).on('line', (line) => {
                this.onStderr?.(line);
            });
        }
        return this;
    }

    _dispatch(message) {
        if (message.id !== undefined && message.method) {
            // 服务端请求（*/requestApproval 等）。不回则服务端阻塞。
            const handler = this.serverRequestHandler;
            Promise.resolve(
                handler ? handler(message.method, message.params, message.id) : null
            ).then(
                (result) => this._send({ id: message.id, result: result ?? {} }),
                (error) =>
                    this._send({
                        id: message.id,
                        error: { code: -32000, message: String(error?.message || error) },
                    })
            );
            return;
        }
        if (message.id !== undefined) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
            else pending.resolve(message.result);
            return;
        }
        for (const handler of [...this.notificationHandlers]) {
            handler(message.method, message.params);
        }
    }

    _send(payload) {
        try {
            this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n');
        } catch (error) {
            // §3.5：进程已死时写 stdin 会 EPIPE。抛出去就是一次 unhandled error
            // （notify 是同步调用、没人 await），死的是**守护进程**而不是这一轮 Run。
            // 记下来即可：在途 request 由 close 事件负责失败。
            this.stdinError = error;
        }
    }

    request(method, params, { timeoutMs = 300000 } = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            if (this.spawnError) {
                reject(this.spawnError);
                return;
            }
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`request timeout: ${method} (${timeoutMs}ms)`));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                },
            });
            this._send({ id, method, params });
        });
    }

    notify(method, params) {
        this._send({ method, params });
    }

    onNotification(handler) {
        this.notificationHandlers.push(handler);
        return () => {
            const index = this.notificationHandlers.indexOf(handler);
            if (index >= 0) this.notificationHandlers.splice(index, 1);
        };
    }

    onServerRequest(handler) {
        this.serverRequestHandler = handler;
    }

    async initialize({ clientName = 'feedback-executor', version = '0.0.0' } = {}) {
        // M0 实测：我们用到的方法不被 experimentalApi gate，但协议自称 experimental，
        // 仍按官方推荐带上开关，避免未来版本收紧时静默降级。
        const result = await this.request('initialize', {
            clientInfo: { name: clientName, title: 'Feedback platform executor', version },
            capabilities: { experimentalApi: true },
        });
        this.notify('initialized', {});
        return result;
    }

    /**
     * 树级 kill（§3.7）：`child.kill` 只杀直接子进程。Windows 上 app-server 之下
     * 还挂着模型进程与工具子进程，杀壳留树的后果 verification.js 已经论证过一次
     * （孤儿进程又跑了 17 分钟）。同一条教训不在两个地方各犯一遍。
     */
    kill(signal = 'SIGKILL') {
        const pid = this.proc?.pid;
        if (pid) this.killTree(pid);
        try {
            this.proc?.kill(signal);
        } catch {
            // 进程可能已退出。
        }
    }

    async waitExit() {
        if (!this.proc || this.proc.exitCode !== null) return this.proc?.exitCode;
        return new Promise((resolve) => this.proc.once('exit', (code) => resolve(code)));
    }
}
