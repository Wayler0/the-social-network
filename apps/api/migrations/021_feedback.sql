-- In-app feedback (team request 25 Nov 2026). On the third day a member opens the app, it asks
-- "Enjoying it?" with 1-5 stars and an optional comment. Admins read feedback WITHOUT names, so
-- people can be honest. Deleted with the account; in the member's data export.
create table feedback (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid not null references campuses (id),
  user_id    uuid not null references users (id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index feedback_campus_created_idx on feedback (campus_id, created_at desc, id desc);

alter table users
  add column active_days int not null default 0,          -- different days (Nairobi time) the member opened the app
  add column last_active_on date,
  add column feedback_ask_at_day int not null default 3,  -- ask once active_days reaches this; "Not now" moves it 3 days on
  add column feedback_given_at timestamptz;               -- answered: never ask again
