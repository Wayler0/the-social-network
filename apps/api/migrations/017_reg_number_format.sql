-- Registration number format per campus (team feedback 25 Nov 2026: "EBT1" was accepted).
-- Campus is data, not code (CLAUDE.md section 13): each campus row holds its own pattern and an
-- example to show members. The pattern is checked against the normalised number (upper-case,
-- spaces and dashes removed). Staff numbers are not checked: admins approve staff.
-- Null pattern = no format check for that campus.
alter table campuses
  add column reg_number_pattern text,
  add column reg_number_example text;

-- First campus: 2-4 letters and a digit (programme), 5-digit serial, 2-digit year of admission,
-- e.g. ABT5/09919/23.
update campuses
   set reg_number_pattern = '^[A-Z]{2,4}[0-9]/[0-9]{5}/[0-9]{2}$',
       reg_number_example = 'ABT5/09919/23'
 where slug = 'tharaka';
