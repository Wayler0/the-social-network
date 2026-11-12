-- db/seeds/dev/0002_sample_content.sql
-- DEVELOPMENT ONLY. A little content so screens are not empty.
-- Safe to run again.

INSERT INTO office_accounts (id, name, type, verified) VALUES
    ('00000000-0000-4000-e000-000000000001', 'Student Council (dev)', 'student_council', true),
    ('00000000-0000-4000-e000-000000000002', 'Library (dev)',         'office',          true)
ON CONFLICT DO NOTHING;

INSERT INTO office_members (office_id, user_id, role) VALUES
    ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-c000-000000000007', 'owner'),
    ('00000000-0000-4000-e000-000000000002', '00000000-0000-4000-c000-000000000005', 'owner')
ON CONFLICT DO NOTHING;

INSERT INTO announcements (id, office_id, created_by, title, body, urgency, pinned_until) VALUES
    ('00000000-0000-4000-f000-000000000001', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-c000-000000000007',
     'Welcome to Hatua (dev)', 'This is a normal test announcement.', 'normal', now() + interval '30 days'),
    ('00000000-0000-4000-f000-000000000002', '00000000-0000-4000-e000-000000000002', '00000000-0000-4000-c000-000000000005',
     'Library closes early today (dev)', 'This is an urgent test announcement.', 'urgent', now() + interval '30 days')
ON CONFLICT DO NOTHING;

INSERT INTO groups (id, name, description, visibility, kind, posting, created_by) VALUES
    ('00000000-0000-4000-9000-000000000001', 'Chess Club (dev)', 'Test club page: only admins can post.', 'public', 'club', 'admins_only', '00000000-0000-4000-c000-000000000003'),
    ('00000000-0000-4000-9000-000000000002', 'Weekend Football (dev)', 'Test ordinary group.', 'public', 'group', 'everyone', '00000000-0000-4000-c000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO group_members (group_id, user_id, role, status) VALUES
    ('00000000-0000-4000-9000-000000000001', '00000000-0000-4000-c000-000000000003', 'admin',  'active'),
    ('00000000-0000-4000-9000-000000000002', '00000000-0000-4000-c000-000000000002', 'admin',  'active'),
    ('00000000-0000-4000-9000-000000000002', '00000000-0000-4000-c000-000000000001', 'member', 'pending')
ON CONFLICT DO NOTHING;

INSERT INTO posts (id, author_user_id, group_id, body) VALUES
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-c000-000000000003', NULL, 'First test post on the main feed.'),
    ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-c000-000000000005', NULL, 'Test post from a staff member.'),
    ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-c000-000000000003', '00000000-0000-4000-9000-000000000001', 'Club announcement: test fixture on Saturday.')
ON CONFLICT DO NOTHING;

INSERT INTO comments (id, post_id, user_id, body) VALUES
    ('00000000-0000-4000-8100-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-c000-000000000002', 'Test comment.')
ON CONFLICT DO NOTHING;

INSERT INTO likes (user_id, post_id) VALUES
    ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO questions (id, user_id, hide_name, body) VALUES
    ('00000000-0000-4000-8200-000000000001', '00000000-0000-4000-c000-000000000001', true,  'Where do I collect my student ID? (test, name hidden)'),
    ('00000000-0000-4000-8200-000000000002', '00000000-0000-4000-c000-000000000002', false, 'Which hostels are closest to the library? (test)')
ON CONFLICT DO NOTHING;

INSERT INTO answers (id, question_id, user_id, body) VALUES
    ('00000000-0000-4000-8300-000000000001', '00000000-0000-4000-8200-000000000001', '00000000-0000-4000-c000-000000000004', 'Test answer from an alumna.')
ON CONFLICT DO NOTHING;
