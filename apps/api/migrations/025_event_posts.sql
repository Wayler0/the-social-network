-- Sharing an event as a post (team request 25 Nov 2026): the post shows an event card under an
-- optional caption. Only events everyone on the campus may see can be shared (campus-wide, an
-- office's, or a public club's that isn't student-only), so sharing never reveals a group's event.
alter table posts add column event_id uuid references events (id) on delete set null;
create index posts_event_idx on posts (event_id) where event_id is not null;

-- A shared event needs no caption; every other post still needs text.
alter table posts drop constraint posts_body_check;
alter table posts add constraint posts_body_check
  check (char_length(btrim(body)) between 1 and 2000 or (event_id is not null and char_length(body) <= 2000));
