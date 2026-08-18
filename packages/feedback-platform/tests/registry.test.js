/**
 * [SCN-FWB-032] 未通过符合性检查的 Adapter 不得注册，也不得出现在可选列表里。
 *
 * 每个反例都是把一个真 Adapter 削掉一处再送去注册——不是构造一个空对象来凑失败。
 * 这样断言的是「检查确实在跑」，而不是「检查存在」。
 */
import { describe, it, expect } from 'vitest';
import { createActionsAdapter } from '../adapters/actions.js';
import { createAdapterRegistry, REQUIRED_HOOKS, verifyAdapter } from '../adapters/registry.js';

describe('[SCN-FWB-032] Adapter 注册闸', () => {
    it('[SCN-FWB-032] 合规的 ActionsAdapter 可以注册并出现在可选列表', () => {
        const registry = createAdapterRegistry();
        const report = registry.register(createActionsAdapter({ provider: 'codex' }));
        expect(report.ok).toBe(true);
        expect(report.checkedRules).toContain('C1');
        expect(registry.listSelectable()).toEqual(['actions:codex']);
    });

    it.each(REQUIRED_HOOKS)('[SCN-FWB-032] 缺少 %s 的 Adapter 会被拒', (hook) => {
        const crippled = { ...createActionsAdapter({ provider: 'codex' }) };
        delete crippled[hook];

        const registry = createAdapterRegistry();
        expect(() => registry.register(crippled)).toThrow('ADAPTER_NOT_CONFORMANT');
        expect(registry.listSelectable()).toEqual([]);
    });

    it('[SCN-FWB-032] 只读 Prompt 违反 C1 的 Adapter 会被拒，且指出具体规则', () => {
        const base = createActionsAdapter({ provider: 'codex' });
        // SCN-FWB-029 那次事故的形状：只读 Run 也被要求改文件、跑 npm test。
        const offending = {
            ...base,
            buildPrompt: () =>
                'Modify only files required by this feedback.\nRun npm test before completion.',
        };

        const report = verifyAdapter(offending);
        expect(report.ok).toBe(false);
        const codes = report.failures.map((f) => f.code);
        expect(codes).toContain('C1_READ_ONLY_DEMANDS_WRITES');
        expect(codes).toContain('C1_READ_ONLY_DEMANDS_TESTS');
        expect(codes).toContain('C1_READ_ONLY_NOT_DECLARED');
    });

    it('[SCN-FWB-032] 自称合规不算数——检查是当场跑出来的', () => {
        const registry = createAdapterRegistry();
        const liar = {
            id: 'liar',
            conformant: true,
            passedConformance: ['C1', 'C2', 'C3', 'C4', 'C5'],
        };
        expect(() => registry.register(liar)).toThrow('ADAPTER_NOT_CONFORMANT');
        expect(registry.listSelectable()).toEqual([]);
    });

    it('[SCN-FWB-032] 结构不全时不跑 Prompt 检查，失败原因不被无关报错掩盖', () => {
        const report = verifyAdapter({ id: 'no-hooks' });
        expect(report.ok).toBe(false);
        expect(report.checkedRules).toEqual([]);
        expect(report.failures.every((f) => f.code === 'ADAPTER_HOOK_MISSING')).toBe(true);
    });
});
