-- Club announcements (v0.2; CLAUDE.md section 4 "Club pages"): a club page has an Announcements
-- tab (admins only) and a Discussion tab (members). Announcements of a public club can be read by
-- anyone on the campus who may see the club, and reach the feeds of its followers and members.
alter table posts add column announcement boolean not null default false;
alter table posts add constraint announcement_in_group check (not announcement or group_id is not null);

-- In v0.1, clubs with "only admins can post" used their posts as announcements.
update posts p set announcement = true
  from groups g
 where g.id = p.group_id and g.kind = 'club' and g.posting = 'admins_only';

-- Announcements of the clubs a member follows or belongs to, newest first (the feed).
create index posts_club_announcements_idx on posts (group_id, created_at desc, id desc)
  where announcement and hidden_at is null and deleted_at is null;
