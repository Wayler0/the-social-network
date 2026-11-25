-- Stories (v0.2; CLAUDE.md section 4 "Stories / status"): photo or text, gone after 24 hours.
-- Personal stories go to followers (or close friends), never to people the author hides them from;
-- an under-18 author's only to people they follow back; a student's to staff only if the student
-- follows them. Office stories reach everyone on the campus, club stories the club's followers and
-- members. The rules live in apps/api/src/visibility.ts (visibleStory).
--
-- Expired or deleted stories are removed by housekeeping, except reported ones, which are kept for
-- moderators until the report is closed (section 6).
create table stories (
  id               uuid primary key default gen_random_uuid(),
  campus_id        uuid not null references campuses (id),
  author_user_id   uuid not null references users (id),                       -- who posted it
  author_office_id uuid references office_accounts (id) on delete cascade,   -- posted as an office
  author_group_id  uuid references groups (id) on delete cascade,            -- posted as a club
  body             text check (char_length(btrim(body)) between 1 and 500),
  image_id         uuid references images (id) on delete set null,
  audience         text not null default 'followers' check (audience in ('followers', 'close_friends')),
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  hidden_at        timestamptz,
  hidden_by        uuid references users (id) on delete set null,            -- null with hidden_at set = auto-hidden
  deleted_at       timestamptz,
  constraint story_one_page check (author_office_id is null or author_group_id is null),
  constraint story_close_friends_personal check (audience = 'followers' or (author_office_id is null and author_group_id is null)),
  constraint story_has_content check (body is not null or image_id is not null or deleted_at is not null),
  constraint story_expires_after_created check (expires_at > created_at)
);
create unique index stories_image_key on stories (image_id) where image_id is not null;
create index stories_live_idx on stories (campus_id, expires_at) where hidden_at is null and deleted_at is null;
create index stories_author_idx on stories (author_user_id, created_at desc);
create index stories_office_idx on stories (author_office_id) where author_office_id is not null;
create index stories_group_idx on stories (author_group_id) where author_group_id is not null;

-- Who saw a story (the author's viewer list).
create table story_views (
  story_id  uuid not null references stories (id) on delete cascade,
  viewer_id uuid not null references users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index story_views_viewer_idx on story_views (viewer_id);

-- "Close friends": a member's own list, for stories shared with close friends only.
create table close_friends (
  user_id    uuid not null references users (id) on delete cascade,
  friend_id  uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint no_self_close_friend check (user_id <> friend_id)
);
create index close_friends_friend_idx on close_friends (friend_id);

-- "Hide my stories from": people who never see this member's stories.
create table story_hidden_from (
  user_id        uuid not null references users (id) on delete cascade,
  hidden_user_id uuid not null references users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, hidden_user_id),
  constraint no_self_story_hide check (user_id <> hidden_user_id)
);
create index story_hidden_from_hidden_idx on story_hidden_from (hidden_user_id);

-- Stories can be reported like everything else.
alter table reports drop constraint reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('post', 'comment', 'user', 'group', 'question', 'answer', 'story'));
