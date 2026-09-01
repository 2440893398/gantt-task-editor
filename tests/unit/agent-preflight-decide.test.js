/**
 * 预检判定层的决策表。判定与探测分离的理由见 decide.mjs 顶部注释：探测读的全是
 * 外部工具的私有格式，会随版本漂移；决策表钉死在这里，漂移时坏的只是探测层。
 *
 * 这组用例在什么坏行为下会失败：
 * - 证据不完整时给出 NO-GO —— 会把本来能干活的 Agent 劝停，而 NO-GO 是终态，没人复核；
 * - 证据完整、零通道时给出 UNKNOWN —— 等于放行，Agent 会一路试到退 IAB；
 * - GO 的指令里漏掉"运行时自报家门" —— 静态预检与实际连接之间没有原子性；
 * - Codex 通道不可用却不给出白名单修复片段 —— 用户拿不到可执行的下一步。
 */

import { describe, expect, it } from 'vitest';
import { decide, STATES } from '../../scripts/agent-preflight/decide.mjs';

const ORIGIN = 'https://gantt-task-editor.pages.dev';

function probes(overrides = {}) {
    return {
        origin: ORIGIN,
        mode: 'read-user-data',
        platform: 'win32',
        userData: {
            supported: true,
            profiles: [{ name: 'Default', hasOrigin: true, extensions: {} }],
        },
        nativeHosts: { supported: true, claude: false, claudeCode: false, codex: false },
        codexBrowser: { found: false },
        playwrightMcp: [],
        warnings: [],
        ...overrides,
    };
}

describe('agent preflight decision table', () => {
    it('GO when a native bridge is registered, and still demands the runtime self-check', () => {
        const result = decide(
            probes({
                nativeHosts: { supported: true, claude: true, claudeCode: false, codex: false },
            })
        );

        expect(result.state).toBe(STATES.GO);
        expect(result.available).toContain('claude-in-chrome');
        expect(result.agentActions.join('\n')).toMatch(/GO 只许可连接/);
        expect(result.agentActions.join('\n')).toMatch(/project\.list/);
    });

    it('NO-GO only when evidence is complete and every channel is ruled out', () => {
        const result = decide(
            probes({
                nativeHosts: { supported: true, claude: false, claudeCode: false, codex: true },
                codexBrowser: {
                    found: true,
                    parsed: true,
                    approvalMode: 'never_ask',
                    originAllowed: false,
                    fullCdpAllowed: false,
                },
                playwrightMcp: [{ source: '~/.claude.json', attached: false }],
            })
        );

        expect(result.state).toBe(STATES.NO_GO);
        expect(result.userActions.join('\n')).toMatch(/\[full_cdp\]/);
        expect(result.userActions.join('\n')).toContain(ORIGIN);
        expect(result.agentActions.join('\n')).toMatch(/不要退到内置浏览器/);
    });

    it('UNKNOWN when the codex browser config cannot be parsed', () => {
        const result = decide(
            probes({
                nativeHosts: { supported: true, claude: false, claudeCode: false, codex: true },
                codexBrowser: { found: true, parsed: false },
                playwrightMcp: [{ source: '~/.claude.json', attached: false }],
            })
        );

        expect(result.state).toBe(STATES.UNKNOWN);
        expect(result.agentActions.join('\n')).toMatch(/运行时自报家门必须通过才准写入/);
    });

    it('UNKNOWN on a non-Windows machine instead of crashing or guessing', () => {
        const result = decide(
            probes({
                platform: 'darwin',
                userData: { supported: false, profiles: [] },
                nativeHosts: { supported: false },
            })
        );

        expect(result.state).toBe(STATES.UNKNOWN);
    });

    it('GO for an attached playwright MCP', () => {
        const result = decide(
            probes({ playwrightMcp: [{ source: '~/.codex/config.toml', attached: true }] })
        );

        expect(result.state).toBe(STATES.GO);
        expect(result.available).toEqual(['playwright-cdp']);
    });

    it('warns when no profile holds the origin data — preview origins are separate worlds', () => {
        const result = decide(
            probes({
                userData: {
                    supported: true,
                    profiles: [{ name: 'Default', hasOrigin: false, extensions: {} }],
                },
                nativeHosts: { supported: true, claude: true, claudeCode: false, codex: false },
            })
        );

        expect(result.warnings.some((w) => w.level === 'warn' && /preview/.test(w.text))).toBe(
            true
        );
    });

    it('dev mode says isolation is correct and never asks for the real browser', () => {
        const result = decide(probes({ mode: 'dev' }));

        expect(result.state).toBe(STATES.GO);
        expect(result.available).toContain('isolated-playwright');
        expect(result.agentActions.join('\n')).toMatch(/不要为此模式去接管用户的真实 Chrome/);
    });
});
