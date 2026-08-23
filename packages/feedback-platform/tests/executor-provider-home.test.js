/**
 * [SCN-FWB-035] S7：provider 配置目录的解析。
 *
 * 坏行为画像：为了「安全」一律隔离配置目录，于是每换一个工作区都要为执行器单独登录
 * 一次；而实测（2026-08-21）Claude Code 侧的隔离并不构成安全边界——用户级 settings、
 * 插件、技能、MCP 已经被 `--setting-sources project` + `--strict-mcp-config` 挡住。
 * 反过来 codex 侧的隔离是硬约束，不能因为「统一行为」被一起放宽。
 */
import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROVIDERS, resolveProviderHome } from '../executor/main.js';

const WORKSPACE = join('C:', 'executor', 'workspace');
const resolve = (providerId, env) =>
    resolveProviderHome({
        env,
        provider: PROVIDERS[providerId],
        providerId,
        workspaceDir: WORKSPACE,
    });

describe('[SCN-FWB-035] S7 provider 配置目录', () => {
    it('claude-code 默认继承开发者登录——不强加一次专门的登录仪式', () => {
        const result = resolve('claude-code', {});
        expect(result.inherited).toBe(true);
        expect(result.isolatedDir).toBe('');
        expect(result.effectiveHome).toBe(join(homedir(), '.claude'));
        // 关键：继承模式下**一个配置目录变量都不注入**。
        // `CLAUDE_CONFIG_DIR=~/.claude` 与不设它并不等价——设了之后 CLI 改去
        // `<dir>/.claude.json` 找主配置（默认那份在 `~/.claude.json`），实测会造出一份
        // 重复配置并打印「配置文件丢失，可从 backup 恢复」，把排障引向不存在的故障。
        expect(result.envExtra).toEqual({});
    });

    it('继承模式下开发者自己的非默认目录要照搬——否则「我明明登录过」与「执行器说没登录」会同时成立', () => {
        // S3 的环境白名单会剥掉 CLAUDE_CONFIG_DIR，不显式转发就悄悄退回 ~/.claude。
        const custom = join('D:', 'my-claude-home');
        const result = resolve('claude-code', { CLAUDE_CONFIG_DIR: custom });
        expect(result.effectiveHome).toBe(custom);
        expect(result.inherited).toBe(true);
        expect(result.envExtra).toEqual({ CLAUDE_CONFIG_DIR: custom });
    });

    it('显式设了 FEEDBACK_EXECUTOR_PROVIDER_HOME 就隔离——迁入共享宿主时的开关还在', () => {
        const dir = join('D:', 'executor-home');
        const result = resolve('claude-code', { FEEDBACK_EXECUTOR_PROVIDER_HOME: dir });
        expect(result.isolatedDir).toBe(dir);
        expect(result.effectiveHome).toBe(dir);
        expect(result.inherited).toBe(false);
        expect(result.envExtra).toEqual({ CLAUDE_CONFIG_DIR: dir });
    });

    it('codex 无条件隔离——共享 ~/.codex 的 sqlite 会被在跑的进程锁死', () => {
        const result = resolve('codex', {});
        expect(result.inherited).toBe(false);
        expect(result.isolatedDir).toBe(`${WORKSPACE}-codex-home`);
        expect(result.envExtra).toEqual({ CODEX_HOME: `${WORKSPACE}-codex-home` });
    });
});
