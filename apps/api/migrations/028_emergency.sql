-- Emergency button (CLAUDE.md section 4, MVP item 8): a member alerts moderators and the campus's
-- safety offices directly, and sees emergency numbers. No location: the brief allows it only if the
-- member chooses to share it, and the database server has no PostGIS yet (add it with the map).

-- Numbers are campus data, not code: [{ "label": "Campus security", "phone": "+254…" }, …].
-- Set them on the server (docs/HANDOVER.md). National numbers to start with.
alter table campuses add column emergency_contacts jsonb not null default '[]'
  check (jsonb_typeof(emergency_contacts) = 'array');
update campuses set emergency_contacts =
  '[{"label": "Police, fire and ambulance", "phone": "999"}, {"label": "Emergency (any network)", "phone": "112"}]';

-- Offices that receive emergency alerts (security, health centre, Dean of Students), set by admins.
alter table office_accounts add column safety boolean not null default false;

create table emergency_alerts (
  id          uuid primary key default gen_random_uuid(),
  campus_id   uuid not null references campuses (id),
  user_id     uuid references users (id) on delete set null,
  message     text check (char_length(message) <= 500),
  status      text not null default 'open' check (status in ('open', 'handled')),
  handled_by  uuid references users (id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index emergency_alerts_open_idx on emergency_alerts (campus_id, status, created_at desc);

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('comment', 'answer', 'follow', 'group_request', 'group_approved', 'event_cancelled', 'story', 'office_story', 'emergency'));
alter table notifications drop constraint notifications_target_type_check;
alter table notifications add constraint notifications_target_type_check
  check (target_type in ('post', 'question', 'user', 'group', 'event', 'office', 'emergency'));
