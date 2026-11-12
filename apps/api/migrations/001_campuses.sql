-- Campuses are data, not code (CLAUDE.md: Positioning, section 13).
-- gen_random_uuid() is built into PostgreSQL 13+.

create table campuses (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name       text not null,
  status     text not null default 'active' check (status in ('active', 'coming_soon')),
  created_at timestamptz not null default now()
);

create table campus_email_domains (
  campus_id   uuid not null references campuses (id) on delete cascade,
  domain      text primary key check (domain = lower(domain)),
  member_type text not null check (member_type in ('student', 'staff'))
);

-- First campus.
with c as (
  insert into campuses (slug, name) values ('tharaka', 'Tharaka University') returning id
)
insert into campus_email_domains (campus_id, domain, member_type)
select id, 'student.tharaka.ac.ke', 'student' from c
union all
select id, 'tharaka.ac.ke', 'staff' from c;
