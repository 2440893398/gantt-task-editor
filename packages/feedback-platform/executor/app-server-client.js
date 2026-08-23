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

export class AppServerClient {
    constructor({
        command = 'codex',
        args = ['app-server'],
        env,
        spawn = nodeSpawn,
        onStderr = null,
    } = {}) {
        this.command = command;
        this.args = args;
        this.env = env;
        this.spawn = spawn;
        this.onStderr = onStderr;
        this.nextId = 1;
        this.pending = new Map();
        this.notificationHandlers = [];
        this.serverRequestHandler = null;
        this.proc = null;
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
            for (const [id, pending] of [...this.pending]) {
                this.pending.delete(id);
                pending.reject(error);
            }
        });
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
        this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n');
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

    kill(signal = 'SIGKILL') {
        this.proc?.kill(signal);
    }

    async waitExit() {
        if (!this.proc || this.proc.exitCode !== null) return this.proc?.exitCode;
        return new Promise((resolve) => this.proc.once('exit', (code) => resolve(code)));
    }
}
