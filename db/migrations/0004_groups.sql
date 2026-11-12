-- 0004_groups.sql
-- Groups & clubs (CLAUDE.md section 13, "Groups & clubs"; section 4 "Club pages").
-- Added beyond the brief: groups.course_id / year_of_study, so each
-- course + year has exactly one auto group, and ensure_course_year_groups().

CREATE TABLE groups (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    description        text,
    visibility         text NOT NULL DEFAULT 'public',
    student_only       boolean NOT NULL DEFAULT false,   -- staff cannot see or join
    auto_type          text NOT NULL DEFAULT 'none',
    course_id          uuid REFERENCES courses (id) ON DELETE CASCADE,
    year_of_study      smallint,
    kind               text NOT NULL DEFAULT 'group',
    posting            text NOT NULL DEFAULT 'everyone',
    club_verified_at   timestamptz,          -- CLUB badge = kind 'club' AND this set
    club_verified_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    office_account_id  uuid REFERENCES office_accounts (id) ON DELETE SET NULL,
    created_by         uuid REFERENCES users (id) ON DELETE SET NULL,  -- NULL = system
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT groups_name_len    CHECK (char_length(name) BETWEEN 1 AND 160),
    CONSTRAINT groups_desc_len    CHECK (description IS NULL OR char_length(description) <= 1000),
    CONSTRAINT groups_visibility  CHECK (visibility IN ('public', 'private')),
    CONSTRAINT groups_auto_type   CHECK (auto_type IN ('course_year', 'none')),
    CONSTRAINT groups_kind        CHECK (kind IN ('group', 'club')),
    CONSTRAINT groups_posting     CHECK (posting IN ('everyone', 'admins_only')),
    CONSTRAINT groups_year        CHECK (year_of_study IS NULL OR year_of_study BETWEEN 1 AND 7),
    CONSTRAINT groups_auto_fields CHECK (
        (auto_type = 'course_year' AND course_id IS NOT NULL AND year_of_study IS NOT NULL)
        OR (auto_type = 'none' AND course_id IS NULL AND year_of_study IS NULL)
    ),
    CONSTRAINT groups_club_badge  CHECK (club_verified_at IS NULL OR kind = 'club')
);
CREATE UNIQUE INDEX groups_course_year_key
    ON groups (course_id, year_of_study) WHERE auto_type = 'course_year';
CREATE INDEX groups_browse_idx ON groups (visibility, created_at DESC);

CREATE TABLE group_members (
    group_id   uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'member',
    status     text NOT NULL DEFAULT 'active',
    joined_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id),
    CONSTRAINT group_members_role   CHECK (role IN ('admin', 'member')),
    CONSTRAINT group_members_status CHECK (status IN ('pending', 'active'))
);
CREATE INDEX group_members_user_idx    ON group_members (user_id, status);
CREATE INDEX group_members_pending_idx ON group_members (group_id) WHERE status = 'pending';

-- Creates the missing auto group for every course and year of study.
-- Safe to run again at any time (each new intake, after adding courses).
-- Returns how many groups it created. Auto groups are private: the API adds
-- members by their course and year, nobody else can join.
CREATE FUNCTION ensure_course_year_groups() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    created integer;
BEGIN
    INSERT INTO groups (name, description, visibility, auto_type, course_id, year_of_study)
    SELECT c.name || ' — Year ' || y,
           'Class group for ' || c.name || ', year ' || y || '.',
           'private', 'course_year', c.id, y
    FROM courses c
    CROSS JOIN LATERAL generate_series(1, c.duration_years) AS y
    ON CONFLICT (course_id, year_of_study) WHERE auto_type = 'course_year' DO NOTHING;
    GET DIAGNOSTICS created = ROW_COUNT;
    RETURN created;
END;
$$;
