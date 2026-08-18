/**
 * Adapter 注册表（SCN-FWB-032：未通过符合性检查的 Adapter 不得注册）。
 *
 * 关键设计：注册时**当场跑检查**，不接受任何形式的自我声明。
 * 一个能靠传 `{ conformant: true }` 就注册成功的注册表等于没有注册表——
 * 这与符合性套件本身的原则一致：测行为，不测声明。
 *
 * 注册时能跑的是纯内存的那一部分（结构完整性 + C1 的 Prompt 契约）。
 * 需要文件系统、git 或 workflow 的 C2～C5 仍由 vitest 套件覆盖：
 * 它们不适合在生产运行时跑，但结构缺失和 Prompt 违规是最常见、也最廉价可查的两类。
 */
import { CONFORMANCE_RULE_IDS } from '../protocol/v0.js';

/** Adapter 必须实现的 hook。缺一个就不能注册。 */
export const REQUIRED_HOOKS = Object.freeze([
    'buildPrompt',
    'isWriteCapablePolicy',
    'listVerificationSteps',
    'enumerateEvidence',
    'planTerminalDelivery',
    'resolveContractAuthorization',
]);

const PROBE_ISSUE = Object.freeze({
    id: 'adapter-registry-probe',
    businessType: 'bug',
    scope: 'small',
    title: 'registry probe',
});

/** 结构完整性：id 是字符串，每个 hook 都是函数。 */
export function verifyAdapterStructure(adapter) {
    const failures = [];
    if (!adapter || typeof adapter !== 'object') {
        return [{ code: 'ADAPTER_NOT_AN_OBJECT' }];
    }
    if (!String(adapter.id || '').trim()) {
        failures.push({ code: 'ADAPTER_ID_REQUIRED' });
    }
    for (const hook of REQUIRED_HOOKS) {
        if (typeof adapter[hook] !== 'function') {
            failures.push({ code: 'ADAPTER_HOOK_MISSING', hook });
        }
    }
    return failures;
}

/**
 * C1 的可在线执行部分：只读 Run 的 Prompt 不得要求写文件或跑测试。
 * 这是 SCN-FWB-029 那次事故的直接复现条件，且只需要纯内存调用。
 */
export function verifyAdapterPromptContract(adapter) {
    const failures = [];
    let prompt = '';
    try {
        prompt = String(
            adapter.buildPrompt({ policy: 'analyze', issue: PROBE_ISSUE, timeline: [] })
        );
    } catch (error) {
        return [{ code: 'ADAPTER_PROMPT_BUILD_FAILED', message: String(error?.message || error) }];
    }

    if (!/read-only/i.test(prompt)) {
        failures.push({ code: 'C1_READ_ONLY_NOT_DECLARED' });
    }
    if (/npm test/.test(prompt)) {
        failures.push({ code: 'C1_READ_ONLY_DEMANDS_TESTS' });
    }
    if (/Modify only files/.test(prompt)) {
        failures.push({ code: 'C1_READ_ONLY_DEMANDS_WRITES' });
    }
    if (adapter.isWriteCapablePolicy('analyze') !== false) {
        failures.push({ code: 'C1_ANALYZE_CLAIMS_WRITE_CAPABILITY' });
    }
    return failures;
}

export function verifyAdapter(adapter) {
    const structural = verifyAdapterStructure(adapter);
    // 结构不全时不再跑 Prompt 检查——那只会抛出无关的 TypeError 掩盖真正的原因。
    const behavioural = structural.length ? [] : verifyAdapterPromptContract(adapter);
    const failures = [...structural, ...behavioural];
    return {
        ok: failures.length === 0,
        failures,
        // 在线检查覆盖的规则；其余由 vitest 的符合性套件覆盖。
        checkedRules: structural.length ? [] : ['C1'],
        allRules: CONFORMANCE_RULE_IDS,
    };
}

export function createAdapterRegistry() {
    const adapters = new Map();

    return {
        register(adapter) {
            const report = verifyAdapter(adapter);
            if (!report.ok) {
                const error = new Error('ADAPTER_NOT_CONFORMANT');
                error.code = 'ADAPTER_NOT_CONFORMANT';
                error.failures = report.failures;
                throw error;
            }
            adapters.set(adapter.id, adapter);
            return report;
        },
        get(id) {
            return adapters.get(id) ?? null;
        },
        /** 项目配置里可选的 Adapter，只包含注册成功的。 */
        listSelectable() {
            return [...adapters.keys()].sort();
        },
    };
}
