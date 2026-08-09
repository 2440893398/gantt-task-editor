import { describe, expect, it } from 'vitest';
import { classifyFeedbackSubmission } from '../../../src/features/feedback/issue-classifier.js';

// The classifier only produces routing facts; §7.2 turns them into a policy.
// Mirroring that table here keeps the two from drifting apart silently.
function resolvePolicy({ businessType, scope, automationDecision }, approvedDesign = false) {
    if (automationDecision === 'review_required') return 'review';
    if (automationDecision === 'need_reproduction') return 'analyze';
    const requiresDesign =
        automationDecision === 'design_required' ||
        businessType === 'requirement' ||
        scope === 'large' ||
        (businessType === 'improvement' && scope !== 'small');
    if (requiresDesign) return approvedDesign ? 'implement_and_verify' : 'analyze';
    if (businessType === 'bug') return scope === 'unclear' ? 'analyze' : 'implement_and_verify';
    if (businessType === 'improvement') {
        return scope === 'small' ? 'implement_and_verify' : 'analyze';
    }
    return 'analyze';
}

describe('[SCN-FWB-027] feedback intake classifier', () => {
    it('[SCN-FWB-027] routes a locatable defect report to a write-capable policy', () => {
        const classification = classifyFeedbackSubmission({
            submittedType: 'unclear',
            title: '问题反馈后给用户提供的查看进度的地址不对',
            description:
                '问题反馈后给用户提供的查看这个问题处理进度的地址，访问的不是 pages 页面，且点击进去后样式不对。',
        });

        expect(classification).toMatchObject({
            businessType: 'bug',
            scope: 'small',
            automationDecision: 'auto_fix',
        });
        expect(resolvePolicy(classification)).toBe('implement_and_verify');
    });

    it('[SCN-FWB-027] prefers the type the submitter picked over keyword inference', () => {
        const classification = classifyFeedbackSubmission({
            submittedType: 'improvement',
            title: '点击今日的交互优化',
            description: '在当天日期画一条标识线，让用户能清晰知道当前有哪些任务。',
        });

        expect(classification.businessType).toBe('improvement');
        expect(classification.confidence).toBe('high');
        expect(classification.signals).toContain('submitted:improvement');
        expect(resolvePolicy(classification)).toBe('implement_and_verify');
    });

    it('[SCN-FWB-027] keeps an unrecognisable report read-only instead of guessing', () => {
        const classification = classifyFeedbackSubmission({
            submittedType: 'unclear',
            title: '没有任何问题需要我处理，不用展示回复',
            description: '没有任何问题需要我处理，不用展示回复',
        });

        expect(classification).toMatchObject({
            businessType: 'unclear',
            automationDecision: '',
            confidence: 'low',
        });
        expect(resolvePolicy(classification)).toBe('analyze');
    });

    it('[SCN-FWB-027] asks for reproduction when a defect report names no surface', () => {
        const classification = classifyFeedbackSubmission({
            submittedType: 'bug',
            title: '有问题',
            description: '不能用了',
        });

        expect(classification).toMatchObject({
            businessType: 'bug',
            scope: 'unclear',
            automationDecision: 'need_reproduction',
        });
        expect(resolvePolicy(classification)).toBe('analyze');
    });

    it('[SCN-FWB-027] never lets auto-captured context stand in for a described problem', () => {
        // The dialog attaches page context and an rrweb recording to *every*
        // submission, so accepting either as evidence would route complaints
        // like "why does this need my reply?" into a write-capable Run.
        const complaint = classifyFeedbackSubmission({
            submittedType: 'improvement',
            title: '我没有任何待处理的问题，为啥会需要回复呢',
            description: '我没有任何待处理的问题，为啥会需要回复呢',
            context: { app: 'gantt-task-editor', url: 'https://gantt-task-editor.pages.dev/' },
            attachmentCount: 1,
        });

        expect(complaint).toMatchObject({
            businessType: 'improvement',
            scope: 'unclear',
            automationDecision: 'design_required',
        });
        expect(complaint.signals).toContain('context:page');
        expect(complaint.signals).not.toContain('text:locatable');
        expect(resolvePolicy(complaint)).toBe('analyze');
    });

    it('[SCN-FWB-027] treats captured context as corroboration once the prose locates the problem', () => {
        const described = classifyFeedbackSubmission({
            submittedType: 'bug',
            title: '保存任务后日期不对',
            description: '点击保存按钮后，任务列表里的日期不对。',
            context: { pagePath: '/gantt' },
        });

        expect(described).toMatchObject({
            scope: 'small',
            automationDecision: 'auto_fix',
            confidence: 'high',
        });
        expect(described.signals).toEqual(
            expect.arrayContaining(['text:locatable', 'context:page'])
        );
        expect(resolvePolicy(described)).toBe('implement_and_verify');
    });

    it('[SCN-FWB-027] sends requirements and broad work through Design first', () => {
        const requirement = classifyFeedbackSubmission({
            submittedType: 'requirement',
            title: '新增审批流程',
            description: '希望能在发布排期前增加一个审批步骤。',
        });
        const broad = classifyFeedbackSubmission({
            submittedType: 'improvement',
            title: '整体重构任务列表',
            description: '建议把所有页面的任务列表重新设计一遍，点击行为也统一。',
        });

        expect(requirement).toMatchObject({
            businessType: 'requirement',
            scope: 'medium',
            automationDecision: 'design_required',
        });
        expect(broad).toMatchObject({ scope: 'large', automationDecision: 'design_required' });
        expect(resolvePolicy(requirement)).toBe('analyze');
        expect(resolvePolicy(broad)).toBe('analyze');
        expect(resolvePolicy(requirement, true)).toBe('implement_and_verify');
    });

    it('[SCN-FWB-027] is deterministic and bounded for long submissions', () => {
        const description = `${'点击保存后页面报错。'.repeat(400)}`;
        const first = classifyFeedbackSubmission({ submittedType: 'unclear', description });
        const second = classifyFeedbackSubmission({ submittedType: 'unclear', description });

        expect(first).toEqual(second);
        expect(first).toMatchObject({ businessType: 'bug', scope: 'medium' });
        expect(resolvePolicy(first)).toBe('implement_and_verify');
    });
});
