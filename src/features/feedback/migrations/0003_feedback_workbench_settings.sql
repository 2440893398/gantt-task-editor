-- Workbench V2 admin settings (automation entry point + AI executor routing).
-- Only non-secret configuration lives here; signing secrets and provider
-- credentials stay in Worker secrets / GitHub Secrets and are referenced by name.
CREATE TABLE feedback_settings (
    name TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
);
