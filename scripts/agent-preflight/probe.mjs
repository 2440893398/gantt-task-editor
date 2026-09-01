/**
 * Agent 浏览器通道预检 —— 探测层。
 *
 * 纪律（评审拍板）：
 * - 只读，不外发；输出**绝不回显文件内容**（~/.claude.json 可能含 MCP/账号信息），
 *   只提取判定所需的布尔与名字。
 * - 读不到、格式不认识、非 Windows —— 一律返回 supported/parsed = false，交给判定层
 *   走 UNKNOWN，绝不猜。
 * - 扩展 ID 是旁证不是硬信号：unpacked/dev 安装的 ID 与商店不同，找不到只降级为
 *   warning，硬信号是 NativeMessagingHosts 注册项。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// 商店版扩展 ID。找不到不代表没装（unpacked 安装 ID 不同），只作旁证。
const EXTENSION_IDS = {
    claude: 'fcoeoabgfenejglbffodgkkbkcdhcgfn',
    codex: 'hehggadaopoacecdllhhajmbjkdcmajg',
};

const NATIVE_HOSTS = {
    claude: 'com.anthropic.claude_browser_extension',
    claudeCode: 'com.anthropic.claude_code_browser_extension',
    codex: 'com.openai.codexextension',
};

export function originToIndexedDbDirName(origin) {
    // Chrome 的命名：https_host_0.indexeddb.leveldb（端口非默认时是端口号）
    const url = new URL(origin);
    const port = url.port || '0';
    return `${url.protocol.replace(':', '')}_${url.hostname}_${port}.indexeddb.leveldb`;
}

function chromeUserDataDir() {
    if (process.platform !== 'win32') return null;
    const local = process.env.LOCALAPPDATA;
    if (!local) return null;
    return path.join(local, 'Google', 'Chrome', 'User Data');
}

function probeUserData(origin) {
    const root = chromeUserDataDir();
    if (!root || !fs.existsSync(root)) {
        return { supported: false, profiles: [] };
    }

    const dbName = originToIndexedDbDirName(origin);
    const profiles = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name !== 'Default' && !entry.name.startsWith('Profile')) continue;

        const profileDir = path.join(root, entry.name);
        const hasOrigin = fs.existsSync(path.join(profileDir, 'IndexedDB', dbName));
        const extensionsDir = path.join(profileDir, 'Extensions');
        const extensions = {};
        for (const [key, id] of Object.entries(EXTENSION_IDS)) {
            extensions[key] = fs.existsSync(path.join(extensionsDir, id));
        }
        profiles.push({ name: entry.name, hasOrigin, extensions });
    }

    return { supported: true, profiles };
}

function probeNativeHosts() {
    if (process.platform !== 'win32') {
        return { supported: false };
    }

    let registered = new Set();
    try {
        const out = execFileSync(
            'reg',
            ['query', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        registered = new Set(
            out
                .split(/\r?\n/)
                .map((line) => line.trim().split('\\').pop())
                .filter(Boolean)
        );
    } catch {
        return { supported: false };
    }

    return {
        supported: true,
        claude: registered.has(NATIVE_HOSTS.claude),
        claudeCode: registered.has(NATIVE_HOSTS.claudeCode),
        codex: registered.has(NATIVE_HOSTS.codex),
    };
}

/**
 * 极简 TOML 片段解析：只取我们要的三样（approval_mode、[origins].allowed、
 * [full_cdp].allowed）。认不出就 parsed=false，交给 UNKNOWN，不做启发式猜测。
 */
function parseCodexBrowserConfig(text, origin) {
    const approvalMatch = /^\s*approval_mode\s*=\s*"([^"]*)"/m.exec(text);
    const sectionArray = (section) => {
        const re = new RegExp(`\\[${section}\\][\\s\\S]*?allowed\\s*=\\s*\\[([^\\]]*)\\]`, 'm');
        const match = re.exec(text);
        if (!match) return null;
        return match[1]
            .split(',')
            .map((item) => item.trim().replace(/^"|"$/g, ''))
            .filter(Boolean);
    };

    const origins = sectionArray('origins');
    const fullCdp = sectionArray('full_cdp');
    if (origins === null && fullCdp === null) {
        return { found: true, parsed: false };
    }

    const normalized = origin.replace(/\/+$/, '');
    const has = (list) =>
        Array.isArray(list) && list.some((item) => item.replace(/\/+$/, '') === normalized);

    return {
        found: true,
        parsed: true,
        approvalMode: approvalMatch ? approvalMatch[1] : null,
        originAllowed: has(origins),
        fullCdpAllowed: has(fullCdp),
    };
}

function probeCodexBrowser(origin, readPaths) {
    const file = path.join(os.homedir(), '.codex', 'browser', 'config.toml');
    readPaths.push(file);
    if (!fs.existsSync(file)) return { found: false };
    try {
        return parseCodexBrowserConfig(fs.readFileSync(file, 'utf8'), origin);
    } catch {
        return { found: true, parsed: false };
    }
}

function isAttachedArgs(args = []) {
    return args.some(
        (arg) => String(arg).includes('--cdp-endpoint') || String(arg).includes('--user-data-dir')
    );
}

function probePlaywrightMcp(readPaths) {
    const entries = [];

    const claudeConfig = path.join(os.homedir(), '.claude.json');
    readPaths.push(claudeConfig);
    if (fs.existsSync(claudeConfig)) {
        try {
            const json = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
            const server = json?.mcpServers?.playwright;
            if (server) {
                entries.push({
                    source: '~/.claude.json',
                    attached: isAttachedArgs(server.args),
                });
            }
        } catch {
            /* 格式不认识就不产出条目，交给 UNKNOWN */
        }
    }

    const codexConfig = path.join(os.homedir(), '.codex', 'config.toml');
    readPaths.push(codexConfig);
    if (fs.existsSync(codexConfig)) {
        try {
            const text = fs.readFileSync(codexConfig, 'utf8');
            const match = /\[mcp_servers\.playwright\][\s\S]*?args\s*=\s*\[([^\]]*)\]/m.exec(text);
            if (match) {
                const args = match[1].split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
                entries.push({ source: '~/.codex/config.toml', attached: isAttachedArgs(args) });
            }
        } catch {
            /* 同上 */
        }
    }

    return entries;
}

/**
 * @param {{origin: string, mode: string, readLocal: boolean}} options
 * @returns {{probes: object, readPaths: string[]}}
 */
export function probe({ origin, mode, readLocal = true }) {
    const readPaths = [];
    const warnings = [];

    if (!readLocal) {
        return {
            readPaths,
            probes: {
                origin,
                mode,
                platform: process.platform,
                userData: { supported: false, profiles: [] },
                nativeHosts: { supported: false },
                codexBrowser: { found: false },
                playwrightMcp: [],
                warnings: [
                    {
                        level: 'unknown',
                        text: '--no-local：跳过本机配置读取，结论只能是 UNKNOWN。',
                    },
                ],
            },
        };
    }

    if (process.platform !== 'win32') {
        warnings.push({
            level: 'unknown',
            text: `本机平台是 ${process.platform}；注册表与 Chrome User Data 路径的探测是 Windows-only，结论走 UNKNOWN。`,
        });
    }

    const userDataRoot = chromeUserDataDir();
    if (userDataRoot) readPaths.push(userDataRoot);
    readPaths.push('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts');

    const userData = probeUserData(origin);
    const nativeHosts = probeNativeHosts();
    const codexBrowser = probeCodexBrowser(origin, readPaths);
    const playwrightMcp = probePlaywrightMcp(readPaths);

    const anyExtensionSeen = userData.profiles.some(
        (profile) => profile.extensions.claude || profile.extensions.codex
    );
    if (userData.supported && !anyExtensionSeen) {
        warnings.push({
            level: 'warn',
            text: '没在任何 profile 里看到商店版 Claude / Codex 扩展目录。unpacked 安装的扩展 ID 不同，这条只是旁证——以原生消息桥注册项为准。',
        });
    }

    return {
        readPaths,
        probes: {
            origin,
            mode,
            platform: process.platform,
            userData,
            nativeHosts,
            codexBrowser,
            playwrightMcp,
            warnings,
        },
    };
}
