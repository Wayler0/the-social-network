-- Liking a story (team request 25 Nov 2026). Only whoever manages the story sees who liked it
-- (with the viewer list). Likes go with the story when it expires or is deleted, and with the
-- member when they delete their account.
create table story_likes (
  story_id   uuid not null references stories (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index story_likes_user_idx on story_likes (user_id);
