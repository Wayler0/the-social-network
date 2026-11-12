-- db/seeds/reference/0001_schools_courses.sql
-- SAMPLE DATA — replace with the Registrar's official list of schools and
-- programmes before launch. Only the structure is final.
-- Safe to run more than once.

INSERT INTO schools (id, name) VALUES
    ('00000000-0000-4000-a000-000000000001', 'Faculty of Physical Science, Engineering and Technology'),
    ('00000000-0000-4000-a000-000000000002', 'Faculty of Business Studies (sample)'),
    ('00000000-0000-4000-a000-000000000003', 'Faculty of Education (sample)')
ON CONFLICT DO NOTHING;

INSERT INTO courses (id, school_id, code, name, duration_years) VALUES
    ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'BSC-CS',  'BSc Computer Science', 4),
    ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'BSC-IT',  'BSc Information Technology (sample)', 4),
    ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'BCOM',    'Bachelor of Commerce (sample)', 4),
    ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000003', 'BED-ARTS','Bachelor of Education Arts (sample)', 4),
    ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-a000-000000000001', 'DIP-IT',  'Diploma in Information Technology (sample)', 2)
ON CONFLICT DO NOTHING;
