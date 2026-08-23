/**
 * [SCN-FWB-035] 执行器自身的出站请求必须尊重代理环境变量。
 *
 * 坏行为画像（2026-08-21/22 隔夜日志实测）：Node 22 的全局 `fetch`（undici）不读
 * `HTTP(S)_PROXY`，执行器连控制面走直连；本机直连 Cloudflare 时断时通，于是守护进程
 * 日志里零散堆积 `lease claim failed: fetch failed`，而同机的 wrangler 与 provider
 * 子进程（S3 已放行代理变量）全部经代理正常。S3 的放行只惠及子进程——执行器自己的
 * fetch 需要显式接上代理。
 *
 * 代理地址可能含 userinfo（`http://user:pass@host`），按 S3 同一条纪律视同凭据：
 * 日志只准提变量名，不准打值。
 */
import { describe, expect, it, vi } from 'vitest';
import { proxyConfigFrom, resolveControlPlaneFetch } from '../executor/control-plane.js';

describe('[SCN-FWB-035] proxyConfigFrom——代理环境变量解析', () => {
    it('没有任何代理变量时返回 null（保持直连，不引入 undici 依赖）', () => {
        expect(proxyConfigFrom({})).toBeNull();
        expect(proxyConfigFrom({ HTTPS_PROXY: '   ' })).toBeNull();
    });

    it('HTTPS_PROXY/HTTP_PROXY 大小写变体都被识别，NO_PROXY 一并透传', () => {
        expect(
            proxyConfigFrom({
                HTTPS_PROXY: 'http://127.0.0.1:10808',
                HTTP_PROXY: 'http://127.0.0.1:10809',
                NO_PROXY: 'localhost,127.0.0.1',
            })
        ).toEqual({
            httpProxy: 'http://127.0.0.1:10809',
            httpsProxy: 'http://127.0.0.1:10808',
            noProxy: 'localhost,127.0.0.1',
            sourceVars: ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'],
        });
        expect(proxyConfigFrom({ https_proxy: 'http://127.0.0.1:10808' })?.httpsProxy).toBe(
            'http://127.0.0.1:10808'
        );
    });

    it('ALL_PROXY 兜底到 http 与 https 两侧，但被更具体的变量覆盖', () => {
        const config = proxyConfigFrom({
            ALL_PROXY: 'http://all:1',
            HTTPS_PROXY: 'http://specific:2',
        });
        expect(config.httpsProxy).toBe('http://specific:2');
        expect(config.httpProxy).toBe('http://all:1');
    });
});

describe('[SCN-FWB-035] resolveControlPlaneFetch——控制面 fetch 经代理', () => {
    it('无代理变量时原样返回全局 fetch（零包装，行为不变）', async () => {
        const log = vi.fn();
        const fetchImpl = await resolveControlPlaneFetch({ env: {}, log });
        expect(fetchImpl).toBe(globalThis.fetch);
        expect(log).not.toHaveBeenCalled();
    });

    it('有代理变量时返回带 dispatcher 的包装 fetch，且日志只提变量名不打值', async () => {
        const log = vi.fn();
        const secret = 'http://user:hunter2@127.0.0.1:10808';
        const fetchImpl = await resolveControlPlaneFetch({
            env: { HTTPS_PROXY: secret },
            log,
        });
        expect(fetchImpl).not.toBe(globalThis.fetch);
        expect(fetchImpl).toBeTypeOf('function');
        expect(log).toHaveBeenCalled();
        const logged = log.mock.calls.flat().join(' ');
        expect(logged).toContain('HTTPS_PROXY');
        expect(logged).not.toContain('hunter2');
        expect(logged).not.toContain('10808');
    });

    it('包装 fetch 把 dispatcher 传给底层 fetch，调用方选项原样保留', async () => {
        const calls = [];
        const fetchImpl = await resolveControlPlaneFetch({
            env: { HTTPS_PROXY: 'http://127.0.0.1:10808' },
            log: () => {},
            fetchWithDispatcher: async (url, options) => {
                calls.push({ url, options });
                return { status: 204, ok: true };
            },
        });
        await fetchImpl('https://example.test/api', { method: 'POST', body: '{}' });
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://example.test/api');
        expect(calls[0].options.method).toBe('POST');
        expect(calls[0].options.body).toBe('{}');
        expect(calls[0].options.dispatcher).toBeTruthy();
    });
});
