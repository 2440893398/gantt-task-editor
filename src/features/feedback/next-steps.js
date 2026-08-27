/**
 * Agent 提议的「下一步选项」（SCN-FWB-037）。
 *
 * 为什么让模型参与：下一步卡片此前只能显示通用文案（「补充信息并重新分析」），
 * 用户看得懂字面却不知道对**这条 Issue** 意味着什么。真正有用的是「采纳：按结论删掉
 * 基线纵切面，含一条迁移测试」这种带上下文的一句话，而只有刚读完代码的那一轮知道。
 *
 * 为什么模型只出文案、不出流转：§7.3 的路由权归服务端。模型给的 `action` 必须落在下面
 * 这张固定表里，且必须是**这条 HumanAction 本来就允许**的决定；表外的、越权的一律丢弃。
 * 否则一次提示词注入就能让页面长出一个「直接部署到生产」的按钮——文案是模型的，
 * 权限永远不是。
 */

/**
 * 模型可用的动作词表 → 控制面认识的决定。
 *
 * `requiresAdmin` 的两条都对应 §21.3：owner capability 能回答「还缺什么」，
 * 但不能自助把自己的反馈升级成写入型 Run，也不能替管理员关单。
 */
export const FEEDBACK_NEXT_STEP_ACTIONS = Object.freeze({
    implement: Object.freeze({
        decision: 'queued',
        policyDecision: 'implement',
        requiresAdmin: true,
        fallbackLabel: '采纳分析，开始实施',
    }),
    clarify: Object.freeze({
        decision: 'queued',
        policyDecision: '',
        requiresAdmin: false,
        requiresNote: true,
        fallbackLabel: '补充信息并重新分析',
    }),
    close: Object.freeze({
        decision: 'closed',
        policyDecision: '',
        requiresAdmin: true,
        fallbackLabel: '关闭 Issue',
    }),
});

/** Agent 把选项放在最终消息末尾的这个围栏块里，与 `feedback-design` 同一套约定。 */
export const NEXT_STEPS_BLOCK_MARKER = 'feedback-next-steps';

/** 一次最多展示这么多个选项：再多就不是「下一步」，是又一份需要读的清单。 */
const MAX_NEXT_STEPS = 4;
const MAX_LABEL_LENGTH = 40;
const MAX_DETAIL_LENGTH = 200;

function trimmed(value, max) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * 把模型给的候选项收敛成可以安全渲染的列表。
 *
 * @param {unknown} value Agent 在终态 payload 里给的 `nextSteps`。
 * @param {{allowedReturnStates?: string[]}} [context] 该 HumanAction 声明过的返回状态。
 * @returns {Array<{action: string, label: string, detail: string}>}
 */
export function normalizeFeedbackNextSteps(value, context = {}) {
    const source = Array.isArray(value) ? value : [];
    const allowed = Array.isArray(context.allowedReturnStates) ? context.allowedReturnStates : null;
    const seen = new Set();
    const options = [];

    for (const item of source) {
        if (!item || typeof item !== 'object') continue;
        const action = trimmed(item.action, 20);
        const spec = FEEDBACK_NEXT_STEP_ACTIONS[action];
        // 词表外的动作不是「未知选项」，是越权尝试——静默丢弃，不降级、不猜。
        if (!spec || seen.has(action)) continue;
        // 该动作要落到的返回状态，必须是这条 HumanAction 自己声明过的。
        if (allowed && !allowed.includes(spec.decision)) continue;

        const label = trimmed(item.label, MAX_LABEL_LENGTH) || spec.fallbackLabel;
        options.push({ action, label, detail: trimmed(item.detail, MAX_DETAIL_LENGTH) });
        seen.add(action);
        if (options.length >= MAX_NEXT_STEPS) break;
    }

    return options;
}

function nextStepsFence(flags) {
    return new RegExp(`\`\`\`${NEXT_STEPS_BLOCK_MARKER}\\s*\\r?\\n([\\s\\S]*?)\`\`\``, flags);
}

/**
 * 从 Agent 最终消息里取出候选项。取**最后一个**块：模型常先复述提示词里的示例，
 * 真正的产出在末尾（与 `extractFeedbackDesign` 同一条经验）。
 *
 * 解析失败一律返回空数组，绝不抛——一段畸形的建议块不值得赔掉整个终态回调。
 */
export function extractFeedbackNextSteps(message) {
    const source = typeof message === 'string' ? message : '';
    let block = '';
    for (const match of source.matchAll(nextStepsFence('g'))) block = match[1];
    if (!block.trim()) return [];

    try {
        const parsed = JSON.parse(block);
        return normalizeFeedbackNextSteps(Array.isArray(parsed) ? parsed : parsed?.options, {});
    } catch {
        return [];
    }
}

/** 用户看到的应该是结论，不是那段 JSON。 */
export function stripFeedbackNextSteps(message) {
    const source = typeof message === 'string' ? message : '';
    return source
        .replace(nextStepsFence('g'), '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
