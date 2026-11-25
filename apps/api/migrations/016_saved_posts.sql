-- Saved posts (team feedback 24 Nov 2026): a member bookmarks posts to read later.
-- Private: only the member sees what they saved; nobody is told. Deleted with the account.
create table saved_posts (
  user_id    uuid not null references users (id) on delete cascade,
  post_id    uuid not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)                                     -- one save per member; makes PUT idempotent
);
-- "My saved posts", newest save first.
create index saved_posts_user_created_idx on saved_posts (user_id, created_at desc, post_id desc);
