-- Role badges and office accounts (CLAUDE.md sections 3 and 13; docs/api-contract.md sections 9 and 11).
-- Roles are granted by admins, never self-claimed. Office accounts are official pages run by
-- people with a role; the office (history, followers) passes on at handover, people do not.

-- ---------------------------------------------------------------- roles
create table roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  role       text not null check (role in ('staff', 'student_leader', 'club_leader', 'moderator', 'admin')),
  title      text check (char_length(title) between 1 and 120),      -- e.g. "Academic Rep, School of Science"
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,                                            -- null = no fixed end; leader roles expire
  granted_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint role_ends_after_start check (ends_at is null or ends_at > starts_at)
);
-- "Which badges does this member hold now?" and the isAdmin check on every admin route.
create index roles_user_idx on roles (user_id, role);

-- ---------------------------------------------------------------- office_accounts
create table office_accounts (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid not null references campuses (id),
  name       text not null check (char_length(name) between 1 and 120),
  type       text not null check (type in ('department', 'office', 'student_council', 'club')),
  photo_url  text,
  verified   boolean not null default false,                         -- OFFICIAL badge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One office per name per campus ("Library" and "library" are the same office).
create unique index office_accounts_name_key on office_accounts (campus_id, lower(name));

create trigger office_accounts_updated_at before update on office_accounts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- office_members
create table office_members (
  office_id uuid not null references office_accounts (id) on delete cascade,
  user_id   uuid not null references users (id) on delete cascade,
  role      text not null default 'editor' check (role in ('owner', 'editor')),
  starts_at timestamptz not null default now(),
  ends_at   timestamptz,                                             -- set at handover; row kept as history
  primary key (office_id, user_id),
  constraint office_member_ends_after_start check (ends_at is null or ends_at > starts_at)
);
create index office_members_user_idx on office_members (user_id);
