import { describe, expect, it } from 'vitest';
import {
    buildRollbackStatement,
    buildUpdateStatement,
    planBackfill,
} from '../../../scripts/feedback-backfill-classification.mjs';

function createRow(overrides = {}) {
    return {
        id: 'feedback:1786108338614:nkgj14io6p',
        version: 3,
        status: 'needs_human',
        submitted_type: 'unclear',
        business_type: 'unclear',
        scope: 'unclear',
        automation_decision: '',
        ai_confidence: '',
        ai_classified_at: null,
        attachment_count: 0,
        title: '查看进度的地址不对',
        description: '点击进去后样式不对，访问的不是 pages 页面。',
        context_json: '{"app":"gantt-task-editor","url":"https://example.test/"}',
        updated_at: '2026-08-08T10:00:00.000Z',
        ...overrides,
    };
}

describe('[SCN-FWB-027] stored classification backfill', () => {
    it('[SCN-FWB-027] backfills an unclassified issue that is still in flight', () => {
        const plan = planBackfill(createRow());

        expect(plan.skip).toBe(false);
        expect(plan.classification).toMatchObject({
            businessType: 'bug',
            scope: 'small',
            automationDecision: 'auto_fix',
        });
    });

    it('[SCN-FWB-027] never rewrites terminal or already classified history', () => {
        expect(planBackfill(createRow({ status: 'resolved' }))).toMatchObject({
            skip: true,
            reason: 'terminal_status',
        });
        expect(planBackfill(createRow({ status: 'closed' }))).toMatchObject({
            skip: true,
            reason: 'terminal_status',
        });
        expect(planBackfill(createRow({ business_type: 'bug', scope: 'medium' }))).toMatchObject({
            skip: true,
            reason: 'already_classified',
        });
    });

    it('[SCN-FWB-027] skips rows the rule table cannot move off unclear', () => {
        const plan = planBackfill(
            createRow({ title: '随便说说', description: '随便说说', context_json: null })
        );

        expect(plan).toMatchObject({ skip: true, reason: 'no_change' });
    });

    it('[SCN-FWB-027] guards the update with the read version and can be rolled back', () => {
        const row = createRow();
        const plan = planBackfill(row);
        const update = buildUpdateStatement(row, plan.classification, '2026-08-09T02:00:00.000Z');

        expect(update).toContain("business_type = 'bug'");
        expect(update).toContain('version = version + 1');
        expect(update).toContain(`WHERE id = '${row.id}' AND version = 3;`);

        const rollback = buildRollbackStatement(row);
        expect(rollback).toContain("business_type = 'unclear'");
        expect(rollback).toContain('ai_classified_at = NULL');
        expect(rollback).toContain("updated_at = '2026-08-08T10:00:00.000Z'");
    });

    it('[SCN-FWB-027] escapes quotes so a crafted title cannot break out of the statement', () => {
        const row = createRow({ id: "feedback:1:o'brien" });
        const update = buildUpdateStatement(row, planBackfill(row).classification, '2026-08-09');

        expect(update).toContain("WHERE id = 'feedback:1:o''brien'");
    });
});
