PRAGMA foreign_keys = ON;

CREATE TABLE feedback_issues (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'manual',
    submitted_type TEXT NOT NULL DEFAULT 'unclear',
    contact_encrypted TEXT,
    contact_type TEXT,
    owner_capability_hash TEXT,
    owner_capability_expires_at TEXT,
    attachment_count INTEGER NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
    context_json TEXT NOT NULL DEFAULT '{}',
    business_type TEXT NOT NULL DEFAULT 'unclear',
    scope TEXT NOT NULL DEFAULT 'unclear',
    automation_decision TEXT NOT NULL DEFAULT '',
    ai_confidence TEXT NOT NULL DEFAULT '',
    ai_classified_at TEXT,
    ai_classified_by TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'medium',
    assignee TEXT NOT NULL DEFAULT '',
    legacy_public_note TEXT NOT NULL DEFAULT '',
    legacy_internal_note TEXT NOT NULL DEFAULT '',
    active_workflow_id TEXT,
    workflow_generation INTEGER NOT NULL DEFAULT 0 CHECK (workflow_generation >= 0),
    last_run_id TEXT,
    active_human_action_id TEXT,
    current_design_id TEXT,
    active_candidate_id TEXT,
    active_release_id TEXT,
    legacy_kv_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT
);

CREATE INDEX feedback_issues_status_updated_idx
    ON feedback_issues (status, updated_at DESC);

CREATE INDEX feedback_issues_owner_capability_idx
    ON feedback_issues (owner_capability_hash)
    WHERE owner_capability_hash IS NOT NULL;

CREATE TABLE feedback_events (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'admin', 'internal')),
    run_id TEXT,
    occurred_at TEXT NOT NULL,
    body_json TEXT NOT NULL DEFAULT '{}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    legacy_hash TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    UNIQUE (issue_id, sequence),
    UNIQUE (issue_id, legacy_hash)
);

CREATE INDEX feedback_events_issue_occurred_idx
    ON feedback_events (issue_id, occurred_at, sequence);

CREATE TABLE feedback_workflows (
    issue_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 1),
    instance_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    active_run_id TEXT,
    context_version INTEGER NOT NULL DEFAULT 1 CHECK (context_version >= 1),
    started_at TEXT NOT NULL,
    waiting_until TEXT,
    finished_at TEXT,
    terminal_reason TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    UNIQUE (issue_id, generation)
);

CREATE UNIQUE INDEX feedback_workflows_one_active_issue_idx
    ON feedback_workflows (issue_id)
    WHERE status IN ('queued', 'running', 'waiting');

CREATE TABLE feedback_runs (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    candidate_id TEXT,
    policy TEXT NOT NULL,
    delivery_mode TEXT NOT NULL,
    provider TEXT NOT NULL,
    runner_type TEXT NOT NULL,
    runner_label TEXT,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
    base_commit TEXT,
    change_commit TEXT,
    provider_session_id TEXT,
    started_at TEXT,
    finished_at TEXT,
    error_code TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES feedback_workflows(instance_id) ON DELETE CASCADE
);

CREATE INDEX feedback_runs_issue_started_idx
    ON feedback_runs (issue_id, started_at DESC);

CREATE TABLE feedback_human_actions (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    workflow_id TEXT,
    run_id TEXT,
    candidate_id TEXT,
    design_id TEXT,
    type TEXT NOT NULL,
    requested_action TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    allowed_return_states_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    resolution_json TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX feedback_human_actions_one_active_issue_idx
    ON feedback_human_actions (issue_id)
    WHERE status = 'active';

CREATE TABLE feedback_designs (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 1),
    status TEXT NOT NULL,
    created_by_run_id TEXT,
    problem TEXT NOT NULL DEFAULT '',
    current_behavior TEXT NOT NULL DEFAULT '',
    proposed_change TEXT NOT NULL DEFAULT '',
    user_value TEXT NOT NULL DEFAULT '',
    affected_areas_json TEXT NOT NULL DEFAULT '[]',
    acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
    risks_json TEXT NOT NULL DEFAULT '[]',
    implementation_outline TEXT NOT NULL DEFAULT '',
    verification_plan_json TEXT NOT NULL DEFAULT '[]',
    decision TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    UNIQUE (issue_id, revision)
);

CREATE TABLE feedback_candidates (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    workflow_id TEXT,
    run_id TEXT,
    parent_candidate_id TEXT,
    repository TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    base_commit TEXT NOT NULL,
    candidate_ref TEXT NOT NULL,
    change_commit TEXT NOT NULL,
    changed_files_json TEXT NOT NULL DEFAULT '[]',
    diff_manifest_sha256 TEXT NOT NULL,
    patch_artifact_id TEXT,
    verification_json TEXT NOT NULL DEFAULT '{}',
    evidence_artifact_ids_json TEXT NOT NULL DEFAULT '[]',
    review_focus TEXT NOT NULL DEFAULT '',
    candidate_worktree TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    verified_at TEXT,
    approved_at TEXT,
    integrated_at TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_candidate_id) REFERENCES feedback_candidates(id),
    UNIQUE (issue_id, repository, base_commit, change_commit)
);

CREATE INDEX feedback_candidates_issue_created_idx
    ON feedback_candidates (issue_id, created_at DESC);

CREATE TABLE feedback_releases (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    workflow_id TEXT,
    repository TEXT NOT NULL,
    status TEXT NOT NULL,
    integration_strategy TEXT NOT NULL,
    integration_commit TEXT,
    remote_default_branch TEXT NOT NULL,
    deployment_required INTEGER NOT NULL DEFAULT 0
        CHECK (deployment_required IN (0, 1)),
    deployment_target TEXT,
    deployment_id TEXT,
    deployed_commit TEXT,
    verification_json TEXT NOT NULL DEFAULT '{}',
    artifact_hashes_json TEXT NOT NULL DEFAULT '{}',
    smoke_urls_json TEXT NOT NULL DEFAULT '[]',
    smoke_result_json TEXT NOT NULL DEFAULT '{}',
    started_at TEXT NOT NULL,
    merged_at TEXT,
    deployed_at TEXT,
    finished_at TEXT,
    error_code TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    FOREIGN KEY (candidate_id) REFERENCES feedback_candidates(id)
);

CREATE UNIQUE INDEX feedback_releases_one_active_branch_idx
    ON feedback_releases (repository, remote_default_branch)
    WHERE status IN ('integrating', 'merged', 'deploying', 'smoke_testing');

CREATE TABLE feedback_deliveries (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    destination TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    workflow_instance_id TEXT,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT,
    response_status INTEGER,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (event_id) REFERENCES feedback_events(id) ON DELETE CASCADE,
    UNIQUE (idempotency_key)
);

CREATE INDEX feedback_deliveries_retry_idx
    ON feedback_deliveries (status, next_attempt_at);

CREATE TABLE feedback_artifacts (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    run_id TEXT,
    candidate_id TEXT,
    release_id TEXT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    object_key TEXT,
    sha256 TEXT,
    size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
    visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'public')),
    created_at TEXT NOT NULL,
    expires_at TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    CHECK (url IS NOT NULL OR object_key IS NOT NULL)
);

CREATE INDEX feedback_artifacts_issue_created_idx
    ON feedback_artifacts (issue_id, created_at DESC);

CREATE TABLE feedback_attachments (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
    sha256 TEXT,
    object_key TEXT,
    legacy_kv_key TEXT,
    legacy_attachment_index INTEGER,
    scan_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    expires_at TEXT,
    FOREIGN KEY (issue_id) REFERENCES feedback_issues(id) ON DELETE CASCADE,
    UNIQUE (issue_id, legacy_kv_key, legacy_attachment_index),
    CHECK (object_key IS NOT NULL OR legacy_kv_key IS NOT NULL)
);

CREATE INDEX feedback_attachments_issue_idx
    ON feedback_attachments (issue_id, created_at);

CREATE TABLE feedback_usage_daily (
    usage_date TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
    estimated_cost REAL NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
    PRIMARY KEY (usage_date, scope_type, scope_id)
);
