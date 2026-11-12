-- 0002_accounts.sql
-- Accounts & sign-in (CLAUDE.md section 13, "Accounts & sign-in").
-- Added beyond the brief (see db/README.md "Differences from the brief"):
--   schools, courses (reference tables for profiles and auto groups),
--   users.avatar_key / bio / interests / verified_at / suspended_*.

CREATE TABLE schools (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schools_name_len CHECK (char_length(name) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX schools_name_key ON schools (lower(name));

CREATE TABLE courses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       uuid NOT NULL REFERENCES schools (id) ON DELETE RESTRICT,
    code            text NOT NULL,
    name            text NOT NULL,
    duration_years  smallint NOT NULL DEFAULT 4,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT courses_code_len CHECK (char_length(code) BETWEEN 1 AND 20),
    CONSTRAINT courses_name_len CHECK (char_length(name) BETWEEN 1 AND 160),
    CONSTRAINT courses_duration CHECK (duration_years BETWEEN 1 AND 7)
);
CREATE UNIQUE INDEX courses_code_key ON courses (upper(code));
CREATE INDEX courses_school_idx ON courses (school_id);

CREATE TABLE users (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- name and member_type stay NULL between "email code verified" and
    -- "profile completed"; the API must not treat such a row as a full member.
    name                      text,
    email                     text NOT NULL,
    member_type               text,
    -- Reg number (students/alumni) or staff number (staff). PRIVATE: never
    -- return from public APIs — only to the member and admins (section 5).
    member_number             text,
    member_number_normalised  text GENERATED ALWAYS AS (
        upper(regexp_replace(member_number, '[\s\-]', '', 'g'))
    ) STORED,
    member_number_status      text NOT NULL DEFAULT 'unverified',
    course_id                 uuid REFERENCES courses (id) ON DELETE SET NULL,
    year_of_study             smallint,
    graduation_year           smallint,
    avatar_key                text,          -- object-storage key, not a URL
    bio                       text,
    interests                 text[] NOT NULL DEFAULT '{}',
    verified                  boolean NOT NULL DEFAULT false,
    verified_method           text,
    verified_at               timestamptz,
    is_under_18               boolean NOT NULL DEFAULT false,
    suspended_until           timestamptz,   -- NULL = not suspended
    suspended_reason          text,
    created_at                timestamptz NOT NULL DEFAULT now(),
    deleted_at                timestamptz,
    CONSTRAINT users_name_len        CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
    CONSTRAINT users_email_lower     CHECK (email = lower(email)),
    CONSTRAINT users_email_shape     CHECK (email LIKE '%_@_%' AND char_length(email) <= 254),
    CONSTRAINT users_member_type     CHECK (member_type IN ('fresher', 'continuing', 'alumni', 'staff')),
    CONSTRAINT users_member_no_len   CHECK (member_number IS NULL OR char_length(member_number) BETWEEN 3 AND 40),
    CONSTRAINT users_member_status   CHECK (member_number_status IN ('unverified', 'verified', 'disputed')),
    CONSTRAINT users_year_of_study   CHECK (year_of_study IS NULL OR year_of_study BETWEEN 1 AND 7),
    CONSTRAINT users_graduation_year CHECK (graduation_year IS NULL OR graduation_year BETWEEN 1990 AND 2100),
    CONSTRAINT users_bio_len         CHECK (bio IS NULL OR char_length(bio) <= 300),
    CONSTRAINT users_verified_method CHECK (verified_method IN ('email_code', 'admin', 'erp'))
);
-- Unique among live accounts only, so a deleted account does not block the
-- same person from signing up again.
CREATE UNIQUE INDEX users_email_key
    ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_member_number_key
    ON users (member_number_normalised)
    WHERE deleted_at IS NULL AND member_number_normalised IS NOT NULL;
CREATE INDEX users_course_year_idx ON users (course_id, year_of_study);

CREATE TABLE auth_codes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text NOT NULL,
    code_hash    text NOT NULL,              -- never the plain code
    purpose      text NOT NULL DEFAULT 'sign_in',
    expires_at   timestamptz NOT NULL,       -- API sets now() + 10 minutes
    attempts     smallint NOT NULL DEFAULT 0,
    consumed_at  timestamptz,
    request_ip   inet,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT auth_codes_email_lower CHECK (email = lower(email)),
    CONSTRAINT auth_codes_purpose     CHECK (purpose IN ('sign_in', 'change_email')),
    CONSTRAINT auth_codes_attempts    CHECK (attempts BETWEEN 0 AND 5)
);
-- Rate limits ("how many codes for this email / IP recently?").
CREATE INDEX auth_codes_email_created_idx ON auth_codes (email, created_at DESC);
CREATE INDEX auth_codes_ip_created_idx    ON auth_codes (request_ip, created_at DESC);
-- Cleanup job: DELETE FROM auth_codes WHERE created_at < now() - interval '24 hours';
CREATE INDEX auth_codes_created_idx       ON auth_codes (created_at);

CREATE TABLE sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash    text NOT NULL,             -- SHA-256 of the cookie token
    user_agent    text,
    ip            inet,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    revoked_at    timestamptz
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE member_number_disputes (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_number_normalised  text NOT NULL,
    reporter_user_id          uuid REFERENCES users (id) ON DELETE SET NULL,
    details                   text,
    status                    text NOT NULL DEFAULT 'open',
    created_at                timestamptz NOT NULL DEFAULT now(),
    resolved_at               timestamptz,
    CONSTRAINT member_number_disputes_status CHECK (status IN ('open', 'resolved'))
);
CREATE INDEX member_number_disputes_open_idx
    ON member_number_disputes (created_at) WHERE status = 'open';
