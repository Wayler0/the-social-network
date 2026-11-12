-- Accounts and sign-in (CLAUDE.md section 13; docs/api-contract.md section 3).
-- Issue #30 (Peter). Kim's auth API (#17–#19) builds on these tables.
-- Rules: no plain codes or tokens are ever stored; email and member number are private.

-- Keeps updated_at current on any table that has the column.
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- users
create table users (
  id                       uuid primary key default gen_random_uuid(),
  campus_id                uuid not null references campuses (id),
  email                    text check (email = lower(email) and email like '%_@_%'),   -- null after deletion
  member_type              text not null check (member_type in ('fresher', 'continuing', 'alumni', 'staff')),
  name                     text check (char_length(name) between 1 and 80),
  photo_url                text,
  course                   text check (char_length(course) <= 120),
  year_of_study            smallint check (year_of_study between 1 and 8),
  graduation_year          smallint check (graduation_year between 1990 and 2100),
  -- Reg number (students/alumni) or staff number. Private: only the member and admins see it.
  member_number            text check (char_length(member_number) <= 40),
  member_number_normalised text check (member_number_normalised ~ '^[A-Z0-9/]+$'),  -- upper-case, no spaces or dashes
  member_number_status     text not null default 'unverified'
                             check (member_number_status in ('unverified', 'verified', 'disputed')),
  is_under_18              boolean,                                   -- null until answered in onboarding
  verified                 boolean not null default false,
  verified_method          text check (verified_method in ('email_code', 'admin', 'erp')),
  suspended_at             timestamptz,
  suspended_until          timestamptz,
  suspended_reason         text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz,
  constraint member_number_pair check ((member_number is null) = (member_number_normalised is null)),
  constraint deleted_has_no_email check (deleted_at is null or email is null)
);

-- One live account per email; a deleted account frees its email (its row keeps no email).
create unique index users_email_key on users (email) where email is not null;
-- One live account per member number per campus.
create unique index users_member_number_key on users (campus_id, member_number_normalised)
  where member_number_normalised is not null and deleted_at is null;
create index users_campus_idx on users (campus_id) where deleted_at is null;

create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- auth_codes
-- One-time sign-in codes. code_hash = HMAC-SHA256(CODE_PEPPER, email || ':' || code).
create table auth_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(email)),
  code_hash   bytea not null check (octet_length(code_hash) = 32),
  purpose     text not null default 'sign_in' check (purpose in ('sign_in', 'change_email')),
  expires_at  timestamptz not null,
  attempts    smallint not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  request_ip  inet,
  created_at  timestamptz not null default now(),
  constraint expires_after_created check (expires_at > created_at)
);
-- "Newest unused code for this email" and per-email rate limits.
create index auth_codes_email_idx on auth_codes (email, created_at desc);
-- Cleanup job deletes rows older than 24 h.
create index auth_codes_created_idx on auth_codes (created_at);

-- ---------------------------------------------------------------- sessions
-- The cookie holds a random token; only sha256(token) is stored.
create table sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  token_hash   bytea not null unique check (octet_length(token_hash) = 32),
  user_agent   text check (char_length(user_agent) <= 400),
  ip           inet,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  constraint session_expires_after_created check (expires_at > created_at)
);
create index sessions_user_idx on sessions (user_id) where revoked_at is null;
create index sessions_expires_idx on sessions (expires_at);

-- ---------------------------------------------------------------- rate limits
-- No Redis in v0.1, so rate limits live here. One row per counted event,
-- e.g. bucket 'verify_ip', key '41.90.0.1'. Count rows in the window; cleanup deletes old rows.
create table rate_limit_events (
  bucket     text not null,
  key        text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_idx on rate_limit_events (bucket, key, created_at desc);

-- ---------------------------------------------------------------- disputes
-- "Someone has claimed my reg number" (CLAUDE.md section 5).
create table member_number_disputes (
  id                       uuid primary key default gen_random_uuid(),
  campus_id                uuid not null references campuses (id),
  member_number_normalised text not null check (member_number_normalised ~ '^[A-Z0-9/]+$'),
  reporter_user_id         uuid not null references users (id) on delete cascade,
  details                  text check (char_length(details) <= 2000),
  status                   text not null default 'open' check (status in ('open', 'resolved')),
  created_at               timestamptz not null default now(),
  resolved_at              timestamptz
);
create index member_number_disputes_open_idx on member_number_disputes (created_at) where status = 'open';
