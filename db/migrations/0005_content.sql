-- 0005_content.sql
-- Feed, Today board and Ask a Senior (CLAUDE.md section 13, "Content").
-- Added beyond the brief: hidden_by on moderated tables, hidden_at on
-- questions/answers, announcements.created_by.

CREATE TABLE posts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    author_office_id  uuid REFERENCES office_accounts (id) ON DELETE SET NULL,
    group_id          uuid REFERENCES groups (id) ON DELETE CASCADE,  -- NULL = main feed
    body              text,
    media_url         text,
    media_type        text,
    is_reel           boolean NOT NULL DEFAULT false,
    hidden_at         timestamptz,           -- set by moderators; never shown when set
    hidden_by         uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT posts_body_len    CHECK (body IS NULL OR char_length(body) <= 5000),
    CONSTRAINT posts_media_type  CHECK (media_type IN ('image', 'video')),
    CONSTRAINT posts_media_pair  CHECK ((media_url IS NULL) = (media_type IS NULL)),
    CONSTRAINT posts_not_empty   CHECK (media_url IS NOT NULL OR btrim(coalesce(body, '')) <> '')
);
-- Main feed: newest first, keyset pagination on (created_at, id).
CREATE INDEX posts_feed_idx ON posts (created_at DESC, id DESC)
    WHERE group_id IS NULL AND hidden_at IS NULL;
-- Group feed.
CREATE INDEX posts_group_feed_idx ON posts (group_id, created_at DESC, id DESC)
    WHERE group_id IS NOT NULL AND hidden_at IS NULL;
-- Profile page.
CREATE INDEX posts_author_idx ON posts (author_user_id, created_at DESC);
CREATE INDEX posts_office_idx ON posts (author_office_id, created_at DESC)
    WHERE author_office_id IS NOT NULL;

CREATE TABLE comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body        text NOT NULL,
    hidden_at   timestamptz,
    hidden_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT comments_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at, id);
CREATE INDEX comments_user_idx ON comments (user_id);

CREATE TABLE likes (
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    post_id     uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post_idx ON likes (post_id);

CREATE TABLE announcements (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    office_id     uuid NOT NULL REFERENCES office_accounts (id) ON DELETE CASCADE,
    created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    title         text NOT NULL,
    body          text NOT NULL,
    urgency       text NOT NULL DEFAULT 'normal',
    pinned_until  timestamptz NOT NULL,      -- every announcement expires
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT announcements_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 140),
    CONSTRAINT announcements_body_len  CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
    CONSTRAINT announcements_urgency   CHECK (urgency IN ('urgent', 'normal'))
);
-- Today board: WHERE pinned_until > now() ORDER BY urgency, created_at DESC.
CREATE INDEX announcements_pinned_idx ON announcements (pinned_until);
CREATE INDEX announcements_office_idx ON announcements (office_id, created_at DESC);

-- Ask a Senior. hide_name hides the asker from other members only;
-- moderators and admins can always see user_id (section 4.5).
CREATE TABLE questions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    hide_name   boolean NOT NULL DEFAULT false,
    body        text NOT NULL,
    hidden_at   timestamptz,
    hidden_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT questions_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);
CREATE INDEX questions_recent_idx ON questions (created_at DESC, id DESC) WHERE hidden_at IS NULL;
CREATE INDEX questions_user_idx   ON questions (user_id);
CREATE INDEX questions_search_idx ON questions USING gin (to_tsvector('english', body));

CREATE TABLE answers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id  uuid NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    body         text NOT NULL,
    hidden_at    timestamptz,
    hidden_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT answers_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000)
);
CREATE INDEX answers_question_idx ON answers (question_id, created_at, id);
CREATE INDEX answers_user_idx     ON answers (user_id);
CREATE INDEX answers_search_idx   ON answers USING gin (to_tsvector('english', body));
