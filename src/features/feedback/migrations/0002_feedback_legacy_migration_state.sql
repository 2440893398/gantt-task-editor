CREATE TABLE feedback_migration_state (
    name TEXT PRIMARY KEY,
    cursor TEXT,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    updated_at TEXT NOT NULL
);
