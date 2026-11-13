-- Today board and Ask a Senior (CLAUDE.md sections 4 and 13; docs/api-contract.md sections 9 and 10).

-- ---------------------------------------------------------------- announcements
create table announcements (
  id           uuid primary key default gen_random_uuid(),
  campus_id    uuid not null references campuses (id),
  office_id    uuid not null references office_accounts (id) on delete cascade,
  created_by   uuid references users (id) on delete set null,        -- the office member who posted it
  title        text not null check (char_length(btrim(title)) between 1 and 140),
  body         text not null check (char_length(btrim(body)) between 1 and 5000),
  urgency      text not null default 'normal' check (urgency in ('normal', 'urgent')),
  pinned_until timestamptz,                                          -- null = not pinned
  created_at   timestamptz not null default now(),
  constraint pinned_after_created check (pinned_until is null or pinned_until > created_at)
);
-- Today board: pinned and urgent first, then newest.
create index announcements_board_idx on announcements (campus_id, created_at desc, id desc);
create index announcements_pinned_idx on announcements (campus_id, pinned_until) where pinned_until is not null;

-- ---------------------------------------------------------------- questions
-- hide_name hides the asker from other members only; admins can always see user_id.
create table questions (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid not null references campuses (id),
  user_id    uuid not null references users (id),
  hide_name  boolean not null default false,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  hidden_at  timestamptz,
  hidden_by  uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);
-- Newest first within a campus.
create index questions_recent_idx on questions (campus_id, created_at desc, id desc) where hidden_at is null;
create index questions_user_idx on questions (user_id);
-- Basic search ("answers stay searchable").
create index questions_search_idx on questions using gin (to_tsvector('english', body));

-- ---------------------------------------------------------------- answers
create table answers (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions (id) on delete cascade,
  user_id     uuid not null references users (id),
  body        text not null check (char_length(btrim(body)) between 1 and 5000),
  hidden_at   timestamptz,
  hidden_by   uuid references users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index answers_question_idx on answers (question_id, created_at, id) where hidden_at is null;
create index answers_user_idx on answers (user_id);
create index answers_search_idx on answers using gin (to_tsvector('english', body));

-- ---------------------------------------------------------------- answer_helpful
-- The "helpful" toggle; answers are listed most helpful first.
create table answer_helpful (
  answer_id  uuid not null references answers (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (answer_id, user_id)
);
