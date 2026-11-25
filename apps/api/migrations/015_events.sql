-- Events with Going / Interested (v0.2, ROADMAP "After launch"). Campus-wide, hosted by an office,
-- or in a group. Who sees what lives in apps/api/src/visibility.ts (visibleEvent): campus events
-- for everyone on the campus, group events for members, a public club's events for anyone who may
-- see the club. Places on the map come with v0.3; until then the location is text.
create table events (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid not null references campuses (id),
  created_by  uuid not null references users (id),
  office_id   uuid references office_accounts (id) on delete cascade,   -- hosted by an office
  group_id    uuid references groups (id) on delete cascade,            -- a group's event
  title       text not null check (char_length(btrim(title)) between 1 and 140),
  description text check (char_length(description) <= 5000),
  location    text check (char_length(btrim(location)) between 1 and 200),
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  image_id    uuid references images (id) on delete set null,
  cancelled_at timestamptz,
  hidden_at   timestamptz,
  hidden_by   uuid references users (id) on delete set null,            -- null with hidden_at set = auto-hidden
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint event_ends_after_start check (ends_at is null or ends_at > starts_at),
  constraint event_one_host check (office_id is null or group_id is null)
);
create unique index events_image_key on events (image_id) where image_id is not null;
create index events_upcoming_idx on events (campus_id, starts_at, id) where hidden_at is null and deleted_at is null;
create index events_group_idx on events (group_id, starts_at) where group_id is not null;
create index events_creator_idx on events (created_by);

create table event_rsvps (
  event_id   uuid not null references events (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  status     text not null check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_rsvps_user_idx on event_rsvps (user_id, status);

alter table reports drop constraint reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('post', 'comment', 'user', 'group', 'question', 'answer', 'story', 'event'));
