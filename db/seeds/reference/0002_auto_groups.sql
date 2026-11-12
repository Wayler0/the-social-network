-- db/seeds/reference/0002_auto_groups.sql
-- One class group per course and year of study (CLAUDE.md section 4.3).
-- Safe to run more than once; run again after adding courses.

SELECT ensure_course_year_groups() AS auto_groups_created;
