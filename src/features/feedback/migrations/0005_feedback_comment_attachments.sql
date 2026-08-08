-- Attachments added from a timeline comment are owned by that event.
-- Existing issue-creation attachments keep NULL event_id for compatibility.
ALTER TABLE feedback_attachments ADD COLUMN event_id TEXT;
ALTER TABLE feedback_attachments ADD COLUMN attachment_ordinal INTEGER;

-- One partial index serves both the uniqueness contract and the event_id
-- lookups: every query on these columns filters `event_id = ?` with a
-- non-NULL id, which SQLite satisfies from the partial index.
CREATE UNIQUE INDEX feedback_attachments_event_ordinal_idx
    ON feedback_attachments (event_id, attachment_ordinal)
    WHERE event_id IS NOT NULL;
