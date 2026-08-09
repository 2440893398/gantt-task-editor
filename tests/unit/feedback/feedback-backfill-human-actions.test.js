import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    buildHumanActionRollback,
    buildHumanActionStatements,
    planHumanActionBackfill,
} from '../../../scripts/feedback-backfill-human-actions.mjs';
import { describeFeedbackAnalysisHandoff } from '../../../src/features/feedback/analysis-handoff.js';

function issueRow(overrides = {}) {
    return {
        id: 'feedback:1786108338614:nkgj14io6p',
        version: 4,
        status: 'needs_human',
        business_type: 'bug',
        scope: 'small',
        active_human_action_id: null,
        updated_at: '2026-08-09T09:00:00.000Z',
        active_actions: 0,
        ...overrides,
    };
}

describe('[SCN-FWB-020] stranded needs_human backfill', () => {
    it('[SCN-FWB-020] only repairs Issues that are waiting with nothing to answer', () => {
        expect(planHumanActionBackfill(issueRow({ status: 'open' }))).toMatchObject({
            skip: true,
            reason: 'not_waiting',
        });
        expect(planHumanActionBackfill(issueRow({ status: 'resolved' }))).toMatchObject({
            skip: true,
            reason: 'not_waiting',
        });
        // An Issue that already has a wait must not grow a second one.
        expect(planHumanActionBackfill(issueRow({ active_actions: 1 }))).toMatchObject({
            skip: true,
            reason: 'already_waiting',
        });
        expect(planHumanActionBackfill(issueRow()).skip).toBe(false);
    });

    it('[SCN-FWB-020] asks for repro or for a decision using the same rule as the Worker', () => {
        expect(planHumanActionBackfill(issueRow()).actionType).toBe('confirm_policy');
        expect(planHumanActionBackfill(issueRow({ scope: 'unclear' })).actionType).toBe(
            'need_reproduction'
        );
        expect(planHumanActionBackfill(issueRow({ business_type: 'unclear' })).actionType).toBe(
            'need_reproduction'
        );

        // The Worker must reach the rule through the shared module, not a copy;
        // drift here is exactly what would make the script and production
        // disagree about what a person is being asked for.
        const worker = fs.readFileSync(path.resolve('workers/share-worker.js'), 'utf8');
        expect(worker).toContain(
            "import { describeFeedbackAnalysisHandoff } from '../src/features/feedback/analysis-handoff.js';"
        );
        expect(worker).not.toContain('function describeFeedbackAnalysisHandoff');
    });

    it('[SCN-FWB-020] writes Chinese requestedAction text for both action types', () => {
        for (const issue of [{ business_type: 'bug', scope: 'small' }, {}]) {
            const { requestedAction } = describeFeedbackAnalysisHandoff(issue);
            expect(requestedAction).toMatch(/[一-龥]/);
            expect(requestedAction.length).toBeGreaterThan(20);
        }
    });

    it('[SCN-FWB-020] guards the INSERT on the version and on nothing else waiting', () => {
        const row = issueRow();
        const plan = planHumanActionBackfill(row);
        const [insert, update] = buildHumanActionStatements(row, plan, '2026-08-09T10:00:00.000Z');

        expect(insert).toContain("AND status = 'needs_human'");
        expect(insert).toContain('AND version = 4');
        expect(insert).toContain(
            "WHERE issue_id = 'feedback:1786108338614:nkgj14io6p' AND status = 'active'"
        );
        expect(insert).toContain("'confirm_policy'");
        expect(insert).toContain('\'["queued","closed"]\'');
        // Without the version bump the workbench never re-fetches the detail.
        expect(update).toContain('version = version + 1');
        expect(update).toContain('AND version = 4');
        // The issue pointer must only move if the action row actually landed.
        expect(update).toContain('SELECT 1 FROM feedback_human_actions WHERE id =');
    });

    it('[SCN-FWB-020] reuses one deterministic action id so a rerun cannot duplicate', () => {
        const first = planHumanActionBackfill(issueRow());
        const second = planHumanActionBackfill(issueRow({ version: 9 }));

        expect(first.actionId).toBe(second.actionId);
        expect(first.actionId).toBe('hac_backfill_nkgj14io6p');
    });

    it('[SCN-FWB-020] rolls back to the previous pointer and drops the inserted row', () => {
        const row = issueRow({ active_human_action_id: null });
        const plan = planHumanActionBackfill(row);
        const rollback = buildHumanActionRollback(row, plan);

        expect(rollback).toContain('active_human_action_id = NULL');
        expect(rollback).toContain(
            "DELETE FROM feedback_human_actions WHERE id = 'hac_backfill_nkgj14io6p';"
        );
        expect(rollback).toContain("updated_at = '2026-08-09T09:00:00.000Z'");

        const withPointer = issueRow({ active_human_action_id: 'hac_old' });
        expect(buildHumanActionRollback(withPointer, plan)).toContain(
            "active_human_action_id = 'hac_old'"
        );
    });

    it('[SCN-FWB-020] escapes quotes so a crafted Issue id cannot break out of the SQL', () => {
        const row = issueRow({ id: "feedback:1:o'ops" });
        const plan = planHumanActionBackfill(row);
        const [insert] = buildHumanActionStatements(row, plan, '2026-08-09T10:00:00.000Z');

        expect(insert).toContain("'feedback:1:o''ops'");
    });
});
