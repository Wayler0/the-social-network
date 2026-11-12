-- 0003_roles_offices.sql
-- Roles, office accounts and follows (CLAUDE.md section 13, "Roles & offices").

CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        text NOT NULL,
    title       text,
    starts_at   timestamptz NOT NULL DEFAULT now(),
    ends_at     timestamptz,                 -- NULL = no fixed end
    granted_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roles_role   CHECK (role IN ('staff', 'student_leader', 'club_leader', 'moderator', 'admin')),
    CONSTRAINT roles_period CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX roles_user_idx ON roles (user_id, role);

CREATE TABLE office_accounts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    type        text NOT NULL,
    verified    boolean NOT NULL DEFAULT false,
    avatar_key  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT office_accounts_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT office_accounts_type     CHECK (type IN ('department', 'office', 'student_council', 'club'))
);
CREATE UNIQUE INDEX office_accounts_name_key ON office_accounts (lower(name));

CREATE TABLE office_members (
    office_id   uuid NOT NULL REFERENCES office_accounts (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        text NOT NULL DEFAULT 'editor',
    starts_at   timestamptz NOT NULL DEFAULT now(),
    ends_at     timestamptz,
    PRIMARY KEY (office_id, user_id),
    CONSTRAINT office_members_role   CHECK (role IN ('owner', 'editor')),
    CONSTRAINT office_members_period CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX office_members_user_idx ON office_members (user_id);

-- Polymorphic target: no foreign key on target_id. Integrity is checked in
-- the API; a nightly job should report orphans (section 13).
CREATE TABLE follows (
    follower_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    target_type  text NOT NULL,
    target_id    uuid NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, target_type, target_id),
    CONSTRAINT follows_target_type CHECK (target_type IN ('user', 'office', 'group')),
    CONSTRAINT follows_not_self    CHECK (NOT (target_type = 'user' AND target_id = follower_id))
);
CREATE INDEX follows_target_idx ON follows (target_type, target_id);
