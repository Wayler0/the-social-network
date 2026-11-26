-- Editing a post's text after posting (usability review 25 Nov 2026). The post shows "Edited".
-- Earlier versions are kept for moderators only, so editing can't hide what was reported; they are
-- deleted with the post (unless a report is still open) and included in the author's data export.
alter table posts add column edited_at timestamptz;

create table post_edits (
  id        uuid primary key default gen_random_uuid(),
  post_id   uuid not null references posts (id) on delete cascade,
  body      text not null,          -- the text before this edit
  edited_at timestamptz not null default now()
);
create index post_edits_post_idx on post_edits (post_id, edited_at);
