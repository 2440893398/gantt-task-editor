/**
 * Agent 浏览器通道预检 —— 判定层（纯函数，不碰文件系统）。
 *
 * 为什么判定要独立于探测：探测读的全是外部工具的私有格式（`~/.codex/browser/config.toml`
 * 的节名、`~/.claude.json` 的结构、扩展 ID、Chrome profile 目录布局）。任何一项随版本
 * 漂移，探测就会读错。判定独立出来才能用 fixture 把决策表钉死，漂移时错的是探测层，
 * 不会连带把决策逻辑一起改坏。
 *
 * 三个终态：
 *   GO      —— 找到可用通道。注意语义：**只许可连接**。静态预检与实际连接之间没有
 *              原子性（用户中途换 profile、Codex 连一半退 IAB，预检都测不到），
 *              所以运行时自报家门通过才算放行写入。
 *   NO-GO   —— 高置信度的阻塞：证据完整且可用通道为零。处置是停、把修复步骤交用户。
 *   UNKNOWN —— 证据不完整（非 Windows、配置文件缺失、格式不认识）。处置是允许连接，
 *              但运行时自报家门必须通过才准写入。误 NO-GO 会把本来能干活的 Agent
 *              劝停且无人复核，所以拿不准一律走 UNKNOWN。
 */

export const STATES = Object.freeze({ GO: 'GO', NO_GO: 'NO-GO', UNKNOWN: 'UNKNOWN' });

const RUNTIME_SELF_CHECK = [
    "evaluate: location.origin + ' | ' + (await window.app.project.list()).data.find(p => p.active)?.name",
    '比对 origin 与用户口述的项目名；对不上就停，不要写入。',
];

function codexFixSnippet(origin) {
    return [
        '在 ~/.codex/browser/config.toml 的这两个数组里加上该 origin，然后重启 Codex：',
        '',
        '  [origins]',
        `  allowed = [ ..., "${origin}" ]`,
        '',
        '  [full_cdp]',
        `  allowed = [ ..., "${origin}" ]`,
    ];
}

/**
 * @param {object} probes 探测层输出
 * @returns {{channel: string, available: boolean|null, reason: string, userActions?: string[]}[]}
 */
function evaluateChannels(probes) {
    const { nativeHosts, codexBrowser, playwrightMcp = [], origin } = probes;
    const results = [];

    // Claude in Chrome —— 原生桥注册项是硬信号；扩展目录只是旁证。
    if (!nativeHosts?.supported) {
        results.push({
            channel: 'claude-in-chrome',
            available: null,
            reason: '无法读取原生消息桥注册表（非 Windows 或不可读）。',
        });
    } else if (nativeHosts.claude || nativeHosts.claudeCode) {
        results.push({
            channel: 'claude-in-chrome',
            available: true,
            reason: '原生消息桥已注册。',
        });
    } else {
        results.push({
            channel: 'claude-in-chrome',
            available: false,
            reason: '未注册 com.anthropic.claude_browser_extension。',
            userActions: ['安装 Claude in Chrome 扩展并登录，再重跑预检。'],
        });
    }

    // Codex chrome 后端 —— 桥装了还不够，origin 白名单才是它退 IAB 的真凶。
    if (!nativeHosts?.supported) {
        results.push({
            channel: 'codex-chrome',
            available: null,
            reason: '无法读取原生消息桥注册表。',
        });
    } else if (!nativeHosts.codex) {
        results.push({
            channel: 'codex-chrome',
            available: false,
            reason: '未注册 com.openai.codexextension。',
            userActions: ['安装 Codex 的 Chrome 扩展（ChatGPT 扩展）并登录。'],
        });
    } else if (!codexBrowser?.found) {
        results.push({
            channel: 'codex-chrome',
            available: null,
            reason: '找不到 ~/.codex/browser/config.toml，无法判断 origin 白名单。',
        });
    } else if (!codexBrowser.parsed) {
        results.push({
            channel: 'codex-chrome',
            available: null,
            reason: '~/.codex/browser/config.toml 格式不认识（可能是版本升级导致），无法判断白名单。',
        });
    } else if (codexBrowser.originAllowed && codexBrowser.fullCdpAllowed) {
        results.push({
            channel: 'codex-chrome',
            available: true,
            reason: 'origin 同时在 [origins].allowed 与 [full_cdp].allowed 中。',
        });
    } else {
        const missing = [
            codexBrowser.originAllowed ? null : '[origins].allowed',
            codexBrowser.fullCdpAllowed ? null : '[full_cdp].allowed',
        ].filter(Boolean);
        results.push({
            channel: 'codex-chrome',
            available: false,
            reason: `origin 不在 ${missing.join(' 与 ')} 中${
                codexBrowser.approvalMode === 'never_ask'
                    ? '，且 approval_mode = never_ask —— 不会弹窗询问，会直接拒绝并静默退到 IAB'
                    : ''
            }。`,
            userActions: codexFixSnippet(origin),
        });
    }

    // playwright MCP —— 裸配置每个实例开独立 profile，看不到用户数据。
    const attached = playwrightMcp.filter((entry) => entry.attached);
    if (playwrightMcp.length === 0) {
        results.push({
            channel: 'playwright-cdp',
            available: null,
            reason: '没有读到任何 playwright MCP 配置。',
        });
    } else if (attached.length > 0) {
        results.push({
            channel: 'playwright-cdp',
            available: true,
            reason: `已接管真实浏览器：${attached.map((entry) => entry.source).join('、')}。`,
        });
    } else {
        results.push({
            channel: 'playwright-cdp',
            available: false,
            reason: `配置为裸启动（${playwrightMcp
                .map((entry) => entry.source)
                .join('、')}），每个实例开独立 profile，看不到用户数据。`,
            userActions: [
                '让 Chrome 带 --remote-debugging-port=9222 启动，',
                '并给 playwright MCP 加参数：--cdp-endpoint http://127.0.0.1:9222',
            ],
        });
    }

    return results;
}

function buildDataLocationWarning(probes) {
    const { userData, origin } = probes;
    if (!userData?.supported) {
        return {
            level: 'unknown',
            text: '无法枚举 Chrome 用户数据目录（非 Windows 或不可读），未能确认用户数据在不在本机。',
        };
    }

    const hit = userData.profiles.filter((profile) => profile.hasOrigin);
    if (hit.length > 0) {
        return {
            level: 'info',
            text: `用户数据所在 profile：${hit.map((p) => p.name).join('、')}（origin ${origin}）。扩展若装在别的 profile，操作的仍是另一份数据。`,
        };
    }

    return {
        level: 'warn',
        text: `没有任何 Chrome profile 存有 ${origin} 的 IndexedDB。可能是数据不在本机，也可能 origin 写错——Pages 的 preview 域名（如 4bed446a.xxx.pages.dev）是独立 origin、独立数据。读用户数据的任务请先确认这一条。`,
    };
}

/**
 * 决策表。输入探测结果，输出终态与处置。
 * @param {object} probes
 * @returns {{state: string, mode: string, origin: string, channels: object[], available: string[], warnings: object[], agentActions: string[], userActions: string[]}}
 */
export function decide(probes) {
    const mode = probes.mode === 'dev' ? 'dev' : 'read-user-data';
    const origin = probes.origin;

    if (mode === 'dev') {
        return {
            state: STATES.GO,
            mode,
            origin,
            channels: [],
            available: ['isolated-playwright', 'in-app-browser'],
            warnings: [],
            userActions: [],
            agentActions: [
                '本模式不读用户已有数据，隔离 profile 是对的：裸 playwright 与内置浏览器都可用，还能避免污染用户的真实浏览器。',
                '不要为此模式去接管用户的真实 Chrome。',
            ],
        };
    }

    const channels = evaluateChannels(probes);
    const available = channels.filter((c) => c.available === true).map((c) => c.channel);
    const undetermined = channels.some((c) => c.available === null);
    const dataWarning = buildDataLocationWarning(probes);
    const warnings = [dataWarning, ...(probes.warnings || [])].filter(Boolean);

    if (available.length > 0) {
        return {
            state: STATES.GO,
            mode,
            origin,
            channels,
            available,
            warnings,
            userActions: [],
            agentActions: [
                `可用通道（自己选一个你实际具备的）：${available.join('、')}。`,
                'GO 只许可连接，不等于放行写入。连上后先跑自报家门：',
                ...RUNTIME_SELF_CHECK,
                '禁止使用内置浏览器 / IAB / 裸 playwright —— 它们是独立 profile，看不到用户数据。',
            ],
        };
    }

    if (undetermined || !probes.nativeHosts?.supported) {
        return {
            state: STATES.UNKNOWN,
            mode,
            origin,
            channels,
            available,
            warnings,
            userActions: [],
            agentActions: [
                '证据不完整，预检不下结论。允许尝试连接，但运行时自报家门必须通过才准写入：',
                ...RUNTIME_SELF_CHECK,
                '自报家门失败就停，不要退到内置浏览器 / IAB 继续干。',
            ],
        };
    }

    return {
        state: STATES.NO_GO,
        mode,
        origin,
        channels,
        available,
        warnings,
        userActions: channels.flatMap((c) => c.userActions || []),
        agentActions: [
            '没有任何通道能到达用户的数据。停下，把上面的修复步骤交给用户。',
            '不要退到内置浏览器 / IAB —— 那里看得到一个能用的页面，但那是另一份数据，你会白干。',
        ],
    };
}
