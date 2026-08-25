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
 * §16.3 要求 `need_reproduction` 必须交代「已检查的步骤、日志、附件与缺口」。
 *
 * 这里组的是**人能读的**条目：工作台按 `label` + `summary` 渲染，写别的字段会渲染成
 * 「N 项」加 N 个空框（#czi9c6）。内容只允许是本轮真实成立的事实——附件那一条尤其：
 * 当前处理链路的 Run context 只带 title/description/timeline 文本，附件内容一个字节
 * 都不会进 Prompt。既然如此就要说出来，而不是一边读不到、一边请用户「补个截图」。
 *
 * @param {{policy?: string, timelineCount?: number, attachmentCount?: number}} facts
 * @param {string} gap 本轮到底缺什么——每个分支自己最清楚。
 */
function handoffEvidence(facts, gap) {
    const policy = String(facts?.policy || 'analyze');
    const timelineCount = Number(facts?.timelineCount) || 0;
    const attachmentCount = Number(facts?.attachmentCount) || 0;

    return [
        {
            label: '本轮处理',
            summary: `只读分析（policy=${policy}）：读代码并给结论，不修改仓库文件。结论见上一条处理结果。`,
        },
        {
            label: '已读取',
            summary: `反馈标题与正文，以及 ${timelineCount} 条公开时间线记录。`,
        },
        {
            label: '未读取',
            summary: attachmentCount
                ? `${attachmentCount} 个附件（截图/录屏）。当前处理链路只把文本送进分析，附件内容不参与判断——它们只对人可见。`
                : '本条反馈没有附件。',
        },
        { label: '仍缺的信息', summary: gap },
    ];
}

/**
 * @param {{business_type?: string, scope?: string, automation_decision?: string} | null} issue
 * @param {{policy?: string, timelineCount?: number, attachmentCount?: number}} [facts]
 * @returns {{actionType: string, requestedAction: string,
 *            evidence: Array<{label: string, summary: string}>}}
 */
export function describeFeedbackAnalysisHandoff(issue, facts = {}) {
    const businessType = String(issue?.business_type || 'unclear');
    const scope = String(issue?.scope || 'unclear');
    const needsDesign = requiresFeedbackDesign({
        businessType,
        scope,
        automationDecision: String(issue?.automation_decision || ''),
    });

    // 判据顺序：`requiresDesign` **先于** `scope === 'unclear'`。
    //
    // 两者经常同时成立（`improvement` + 非 small ⇒ 两个都真），而先判 scope 会让一条
    // 「把某功能删掉」的诉求被问「请补充复现步骤」——那是一个用户答不出、答了也不改变
    // 任何路由的问题：没有 bug 可复现，缺的是「删到什么程度算做好」。#czi9c6 就卡在这里。
    if (needsDesign) {
        // 走到这里说明本轮**没有**产出可批准的方案（产出了就会是 `agent.waiting_human`
        // + `design_decision`，根本不会进这个分支）。这时候说"请确认下一步"是骗人的——
        // 没有方案可批，回复多少次都还是只读分析。
        return {
            actionType: 'confirm_policy',
            requestedAction:
                '分析已完成，结论见上一条处理结果。这类改动要先有获批的设计方案才能进入代码实现，' +
                '而本轮没有产出可批准的方案：请补充你想要的效果与验收标准（怎样算做好了），' +
                '回复后会重新分析并给出方案，由管理员批准后才会开始实现。',
            evidence: handoffEvidence(
                facts,
                '可验收的目标：改完之后什么行为算「做好了」。没有这个就写不出方案，也就无从批准。'
            ),
        };
    }

    // 还判断不出要改什么，就只能请用户补线索；此时问"下一步怎么办"没有意义。
    if (businessType === 'unclear' || businessType === 'other' || scope === 'unclear') {
        return {
            actionType: 'need_reproduction',
            requestedAction:
                '分析已完成，结论见上一条处理结果。这条反馈还不足以判断要改什么：' +
                '请用文字补充触发步骤和你期望的结果，回复后会带着新信息重新分析。' +
                '（截图可以帮人理解，但不进入自动分析，关键信息请写进正文。）',
            evidence: handoffEvidence(
                facts,
                '可定位的触发步骤（在哪个页面、做了什么操作）与期望结果。缺这两样就判断不出要改哪里。'
            ),
        };
    }

    return {
        actionType: 'confirm_policy',
        requestedAction:
            '分析已完成，结论见上一条处理结果。请确认下一步：回复补充你的决定会重新处理；' +
            '如果要进入代码实现，请由管理员在 Issue 分类中确认范围。',
        evidence: handoffEvidence(facts, '你的决定：是按结论继续做，还是换个方向。'),
    };
}
