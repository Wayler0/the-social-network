-- Members can delete their own questions and answers (Ask a Senior, issue #27 follow-up).
-- Like posts and comments, deleted rows are kept (deleted_at) so open reports and the admin log
-- still point at something; nobody else sees them.
alter table questions add column deleted_at timestamptz;
alter table answers   add column deleted_at timestamptz;
