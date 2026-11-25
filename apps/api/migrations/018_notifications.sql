-- Notifications and Web Push (v0.2; CLAUDE.md sections 4 and 12: "Web Push (VAPID)").
-- The inbox always records; push respects each member's settings. Push text is generic (it shows
-- on lock screens and passes through the browser makers' push services, encrypted): no names, no
-- content. Code: apps/api/src/notifications/.

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  type          text not null check (type in ('comment', 'answer', 'follow', 'group_request', 'group_approved', 'event_cancelled')),
  actor_user_id uuid references users (id) on delete set null,        -- who did it (latest, when collapsed)
  target_type   text not null check (target_type in ('post', 'question', 'user', 'group', 'event')),
  target_id     uuid not null,
  count         integer not null default 1 check (count >= 1),       -- collapsed: "3 new comments on your post"
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index notifications_inbox_idx on notifications (user_id, created_at desc, id desc);
-- One unread notification per member, kind and thing: a burst of comments is one notification.
create unique index notifications_unread_key on notifications (user_id, type, target_id) where read_at is null;

-- Browsers subscribed to push (one row per browser or installed app).
create table push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  endpoint        text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2000),
  p256dh          text not null check (char_length(p256dh) between 1 and 200),
  auth            text not null check (char_length(auth) between 1 and 100),
  user_agent      text check (char_length(user_agent) <= 400),
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  failures        smallint not null default 0
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- Pushes waiting to go out; the API's push worker sends them (no Redis in v0.2 yet).
create table push_outbox (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  kind            text not null,                                     -- the setting it belongs to, e.g. 'comments', 'urgent'
  title           text not null check (char_length(title) <= 200),
  body            text not null check (char_length(body) <= 300),
  url             text not null check (url ~ '^/' and char_length(url) <= 300),   -- a path in the app
  created_at      timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts        smallint not null default 0,
  sent_at         timestamptz
);
create index push_outbox_due_idx on push_outbox (next_attempt_at) where sent_at is null;

-- Push settings: { "comments": false, ... }; anything missing is on.
alter table users add column notification_prefs jsonb not null default '{}'::jsonb;
