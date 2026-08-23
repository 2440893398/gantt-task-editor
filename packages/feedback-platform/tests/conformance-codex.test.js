/**
 * [SCN-FWB-032] CodexAdapter（执行器路径）必须通过 C1～C5 全部符合性测试才允许注册。
 *
 * 与 ActionsAdapter 跑同一套 registerConformanceSuite——五条血泪规则不因为换了
 * 执行引擎而重写第二份，这正是 SCN-FWB-032 存在的意义。
 */
import { describe, expect, it } from 'vitest';
import { createCodexAdapter } from '../adapters/codex.js';
import { createAdapterRegistry } from '../adapters/registry.js';
import { registerConformanceSuite } from '../conformance/suite.js';

registerConformanceSuite(createCodexAdapter());

describe('[SCN-FWB-032] CodexAdapter 注册', () => {
    it('通过注册表的当场检查（结构 + C1 Prompt 契约）', () => {
        const registry = createAdapterRegistry();
        const report = registry.register(createCodexAdapter());
        expect(report.ok).toBe(true);
        expect(registry.listSelectable()).toContain('executor:codex');
    });

    it('削掉一个 hook 后注册被拒——检查确实在跑，不是摆设', () => {
        const registry = createAdapterRegistry();
        const crippled = { ...createCodexAdapter() };
        delete crippled.planTerminalDelivery;
        expect(() => registry.register(crippled)).toThrow('ADAPTER_NOT_CONFORMANT');
    });
});
