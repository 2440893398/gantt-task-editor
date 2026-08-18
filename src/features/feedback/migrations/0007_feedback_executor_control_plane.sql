-- M3 control plane only: durable executor identity, epoch-fenced leases,
-- resumable session snapshots, and turn history. This migration does not
-- register or start an executor; existing GitHub-hosted Runs are untouched.

CREATE TABLE feedback_executors (
    id TEXT PRIMARY KEY,
    capabilities_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online', 'offline', 'disabled')),
    last_heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX feedback_executors_status_heartbeat_idx
    ON feedback_executors (status, last_heartbeat_at);

CREATE TABLE feedback_executor_leases (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES feedback_runs (id) ON DELETE CASCADE,
    executor_id TEXT NOT NULL REFERENCES feedback_executors (id),
    epoch INTEGER NOT NULL CHECK (epoch >= 1),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'released', 'expired')),
    acquired_at TEXT NOT NULL,
    heartbeat_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    released_at TEXT,
    UNIQUE (run_id, epoch)
);

CREATE UNIQUE INDEX feedback_executor_leases_one_active_run_idx
    ON feedback_executor_leases (run_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX feedback_executor_leases_one_active_executor_idx
    ON feedback_executor_leases (executor_id)
    WHERE status = 'active';

CREATE INDEX feedback_executor_leases_expiry_idx
    ON feedback_executor_leases (status, expires_at);

CREATE TABLE feedback_agent_sessions (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES feedback_issues (id) ON DELETE CASCADE,
    current_run_id TEXT REFERENCES feedback_runs (id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    provider_thread_id TEXT,
    executor_id TEXT REFERENCES feedback_executors (id),
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
    context_snapshot_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'reset', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX feedback_agent_sessions_issue_provider_idx
    ON feedback_agent_sessions (issue_id, provider, updated_at DESC);

CREATE UNIQUE INDEX feedback_agent_sessions_current_run_idx
    ON feedback_agent_sessions (current_run_id)
    WHERE current_run_id IS NOT NULL AND status = 'active';

CREATE TABLE feedback_turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES feedback_agent_sessions (id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES feedback_runs (id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    provider_turn_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (session_id, sequence),
    UNIQUE (run_id)
);

CREATE INDEX feedback_turns_session_created_idx
    ON feedback_turns (session_id, created_at);
