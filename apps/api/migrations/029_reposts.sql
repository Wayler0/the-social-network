-- Reposts (team request 26 Nov 2026).
-- Feed: any member may repost a campus feed post to the feed, with an optional comment. The repost
-- shows the original only to people who may still see it; deleting the original leaves
-- "no longer available". One repost per member per post.
alter table posts add column repost_of uuid references posts (id) on delete set null;
create index posts_repost_of_idx on posts (repost_of) where repost_of is not null;
create unique index posts_one_repost_idx on posts (author_user_id, repost_of) where repost_of is not null and deleted_at is null;
alter table posts drop constraint posts_body_check;
alter table posts add constraint posts_body_check
  check (char_length(btrim(body)) between 1 and 2000
         or ((event_id is not null or repost_of is not null) and char_length(body) <= 2000));

-- Stories: like WhatsApp, others may add your story to theirs only if you allow it (off by default).
alter table stories add column allow_reshare boolean not null default false;

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('comment', 'answer', 'follow', 'group_request', 'group_approved', 'event_cancelled', 'story', 'office_story', 'emergency', 'repost'));
