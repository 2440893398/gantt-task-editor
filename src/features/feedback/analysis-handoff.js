// 只读 Run 结束后的人工交接文案，以及 §16.4 的"需要设计方案"判据（SCN-FWB-020）。
//
// Worker 在 `run.completed` 时用它生成 HumanAction，存量修复脚本用同一份规则补齐
// 历史 Issue。两边共用一个实现，避免"线上问复现步骤、脚本问确认下一步"这类漂移。
//
// 入参是 D1 的 `feedback_issues` 行（snake_case），因为两个调用方拿到的都是它。

/**
 * §16.4：显式门禁、需求、大范围、或非 small 的优化，都必须先有获批的 Design 才能
 * 拿到写权限。Runner 也要知道同一个答案（只读 Run 的交付物是不是 Design），所以
 * 只留一份判据——两边各猜一次的话，要么漏掉 Design（活锁），要么产出没人要的方案。
 *
 * @param {{businessType?: string, scope?: string, automationDecision?: string}} facts
 */
export function requiresFeedbackDesign({ businessType, scope, automationDecision }) {
    return Boolean(
        automationDecision === 'design_required' ||
        businessType === 'requirement' ||
        scope === 'large' ||
        (businessType === 'improvement' && scope !== 'small')
    );
}

/**
 * @param {{business_type?: string, scope?: string, automation_decision?: string} | null} issue
 * @returns {{actionType: string, requestedAction: string}}
 */
export function describeFeedbackAnalysisHandoff(issue) {
    const businessType = String(issue?.business_type || 'unclear');
    const scope = String(issue?.scope || 'unclear');

    // 还判断不出要改什么，就只能请用户补线索；此时问"下一步怎么办"没有意义。
    if (businessType === 'unclear' || businessType === 'other' || scope === 'unclear') {
        return {
            actionType: 'need_reproduction',
            requestedAction:
                '分析已完成，结论见上一条处理结果。这条反馈还不足以判断要改什么：请补充复现步骤、期望结果或截图，回复后会带着新信息重新分析。',
        };
    }

    // 需要设计方案的 Issue 走到这里，说明本轮**没有**产出可批准的方案（产出了就会是
    // `agent.waiting_human` + `design_decision`，根本不会进这个分支）。这时候说"请确认
    // 下一步"是骗人的——没有方案可批，回复多少次都还是只读分析。
    if (
        requiresFeedbackDesign({
            businessType,
            scope,
            automationDecision: String(issue?.automation_decision || ''),
        })
    ) {
        return {
            actionType: 'confirm_policy',
            requestedAction:
                '分析已完成，结论见上一条处理结果。这类改动要先有获批的设计方案才能进入代码实现，' +
                '而本轮没有产出可批准的方案：请补充你想要的效果与验收标准（怎样算做好了），' +
                '回复后会重新分析并给出方案，由管理员批准后才会开始实现。',
        };
    }

    return {
        actionType: 'confirm_policy',
        requestedAction:
            '分析已完成，结论见上一条处理结果。请确认下一步：回复补充你的决定会重新处理；' +
            '如果要进入代码实现，请由管理员在 Issue 分类中确认范围。',
    };
}
