/**
 * [SCN-FWB-035] provider 可执行文件解析——Windows 的 .cmd 包装陷阱。
 *
 * 坏行为画像：`spawn('codex')` / `spawn('claude')` 在 Windows 上 ENOENT（PATH 上都是
 * npm 的 .cmd 包装），且 spawn 失败若不接 'error' 事件会打死整个执行器进程。
 * 两个引擎踩的是同一个坑，冒烟实测各抓到一次。
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppServerClient } from '../executor/app-server-client.js';
import { resolveClaudeCommand, resolveCodexCommand } from '../executor/provider-command.js';

describe('[SCN-FWB-035] resolveCodexCommand', () => {
    it('显式 override 优先，原样使用', () => {
        expect(resolveCodexCommand({ override: 'D:\\tools\\codex.exe' })).toBe(
            'D:\\tools\\codex.exe'
        );
    });

    it('win32 上优先直连 npm vendor 的原生 exe——进程树里不留中间 shell', () => {
        const resolved = resolveCodexCommand({
            platform: 'win32',
            appData: 'C:\\Users\\dev\\AppData\\Roaming',
            exists: (path) => path.endsWith('codex.exe'),
        });
        expect(resolved).toMatch(/codex-win32-x64/);
        expect(resolved).toMatch(/codex\.exe$/);
    });

    it('vendor exe 不存在或非 Windows 时回落 PATH 上的 codex', () => {
        expect(
            resolveCodexCommand({
                platform: 'win32',
                appData: 'C:\\Users\\dev\\AppData\\Roaming',
                exists: () => false,
            })
        ).toBe('codex');
        expect(resolveCodexCommand({ platform: 'linux' })).toBe('codex');
    });
});

describe('[SCN-FWB-035] resolveClaudeCommand', () => {
    it('显式 override 优先，原样使用', () => {
        expect(resolveClaudeCommand({ override: 'D:\\tools\\claude.exe' })).toBe(
            'D:\\tools\\claude.exe'
        );
    });

    it('win32 上优先直连 npm 包自带的原生 exe', () => {
        const resolved = resolveClaudeCommand({
            platform: 'win32',
            appData: 'C:\\Users\\dev\\AppData\\Roaming',
            exists: (path) => path.endsWith('claude.exe'),
        });
        expect(resolved).toMatch(/@anthropic-ai/);
        expect(resolved).toMatch(/claude\.exe$/);
    });

    it('vendor exe 不存在或非 Windows 时回落 PATH 上的 claude', () => {
        expect(
            resolveClaudeCommand({
                platform: 'win32',
                appData: 'C:\\Users\\dev\\AppData\\Roaming',
                exists: () => false,
            })
        ).toBe('claude');
        expect(resolveClaudeCommand({ platform: 'darwin' })).toBe('claude');
    });
});

describe('[SCN-FWB-035] spawn 失败不打死执行器', () => {
    it("'error' 事件让在途与后续 request 都拒绝，而不是抛未处理异常", async () => {
        const handlers = {};
        const fakeProc = {
            on: (event, handler) => {
                handlers[event] = handler;
            },
            once: (event, handler) => {
                handlers[event] = handler;
            },
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            stdin: { write: () => {} },
            kill: () => {},
            exitCode: null,
        };
        const client = new AppServerClient({ spawn: () => fakeProc });
        client.start();

        const inflight = client.request('initialize', {}, { timeoutMs: 5000 });
        handlers.error(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' }));
        await expect(inflight).rejects.toThrow('ENOENT');
        await expect(client.request('thread/start', {})).rejects.toThrow('ENOENT');
    });
});
