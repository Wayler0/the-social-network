-- Moving up a year (team decision 25 Nov 2026). Each campus says when its academic year starts
-- (campus is data, CLAUDE.md section 13). A student's year_of_study belongs to one academic year
-- (study_year_academic_year, e.g. 2026 = the year that starts in September 2026). When a new
-- academic year starts, the API moves them up and asks them to confirm (year_check_from = the year
-- they were in, until they answer).

alter table campuses
  add column academic_year_start_month smallint not null default 9 check (academic_year_start_month between 1 and 12),
  add column academic_year_start_day   smallint not null default 1 check (academic_year_start_day between 1 and 28);

-- First campus: the academic year starts on 1 September.
update campuses set academic_year_start_month = 9, academic_year_start_day = 1 where slug = 'tharaka';

-- The academic year a moment falls in, for a campus: 2026 from 1 Sep 2026 to 31 Aug 2027 (Nairobi time).
create function academic_year(campus uuid, at timestamptz default now()) returns int
language sql stable as $$
  select extract(year from at at time zone 'Africa/Nairobi')::int
         - case when (at at time zone 'Africa/Nairobi')::date
                     < make_date(extract(year from at at time zone 'Africa/Nairobi')::int, c.academic_year_start_month, c.academic_year_start_day)
                then 1 else 0 end
    from campuses c where c.id = campus
$$;

alter table users
  add column study_year_academic_year int,   -- which academic year year_of_study refers to
  add column year_check_from smallint;       -- set when moved up automatically: the year they were in, until they confirm

-- Everyone's current year is taken as this academic year's.
update users set study_year_academic_year = academic_year(campus_id)
 where year_of_study is not null and deleted_at is null;
