/**
 * C6（SCN-FWB-020）：只读 Run 什么时候该以「等待方案批准」收尾，而不是 `run.completed`。
 *
 * 判据只有这一份，run-loop 和符合性套件读的是同一个函数——两份判据意味着「这轮算不算
 * 产出了 Design」在执行路径和测试里会给出不同答案，而这正是 C6 要防的那类漂移。
 *
 * 为什么必须存在：`requiresDesign` 的 Issue 只有拿到**已批准的 Design** 才能被 §7.2
 * 路由到写入型 policy。Design 只能由 `agent.waiting_human` + `design_decision` 创建。
 * 少了这一步，Issue 每一轮都被路由回只读 `analyze`——用户回复、再分析、还是只读、再回复，
 * 这就是 `EXC-FWB-003`（2026-08-09）记下的活锁，`#czi9c6` 上它在执行器路径上原样复活了。
 */
import {
    extractFeedbackDesign,
    stripDesignBlock,
} from '../../../scripts/feedback-extract-design.mjs';

/** 与 GitHub 路径逐字一致：这两句是用户在时间线上看到的下一步说明。 */
export const DESIGN_WAIT_REQUESTED_ACTION =
    '已产出方案，请管理员确认：批准后才会进入代码实现，也可以要求修订或拒绝。';
export const DESIGN_WAIT_SUMMARY = '已完成只读分析并产出方案，等待确认。';

/**
 * @param {object} input
 * @param {string} input.policy 本轮 Run 的 policy。
 * @param {boolean} input.requiresDesign 控制面下发的判据，执行器不自己算。
 * @param {string} input.message Agent 本轮的最终用户可见回复。
 * @param {(message: string) => {found: boolean, design: object|null, reason: string}}
 *   input.extractDesign Adapter 的 C6 hook，委托到唯一实现 `extractFeedbackDesign`。
 * @param {(policy: string) => boolean} [input.isWriteCapablePolicy]
 * @returns {{escalates: boolean, actionType: string, design: object|null,
 *            publicMessage: string, reason: string}}
 */
export function planDesignEscalation({
    policy,
    requiresDesign,
    message,
    extractDesign = extractFeedbackDesign,
    isWriteCapablePolicy = defaultIsWriteCapablePolicy,
}) {
    const none = (reason) => ({
        escalates: false,
        actionType: '',
        design: null,
        publicMessage: String(message ?? ''),
        reason,
    });

    // 写入型 Run 已经有写权限，Design 闸对它没有意义；再要求批准一次是纯粹的多一轮等待。
    if (isWriteCapablePolicy(policy)) return none('write_capable_policy');
    if (!requiresDesign) return none('design_not_required');
    if (typeof extractDesign !== 'function') return none('adapter_missing_extract_design');

    const extracted = extractDesign(message) || {};
    // Agent 没产出合规 Design 时**不得伪造等待**：谎称有方案可批，用户批准的是空气，
    // 下一轮照样是只读分析——那是把活锁包装得更像在推进而已（SCN-FWB-020）。
    if (!extracted.found || !extracted.design) {
        return none(extracted.reason || 'no_design_block');
    }

    return {
        escalates: true,
        actionType: 'design_decision',
        design: extracted.design,
        // 用户看到的应该是结论，不是那块 JSON。方案本身走结构化字段进 Design 表，
        // 在时间线里再原样重复一遍只会把一条可读的分析变成半屏代码。
        publicMessage: stripDesignBlock(message),
        reason: '',
    };
}

/**
 * 兜底判据，仅在调用方没注入时使用。执行路径上一律注入 adapter 的
 * `isWriteCapablePolicy`，让「什么算写入型」保持单一来源。
 */
function defaultIsWriteCapablePolicy(policy) {
    return ['implement', 'implement_and_verify', 'local_required'].includes(String(policy || ''));
}
