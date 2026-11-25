import { inTransaction, type Db } from '../db.js';
import { syncClassGroup } from '../groups/class-groups.js';

/**
 * Moving up a year (migration 019). When a new academic year has started since a student's year
 * was set (campuses.academic_year_start_month/day, 1 September for the first campus), move them up
 * by the years that passed (Year 8 at most), make a fresher a continuing student, move them to the
 * class group of their new year, and remember the year they were in (year_check_from) so the app
 * can ask "You're now in Year 3, right?". Their answer clears it (POST /api/me/year-check, or a
 * corrected year or "I've graduated" through PATCH /api/me).
 *
 * Runs when the member opens the app (GET /api/me), so nothing needs to run on 1 September.
 * Returns true when they were moved up.
 */
export async function rollStudyYear(db: Db, userId: string): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query(
      `update users u
          set year_check_from = coalesce(u.year_check_from, u.year_of_study),
              year_of_study = least(8, u.year_of_study + (academic_year(u.campus_id) - u.study_year_academic_year)),
              member_type = case when u.member_type = 'fresher' then 'continuing' else u.member_type end,
              study_year_academic_year = academic_year(u.campus_id)
        where u.id = $1 and u.deleted_at is null and u.member_type in ('fresher', 'continuing')
          and u.year_of_study is not null and u.study_year_academic_year is not null
          and u.study_year_academic_year < academic_year(u.campus_id)
        returning u.id`,
      [userId],
    );
    if (rows.length === 0) return false;
    await syncClassGroup(tx, userId);
    return true;
  });
}
