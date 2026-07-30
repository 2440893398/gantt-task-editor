ALTER TABLE feedback_runs
    ADD COLUMN permission_profile TEXT NOT NULL DEFAULT ':read-only';

ALTER TABLE feedback_runs
    ADD COLUMN context_snapshot_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE feedback_runs
    ADD COLUMN context_token_hash TEXT;

ALTER TABLE feedback_runs
    ADD COLUMN context_token_expires_at TEXT;

ALTER TABLE feedback_runs
    ADD COLUMN callback_token_hash TEXT;

ALTER TABLE feedback_runs
    ADD COLUMN callback_token_expires_at TEXT;

ALTER TABLE feedback_runs
    ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX feedback_runs_one_active_issue_idx
    ON feedback_runs (issue_id)
    WHERE status IN ('queued', 'running', 'waiting_human');
