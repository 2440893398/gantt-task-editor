/**
 * Feedback Workbench V2 intake classifier (spec §7.5, SCN-FWB-027).
 *
 * §7.2 routes on `businessType/scope/automationDecision`, but nothing used to
 * write those fields at intake: every Issue started as `unclear`, `unclear`
 * routes to `analyze`, and `analyze` runs in a read-only sandbox. The Agent
 * could then only ever answer "I cannot modify code", and no product path
 * existed to lift the Issue out of that state — the loop never closed.
 *
 * This module closes it with a deterministic rule table instead of a model:
 * same input, same classification, no binding, no key, no inference cost, and
 * every branch is unit-testable. Ambiguity always falls back to `unclear`, so
 * the failure mode is "stays read-only", never "guesses its way into a
 * write-capable Run".
 *
 * Routing authority stays in the Worker (§7.3). This only supplies the facts
 * `resolveFeedbackPolicy()` reads; it never names a policy itself.
 */

/** Scanning is bounded so a long paste cannot turn intake into a regex load. */
const MAX_SCANNED_TEXT = 8000;

/** Long enough that the report carries context rather than a bare sentence. */
const DETAILED_TEXT_LENGTH = 1200;

/** Below this a report cannot describe both a place and a symptom. */
const MIN_LOCATABLE_TEXT_LENGTH = 20;

const SIGNAL_TABLE = {
    bug: [
        /报错|错误|异常|失败|崩溃|闪退|卡死|卡住|白屏|乱码/,
        /无法|不能|没反应|无反应|不生效|失效|不起作用|打不开|加载不|保存不/,
        /不对|不正确|错位|串行|重复了|丢失|消失|漏掉/,
        /\bbugs?\b|\berrors?\b|\bcrash|\bbroken\b|\bfail(?:s|ed|ure)?\b/,
        /(?:not|n't|cannot|can not)\s+(?:work|working|load|save|open|show|display)/,
    ],
    requirement: [
        /需求|新增|增加一个|加一个|添加一个|做一个|希望能|能不能加|可以加/,
        /支持(?!不)|引入|上线一个/,
        /\bfeature\b|\badd support\b|\bimplement\b|\bnew (?:page|module|feature)\b/,
    ],
    improvement: [
        /优化|改进|改善|建议|体验|更好|更方便|更清晰|太慢|很慢|不方便|不好用|不够/,
        /美化|调整一下|挪到|改成|换成/,
        /\bimprove\b|\bbetter\b|\bpolish\b|\bux\b|\bslow\b/,
    ],
};

/** Work that spans modules, data or governance is never a small change. */
const LARGE_SCOPE_SIGNALS = [
    /重构|架构|整体|全局|全部页面|所有页面|各个页面|多个模块|重做|重新设计/,
    /迁移|数据库|权限体系|国际化|多语言|离线|同步机制|插件体系/,
    /\brefactor|\barchitect|\bredesign\b|\bmigrat(?:e|ion)\b|\brewrite\b/,
];

/** Concrete operations tell a write-capable Run where to start reproducing. */
const LOCATABLE_SIGNALS = [
    /点击|单击|双击|右键|拖动|拖拽|滚动|输入|选择|勾选|切换|刷新|打开|关闭/,
    /新建|保存|导入|导出|删除|编辑|复制|粘贴|撤销|重做|筛选|排序/,
    /页面|按钮|弹窗|对话框|菜单|列表|表格|图表|甘特|任务|链接|地址|样式/,
    /\bclick|\bdrag|\bselect|\bimport\b|\bexport\b|\bsave\b|\bpage\b|\bbutton\b/,
];

function matchSignals(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
}

function hasPageContext(context) {
    if (!context || typeof context !== 'object') return false;
    for (const key of ['pagePath', 'path', 'route', 'url', 'href']) {
        if (String(context[key] || '').trim()) return true;
    }
    return false;
}

/**
 * Deterministically classify a freshly submitted Issue.
 *
 * @param {object} submission
 * @param {string} submission.submittedType Type the user picked in the dialog.
 * @param {string} submission.title
 * @param {string} submission.description
 * @param {object} [submission.context] Captured page context, when available.
 * @param {number} [submission.attachmentCount] Screenshots/recordings attached.
 * @returns {{businessType: string, scope: string, automationDecision: string,
 *            confidence: string, signals: string[]}}
 */
export function classifyFeedbackSubmission({
    submittedType = 'unclear',
    title = '',
    description = '',
    context = null,
    attachmentCount = 0,
} = {}) {
    const text = `${title}\n${description}`.slice(0, MAX_SCANNED_TEXT).toLowerCase();
    const signals = [];

    const looksLikeBug = matchSignals(text, SIGNAL_TABLE.bug);
    const looksLikeRequirement = matchSignals(text, SIGNAL_TABLE.requirement);
    const looksLikeImprovement = matchSignals(text, SIGNAL_TABLE.improvement);
    if (looksLikeBug) signals.push('text:bug');
    if (looksLikeRequirement) signals.push('text:requirement');
    if (looksLikeImprovement) signals.push('text:improvement');

    // §7.5: the submitter's own choice is evidence, not noise. Keyword
    // inference only fills in for the "not sure" option.
    const declaredType = ['bug', 'improvement', 'requirement', 'other'].includes(submittedType)
        ? submittedType
        : '';
    let businessType = declaredType;
    let confidence = 'high';
    if (declaredType) {
        signals.push(`submitted:${declaredType}`);
    } else if (looksLikeBug) {
        businessType = 'bug';
        confidence = 'medium';
    } else if (looksLikeRequirement) {
        businessType = 'requirement';
        confidence = 'medium';
    } else if (looksLikeImprovement) {
        businessType = 'improvement';
        confidence = 'medium';
    } else {
        // Nothing recognisable: stay `unclear` so §7.2 keeps this read-only.
        businessType = 'unclear';
        confidence = 'low';
    }

    // Only the prose can prove a report is actionable. Page context and the
    // attached recording are captured automatically by the feedback dialog, so
    // every submission carries them — treating either as evidence would mark
    // "why does this need my reply?" as a small, auto-fixable change. They stay
    // as corroborating signals that raise confidence, never as the proof.
    const locatable =
        matchSignals(text, LOCATABLE_SIGNALS) && text.trim().length >= MIN_LOCATABLE_TEXT_LENGTH;
    if (hasPageContext(context)) signals.push('context:page');
    if (Number(attachmentCount) > 0) signals.push('context:attachment');
    if (locatable) signals.push('text:locatable');

    const largeScope = matchSignals(text, LARGE_SCOPE_SIGNALS);
    if (largeScope) signals.push('text:large-scope');

    let scope;
    if (largeScope) {
        scope = 'large';
    } else if (businessType === 'requirement' || text.length >= DETAILED_TEXT_LENGTH) {
        // A requirement is never assumed small — §7.2 sends it through Design.
        scope = 'medium';
    } else if (!locatable) {
        scope = 'unclear';
    } else {
        scope = 'small';
    }

    let automationDecision = '';
    if (businessType === 'unclear' || businessType === 'other') {
        automationDecision = '';
    } else if (businessType === 'bug' && !locatable) {
        // §7.5: a defect report with no reproducible starting point is asked
        // about, not guessed at with a write-capable Run.
        automationDecision = 'need_reproduction';
    } else if (
        businessType === 'requirement' ||
        (businessType === 'improvement' && scope !== 'small')
    ) {
        automationDecision = 'design_required';
    } else if (scope === 'small' || (businessType === 'bug' && scope === 'medium')) {
        automationDecision = 'auto_fix';
    }

    if (businessType === 'unclear') confidence = 'low';
    else if (!declaredType && !locatable) confidence = 'low';
    else if (locatable && (hasPageContext(context) || Number(attachmentCount) > 0)) {
        confidence = declaredType ? 'high' : 'medium';
    }

    return { businessType, scope, automationDecision, confidence, signals };
}
