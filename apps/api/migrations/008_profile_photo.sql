-- Profile photos (docs/api-contract.md section 4, issue #20).
-- users.photo_url keeps the address shown in the app; photo_image_id says which uploaded image it
-- is, so a replaced or removed photo's files can be deleted (images are personal data).
alter table users add column photo_image_id uuid references images (id) on delete set null;
create unique index users_photo_image_key on users (photo_image_id) where photo_image_id is not null;
