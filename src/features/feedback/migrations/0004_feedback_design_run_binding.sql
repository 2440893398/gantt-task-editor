-- Feedback Workbench V2 §16.4: bind every post-approval implementation Run
-- to the exact immutable Design revision it is implementing.

ALTER TABLE feedback_runs ADD COLUMN design_id TEXT REFERENCES feedback_designs(id);

CREATE INDEX feedback_runs_design_idx
    ON feedback_runs (design_id);
