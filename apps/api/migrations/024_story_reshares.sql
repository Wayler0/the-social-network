-- Sharing someone's story to your own (team request 25 Nov 2026). A reshare copies nothing: it
-- points at the original and shows its content with "from <name>" credit. It is visible only to
-- people who may also see the original, and disappears with it (expired, deleted or hidden).
alter table stories
  add column reshared_from_story_id uuid references stories (id) on delete cascade;
create index stories_reshared_from_idx on stories (reshared_from_story_id) where reshared_from_story_id is not null;

alter table stories drop constraint story_has_content;
alter table stories add constraint story_has_content
  check (body is not null or image_id is not null or deleted_at is not null or reshared_from_story_id is not null);
