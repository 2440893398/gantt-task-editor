// 只读 Run 结束后的人工交接文案（SCN-FWB-020）。
//
// Worker 在 `run.completed` 时用它生成 HumanAction，存量修复脚本用同一份规则补齐
// 历史 Issue。两边共用一个实现，避免"线上问复现步骤、脚本问确认下一步"这类漂移。
//
// 入参是 D1 的 `feedback_issues` 行（snake_case），因为两个调用方拿到的都是它。

/**
 * @param {{business_type?: string, scope?: string} | null | undefined} issue
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

    return {
        actionType: 'confirm_policy',
        requestedAction:
            '分析已完成，结论见上一条处理结果。请确认下一步：回复补充你的决定会重新处理；' +
            '如果要进入代码实现，需求与中大型改动须先形成并批准设计方案，其余请由管理员在 Issue 分类中确认范围。',
    };
}
