-- db/seeds/dev/0001_test_users.sql
-- DEVELOPMENT ONLY — never run on the live server (migrate.sh refuses when
-- APP_ENV=production). Fake people, fake reg numbers. Safe to run again.
--
-- To sign in as one of these, request a code for the email and read it from
-- the API's dev log (no real mailbox exists for them).

INSERT INTO users (id, name, email, member_type, member_number, member_number_status,
                   course_id, year_of_study, graduation_year, bio, interests,
                   verified, verified_method, verified_at, is_under_18) VALUES
    ('00000000-0000-4000-c000-000000000001', 'Dev Fresher (17)',  'dev.fresher17@student.tharaka.ac.ke',  'fresher',    'DEV1/00001/26', 'verified',
     '00000000-0000-4000-b000-000000000001', 1, NULL, 'Test fresher, under 18.', '{coding,football}', true, 'email_code', now(), true),
    ('00000000-0000-4000-c000-000000000002', 'Dev Fresher',       'dev.fresher@student.tharaka.ac.ke',    'fresher',    'DEV1/00002/26', 'verified',
     '00000000-0000-4000-b000-000000000003', 1, NULL, 'Test fresher.', '{music}', true, 'email_code', now(), false),
    ('00000000-0000-4000-c000-000000000003', 'Dev Continuing',    'dev.continuing@student.tharaka.ac.ke', 'continuing', 'DEV1/00003/24', 'verified',
     '00000000-0000-4000-b000-000000000001', 3, NULL, 'Test continuing student.', '{coding,chess}', true, 'email_code', now(), false),
    ('00000000-0000-4000-c000-000000000004', 'Dev Alumna',        'dev.alumna@student.tharaka.ac.ke',     'alumni',     'DEV1/00004/19', 'verified',
     '00000000-0000-4000-b000-000000000001', NULL, 2023, 'Test alumna.', '{mentoring}', true, 'admin', now(), false),
    ('00000000-0000-4000-c000-000000000005', 'Dev Lecturer',      'dev.lecturer@tharaka.ac.ke',           'staff',      'DEVSTAFF/0001', 'verified',
     NULL, NULL, NULL, 'Test staff member.', '{}', true, 'admin', now(), false),
    ('00000000-0000-4000-c000-000000000006', 'Dev Moderator',     'dev.moderator@student.tharaka.ac.ke',  'continuing', 'DEV1/00006/23', 'verified',
     '00000000-0000-4000-b000-000000000002', 4, NULL, 'Test moderator.', '{}', true, 'email_code', now(), false),
    ('00000000-0000-4000-c000-000000000007', 'Dev Admin',         'dev.admin@student.tharaka.ac.ke',      'continuing', 'DEV1/00007/23', 'verified',
     '00000000-0000-4000-b000-000000000001', 4, NULL, 'Test admin.', '{}', true, 'email_code', now(), false),
    ('00000000-0000-4000-c000-000000000008', NULL,                'dev.unfinished@student.tharaka.ac.ke', NULL,         NULL,            'unverified',
     NULL, NULL, NULL, NULL, '{}', false, NULL, NULL, false)
ON CONFLICT DO NOTHING;

INSERT INTO roles (id, user_id, role, title) VALUES
    ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-c000-000000000005', 'staff',     'Lecturer (dev)'),
    ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-c000-000000000006', 'moderator', 'Moderator (dev)'),
    ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-c000-000000000007', 'admin',     'Admin (dev)')
ON CONFLICT DO NOTHING;

-- Put each test student in their class group.
INSERT INTO group_members (group_id, user_id, role, status)
SELECT g.id, u.id, 'member', 'active'
FROM users u
JOIN groups g ON g.auto_type = 'course_year'
             AND g.course_id = u.course_id
             AND g.year_of_study = u.year_of_study
WHERE u.email LIKE 'dev.%'
ON CONFLICT DO NOTHING;
