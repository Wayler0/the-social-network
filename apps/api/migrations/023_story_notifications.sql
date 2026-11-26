-- Notifications for new stories (team request 25 Nov 2026): from people you follow ('story') and
-- from official accounts ('office_story'). One unread notification per author: more stories from
-- the same person while it is unread just add to its count. Push kind 'stories' (can be turned off).
alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('comment', 'answer', 'follow', 'group_request', 'group_approved', 'event_cancelled', 'story', 'office_story'));
alter table notifications drop constraint notifications_target_type_check;
alter table notifications add constraint notifications_target_type_check
  check (target_type in ('post', 'question', 'user', 'group', 'event', 'office'));
