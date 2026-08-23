/**
 * 控制面 HTTP 客户端（M3-T3 的执行器侧）。
 *
 * 架构约束（不可协商）：执行器**出站**发起一切连接，控制面从不入站调用执行器。
 * 四个端点统一 bearer 认证；事件与审批上报都带 `executorId + leaseId + epoch` 信封，
 * 旧 epoch 会收到 409 `FEEDBACK_EXECUTOR_LEASE_STALE`——这不是可重试错误，
 * 说明租约已易主，本进程必须立刻停止对该 Run 的一切写入（SCN-FWB-035）。
 */
export class StaleLeaseError extends Error {
    constructor() {
        super('FEEDBACK_EXECUTOR_LEASE_STALE');
        this.code = 'FEEDBACK_EXECUTOR_LEASE_STALE';
    }
}

export function createControlPlaneClient({ origin, token, fetch: fetchImpl = fetch } = {}) {
    const base = String(origin || '').replace(/\/+$/, '');
    if (!base) throw new Error('EXECUTOR_CONTROL_PLANE_ORIGIN_REQUIRED');
    if (!String(token || '').trim()) throw new Error('EXECUTOR_CONTROL_PLANE_TOKEN_REQUIRED');

    async function post(path, body, { bearer = token } = {}) {
        const response = await fetchImpl(`${base}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify(body),
        });
        if (response.status === 204) return null;
        let payload = null;
        try {
            payload = await response.json();
        } catch {
            payload = null;
        }
        if (response.status === 409 && payload?.error === 'FEEDBACK_EXECUTOR_LEASE_STALE') {
            throw new StaleLeaseError();
        }
        if (!response.ok) {
            const error = new Error(payload?.error || `CONTROL_PLANE_HTTP_${response.status}`);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    return {
        /** 领取一个 Run；无活可领返回 null（204）。 */
        claimLease({ executorId, capabilities, leaseSeconds }) {
            return post('/api/executor/lease', { executorId, capabilities, leaseSeconds });
        },

        /** 认领活跃 Release（SCN-FWB-033 阶段二）；无活可领返回 null（204）。 */
        claimRelease() {
            return post('/api/executor/release', {});
        },

        /**
         * 上报 Release 进度事件。认证用认领时下发的 release token（不是执行器
         * bearer——与 GitHub 交付线走同一道 §21.3 闸）。重复 eventId 服务端幂等。
         */
        postReleaseEvent({ releaseId, releaseToken, event }) {
            return post(`/api/feedback/releases/${encodeURIComponent(releaseId)}/events`, event, {
                bearer: releaseToken,
            });
        },

        /** 续租；返回 { commands: [...] }（M4 起决议指令搭这班顺风车下行）。 */
        heartbeat({ executorId, leaseId, runId, epoch, leaseSeconds }) {
            return post('/api/executor/heartbeat', {
                executorId,
                leaseId,
                runId,
                epoch,
                leaseSeconds,
            });
        },

        /** 上报一条协议 v0 事件。幂等：Worker 按 eventId 去重。 */
        postEvent({ executorId, leaseId, epoch, runId, event }) {
            return post(`/api/executor/runs/${encodeURIComponent(runId)}/events`, {
                executorId,
                leaseId,
                epoch,
                event,
            });
        },

        /** 上报一次审批请求（本期只入库成 HumanAction，决议下行属于 M4）。 */
        postApproval({ executorId, leaseId, epoch, runId, requestId, kind, summary, details }) {
            return post('/api/executor/approvals', {
                executorId,
                leaseId,
                epoch,
                runId,
                requestId,
                kind,
                summary,
                details,
            });
        },
    };
}

/**
 * 代理环境变量解析（SCN-FWB-035）。返回 `{ httpProxy, httpsProxy, noProxy, sourceVars }`
 * 或 null（没设任何代理变量）。
 *
 * 为什么执行器要自己管代理：Node 22 的全局 `fetch`（undici）不读 `HTTP(S)_PROXY`，
 * S3 白名单放行代理变量只惠及 provider 子进程——执行器连控制面仍走直连。实测本机
 * 直连 Cloudflare 时断时通，守护进程隔夜日志零散堆积 `lease claim failed: fetch failed`，
 * 而同机经代理的 wrangler 与 provider 全部正常。
 *
 * `ALL_PROXY` 兜底两侧，具体变量（HTTP_PROXY/HTTPS_PROXY）优先；大小写变体都认，
 * 大写优先——与 undici `EnvHttpProxyAgent` 的读取顺序一致。
 */
export function proxyConfigFrom(env = {}) {
    const pick = (...names) => {
        for (const name of names) {
            const value = String(env[name] || '').trim();
            if (value) return { name, value };
        }
        return null;
    };
    const all = pick('ALL_PROXY', 'all_proxy');
    const https = pick('HTTPS_PROXY', 'https_proxy') || all;
    const http = pick('HTTP_PROXY', 'http_proxy') || all;
    const noProxy = pick('NO_PROXY', 'no_proxy');
    if (!https && !http) return null;
    const sourceVars = [...new Set([https, http, noProxy].filter(Boolean).map((v) => v.name))];
    return {
        httpProxy: http?.value ?? '',
        httpsProxy: https?.value ?? '',
        noProxy: noProxy?.value ?? '',
        sourceVars,
    };
}

/**
 * 构造控制面用的 fetch。没设代理变量时原样返回全局 fetch（零包装）；设了就经
 * undici `EnvHttpProxyAgent` 走代理，`NO_PROXY` 照常生效。不动全局 dispatcher——
 * npm 包 undici 的 setGlobalDispatcher 与内建 fetch 的注册表是否互通取决于两者的
 * symbol 版本恰好一致，这里不赌它，用 `createControlPlaneClient` 现成的注入点。
 *
 * 代理地址可能含 userinfo（`http://user:pass@host`），按 S3 同一条纪律视同凭据：
 * 日志只提变量名，不打值。
 */
export async function resolveControlPlaneFetch({
    env = process.env,
    log = () => {},
    fetchWithDispatcher = null,
} = {}) {
    const config = proxyConfigFrom(env);
    if (!config) return globalThis.fetch;
    let fetchImpl = fetchWithDispatcher;
    let dispatcher;
    try {
        const undici = await import('undici');
        dispatcher = new undici.EnvHttpProxyAgent({
            httpProxy: config.httpProxy || undefined,
            httpsProxy: config.httpsProxy || undefined,
            noProxy: config.noProxy || undefined,
        });
        fetchImpl = fetchImpl ?? undici.fetch;
    } catch (error) {
        log(
            `[executor] proxy vars set (${config.sourceVars.join(', ')}) but undici is unavailable (${String(error?.message || error)}); control-plane fetch goes DIRECT and may hit intermittent "fetch failed"`
        );
        return globalThis.fetch;
    }
    log(
        `[executor] control-plane fetch routes through proxy from ${config.sourceVars.join(', ')} (Node fetch ignores proxy env on its own)`
    );
    return (url, options) => fetchImpl(url, { ...options, dispatcher });
}
