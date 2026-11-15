-- Groups and club pages (CLAUDE.md sections 4 and 13; docs/api-contract.md section 8).
-- Clubs are groups with kind = 'club' and posting = 'admins_only'; the CLUB badge shows when
-- club_verified_at is set. Student-only groups are invisible to staff (enforced in the API).

-- ---------------------------------------------------------------- groups
create table groups (
  id                uuid primary key default gen_random_uuid(),
  campus_id         uuid not null references campuses (id),
  name              text not null check (char_length(name) between 1 and 120),
  description       text check (char_length(description) <= 1000),
  visibility        text not null default 'public' check (visibility in ('public', 'private')),
  student_only      boolean not null default false,
  kind              text not null default 'group' check (kind in ('group', 'club')),
  posting           text not null default 'everyone' check (posting in ('everyone', 'admins_only')),
  -- Class groups made automatically from profiles: one per course and year of study.
  auto_type         text not null default 'none' check (auto_type in ('none', 'course_year')),
  auto_course       text check (char_length(auto_course) between 1 and 120),
  auto_year         smallint check (auto_year between 1 and 8),
  club_verified_at  timestamptz,
  club_verified_by  uuid references users (id) on delete set null,
  office_account_id uuid references office_accounts (id) on delete set null,   -- club handover (v0.2)
  created_by        uuid references users (id) on delete set null,             -- null = created by the system
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint auto_group_fields check (
    (auto_type = 'course_year' and auto_course is not null and auto_year is not null)
    or (auto_type = 'none' and auto_course is null and auto_year is null)
  ),
  constraint club_badge_only_on_clubs check (club_verified_at is null or kind = 'club')
);
-- Exactly one class group per course and year per campus. The API finds or creates it with
--   insert ... on conflict (campus_id, lower(auto_course), auto_year) where auto_type = 'course_year' do nothing
create unique index groups_course_year_key on groups (campus_id, lower(auto_course), auto_year)
  where auto_type = 'course_year';
-- Discover list: newest first within a campus.
create index groups_discover_idx on groups (campus_id, created_at desc, id desc);

create trigger groups_updated_at before update on groups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- group_members
create table group_members (
  group_id  uuid not null references groups (id) on delete cascade,
  user_id   uuid not null references users (id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  status    text not null default 'active' check (status in ('pending', 'active')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
-- "My groups".
create index group_members_user_idx on group_members (user_id, status);
-- Member count and the admins' list of pending requests.
create index group_members_status_idx on group_members (group_id, status);
