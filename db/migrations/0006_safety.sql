-- 0006_safety.sql
-- Blocks and reports (CLAUDE.md sections 6 and 13).

CREATE TABLE blocks (
    blocker_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blocked_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- Polymorphic target, like follows: no foreign key on target_id.
-- reporter_id is kept (SET NULL) when the reporter deletes their account so
-- the moderation record survives.
CREATE TABLE reports (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id   uuid REFERENCES users (id) ON DELETE SET NULL,
    target_type   text NOT NULL,
    target_id     uuid NOT NULL,
    reason        text NOT NULL,
    status        text NOT NULL DEFAULT 'open',
    evidence      jsonb,                     -- v0.2 chat reports: decrypted messages
    franking_tag  bytea,                     -- v0.2 chat reports
    resolved_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    resolved_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reports_target_type CHECK (target_type IN (
        'post', 'comment', 'user', 'group', 'question', 'answer',
        'announcement', 'office', 'conversation', 'message', 'story'
    )),
    CONSTRAINT reports_reason_len CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
    CONSTRAINT reports_status     CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed'))
);
-- Moderation queue: oldest open first.
CREATE INDEX reports_queue_idx  ON reports (created_at) WHERE status IN ('open', 'reviewing');
CREATE INDEX reports_target_idx ON reports (target_type, target_id);
-- One open report per member per item.
CREATE UNIQUE INDEX reports_one_open_key ON reports (reporter_id, target_type, target_id)
    WHERE status IN ('open', 'reviewing') AND reporter_id IS NOT NULL;
