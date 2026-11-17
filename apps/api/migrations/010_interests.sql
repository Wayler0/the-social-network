-- Interests on profiles (CLAUDE.md section 2, issue #20): what a member likes, e.g. "Football",
-- "Web development". Shown on their profile; later used to suggest groups and target ads
-- (section 8: only what members tell us). Up to 10, each 1–40 characters (checked in the API).
alter table users add column interests text[] not null default '{}'
  check (cardinality(interests) <= 10);
