-- Blocks, reports and the admin log (CLAUDE.md section 6; docs/api-contract.md sections 7 and 11).

-- ---------------------------------------------------------------- blocks
create table blocks (
  blocker_id uuid not null references users (id) on delete cascade,
  blocked_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
-- "Has this person blocked me?" (profiles return 404 when blocked either way).
create index blocks_blocked_idx on blocks (blocked_id);

-- ---------------------------------------------------------------- reports
-- target_id points at different tables depending on target_type, so it has no foreign key:
-- the API checks that the target exists before inserting.
create table reports (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid not null references campuses (id),
  reporter_id uuid references users (id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'user', 'group', 'question', 'answer')),
  target_id   uuid not null,
  reason      text not null check (reason in
                ('spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'false_info', 'other')),
  details     text check (char_length(details) <= 2000),
  status      text not null default 'open' check (status in ('open', 'hidden', 'dismissed')),
  resolved_by uuid references users (id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint resolved_fields check ((status = 'open') = (resolved_at is null))
);
-- Admin queue: oldest open report first.
create index reports_queue_idx on reports (campus_id, created_at) where status = 'open';
-- Report count per item, and the auto-hide rule (3 open reports from different members).
create index reports_target_idx on reports (target_type, target_id) where status = 'open';
-- A member can have one open report per item, so the count of 3 means 3 different members.
create unique index reports_one_open_key on reports (reporter_id, target_type, target_id)
  where status = 'open' and reporter_id is not null;

-- ---------------------------------------------------------------- admin_log
-- Every admin action: who, what, when. Rows are never updated or deleted by the app.
create table admin_log (
  id            uuid primary key default gen_random_uuid(),
  campus_id     uuid references campuses (id),
  admin_user_id uuid references users (id) on delete set null,
  action        text not null check (char_length(action) between 1 and 60),   -- e.g. 'user.suspend', 'post.hide'
  target_type   text check (char_length(target_type) <= 40),
  target_id     uuid,
  details       jsonb,                                                -- e.g. {"reason": "...", "until": "..."}
  created_at    timestamptz not null default now()
);
create index admin_log_recent_idx on admin_log (created_at desc);
create index admin_log_target_idx on admin_log (target_type, target_id);
create index admin_log_admin_idx on admin_log (admin_user_id, created_at desc);
