/**
 * provider 可执行文件解析（Windows 陷阱，两次冒烟实测）。
 *
 * PATH 上的 `codex` / `claude` 在 Windows 上都是 npm 的 `.cmd` 包装——`spawn()` 不走
 * shell 直接 ENOENT，走 shell 又会在进程树里插一层 cmd.exe，kill 信号到不了真正的
 * 子进程（M0 的 SIGKILL 实验依赖信号能到达）。两个 npm 包都随包携带原生 exe，
 * 优先直连它。
 *
 * 解析失败时回落到裸命令名而不是抛错：非 Windows、或用户用别的方式安装时，
 * 裸命令是对的；真的不存在会在 spawn 的 'error' 事件里现形，而那条路径两个
 * 会话实现都已接住。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function resolveNpmVendorExe({ override, platform, appData, exists, fallback, segments }) {
    const explicit = String(override || '').trim();
    if (explicit) return explicit;
    if (platform === 'win32' && appData) {
        const vendorExe = join(appData, 'npm', 'node_modules', ...segments);
        if (exists(vendorExe)) return vendorExe;
    }
    return fallback;
}

export function resolveCodexCommand({
    override = '',
    platform = process.platform,
    appData = process.env.APPDATA || '',
    exists = existsSync,
} = {}) {
    return resolveNpmVendorExe({
        override,
        platform,
        appData,
        exists,
        fallback: 'codex',
        segments: [
            '@openai',
            'codex',
            'node_modules',
            '@openai',
            'codex-win32-x64',
            'vendor',
            'x86_64-pc-windows-msvc',
            'bin',
            'codex.exe',
        ],
    });
}

export function resolveClaudeCommand({
    override = '',
    platform = process.platform,
    appData = process.env.APPDATA || '',
    exists = existsSync,
} = {}) {
    return resolveNpmVendorExe({
        override,
        platform,
        appData,
        exists,
        fallback: 'claude',
        segments: ['@anthropic-ai', 'claude-code', 'bin', 'claude.exe'],
    });
}

export const PROVIDER_COMMAND_RESOLVERS = Object.freeze({
    codex: resolveCodexCommand,
    'claude-code': resolveClaudeCommand,
});
