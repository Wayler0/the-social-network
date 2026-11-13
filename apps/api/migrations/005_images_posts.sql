-- Images, posts, comments and likes (CLAUDE.md section 13; docs/api-contract.md sections 5 and 6).
-- Authors are not removed with their account: a deleted member's posts and comments stay and
-- show "Deleted member" (contract section 4), so author columns do not cascade.

-- ---------------------------------------------------------------- images
-- One row per uploaded image. Files live in the media folder on disk (no MinIO in v0.1):
-- <path>/1080.webp and <path>/320.webp. EXIF and location are stripped before saving.
create table images (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id),                   -- who uploaded it
  path        text not null unique check (path ~ '^[a-z0-9/_-]+$'),  -- folder under the media root, no dots
  width       integer not null check (width between 1 and 1080),
  height      integer not null check (height between 1 and 20000),
  bytes       integer not null check (bytes > 0),
  attached_at timestamptz,                                           -- set when a post or profile uses it
  created_at  timestamptz not null default now()
);
-- Cleanup job: delete images with attached_at is null and created_at older than 24 h.
create index images_unattached_idx on images (created_at) where attached_at is null;
create index images_user_idx on images (user_id);

-- ---------------------------------------------------------------- posts
create table posts (
  id               uuid primary key default gen_random_uuid(),
  campus_id        uuid not null references campuses (id),
  author_user_id   uuid not null references users (id),
  author_office_id uuid references office_accounts (id) on delete set null,   -- posted as an office
  group_id         uuid references groups (id) on delete cascade,             -- null = campus feed
  body             text not null check (char_length(btrim(body)) between 1 and 2000),
  image_id         uuid references images (id) on delete set null,
  hidden_at        timestamptz,                                      -- hidden by a moderator or by reports
  hidden_by        uuid references users (id) on delete set null,    -- null with hidden_at set = auto-hidden
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz                                       -- deleted by the author; kept for open reports
);
-- An image belongs to at most one post.
create unique index posts_image_key on posts (image_id) where image_id is not null;
-- Campus feed, newest first, cursor on (created_at, id).
create index posts_feed_idx on posts (campus_id, created_at desc, id desc)
  where group_id is null and hidden_at is null and deleted_at is null;
-- Group feed.
create index posts_group_feed_idx on posts (group_id, created_at desc, id desc)
  where group_id is not null and hidden_at is null and deleted_at is null;
-- Profile page and "delete my account".
create index posts_author_idx on posts (author_user_id, created_at desc);
create index posts_office_idx on posts (author_office_id, created_at desc) where author_office_id is not null;

-- ---------------------------------------------------------------- comments
create table comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts (id) on delete cascade,
  user_id    uuid not null references users (id),
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  hidden_at  timestamptz,
  hidden_by  uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Comments under a post, oldest first; also gives commentCount.
create index comments_post_idx on comments (post_id, created_at, id)
  where hidden_at is null and deleted_at is null;
create index comments_user_idx on comments (user_id);

-- ---------------------------------------------------------------- likes
create table likes (
  user_id    uuid not null references users (id) on delete cascade,
  post_id    uuid not null references posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)                                     -- one like per member; makes PUT idempotent
);
-- likeCount.
create index likes_post_idx on likes (post_id);
