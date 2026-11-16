-- Follows (v0.2; CLAUDE.md sections 4 and 13): members follow people, verified office accounts and
-- public clubs. Following a club puts its announcements in your feed; following people and
-- offices decides whose stories you see.
--
-- target_type + target_id is polymorphic, so there is no foreign key on target_id: the API checks
-- the target exists when following, blocking and account deletion remove follows, and the hourly
-- housekeeping job removes any left pointing at nothing (apps/api/src/follows/routes.ts).
create table follows (
  follower_id uuid not null references users (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'office', 'group')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (follower_id, target_type, target_id),
  constraint no_self_follow check (target_type <> 'user' or target_id <> follower_id)
);
-- "Who follows this?" (follower counts, story audiences, club announcements).
create index follows_target_idx on follows (target_type, target_id, created_at desc);
-- "Whom do I follow, newest first?"
create index follows_follower_idx on follows (follower_id, created_at desc);
