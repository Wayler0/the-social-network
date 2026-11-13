import type { Queryable } from '../images/store.js';

/**
 * Class groups: one private group per course and year of study on each campus, made and joined
 * automatically from members' profiles (docs/api-contract.md section 8; CLAUDE.md section 4.3).
 *
 * Call `syncClassGroup` whenever a member's course, year of study or member type may have changed,
 * inside the same transaction as that change.
 */

const GROUP_NAME_MAX = 120; // groups.name
const COURSE_MAX = 120;     // groups.auto_course

/** "  bsc   Computer  science " and "BSc Computer Science" are the same course: trim and collapse spaces. */
export function normaliseCourse(course: string): string {
  return course.replace(/\s+/g, ' ').trim();
}

/** The group's display name, shortened if a very long course name would not fit. */
export function classGroupName(course: string, year: number): string {
  const suffix = ` — Year ${year}`;
  const room = GROUP_NAME_MAX - suffix.length;
  const shown = course.length > room ? `${course.slice(0, room - 1).trimEnd()}…` : course;
  return `${shown}${suffix}`;
}

export type ClassGroupResult = {
  /** The class group the member is in now, or null if they have none (staff, alumni, profile not complete). */
  groupId: string | null;
  /** True when this call created the group (the member is the first of their class to arrive). */
  created: boolean;
  /** Class groups the member was removed from (they changed course or year, or stopped being a student). */
  left: string[];
};

/**
 * Puts a member in the class group that matches their profile, and takes them out of any other.
 *
 * - Freshers and continuing students with a course and a year of study belong to exactly one class group.
 * - Everyone else (staff, alumni, profile not completed, deleted account) belongs to none.
 * - Safe to call again and again, and safe when two classmates sign up at the same moment.
 * - Only touches class groups (auto_type = 'course_year'); clubs and ordinary groups are never changed.
 */
export async function syncClassGroup(db: Queryable, userId: string): Promise<ClassGroupResult> {
  const found = await db.query<{ campus_id: string; member_type: string; course: string | null; year_of_study: number | null; deleted_at: Date | null }>(
    'select campus_id, member_type, course, year_of_study, deleted_at from users where id = $1',
    [userId],
  );
  const user = found.rows[0];
  if (!user) throw new Error(`syncClassGroup: no user ${userId}`);

  const course = user.course ? normaliseCourse(user.course) : '';
  const isStudent = user.member_type === 'fresher' || user.member_type === 'continuing';
  const belongs = isStudent && !user.deleted_at && course !== '' && course.length <= COURSE_MAX && user.year_of_study !== null;

  let groupId: string | null = null;
  let created = false;
  if (belongs) {
    const year = user.year_of_study!;
    // Find or create. The unique index on (campus, lower(course), year) decides the race when two
    // classmates arrive together: one insert wins, the other finds the winner's row just below.
    const made = await db.query<{ id: string }>(
      `insert into groups (campus_id, name, description, visibility, auto_type, auto_course, auto_year)
       values ($1, $2, $3, 'private', 'course_year', $4, $5)
       on conflict (campus_id, lower(auto_course), auto_year) where auto_type = 'course_year' do nothing
       returning id`,
      [user.campus_id, classGroupName(course, year), `Class group for ${course}, year ${year}.`, course, year],
    );
    created = made.rows.length > 0;
    groupId = made.rows[0]?.id ?? (await db.query<{ id: string }>(
      `select id from groups
        where campus_id = $1 and auto_type = 'course_year' and lower(auto_course) = lower($2) and auto_year = $3`,
      [user.campus_id, course, year],
    )).rows[0]!.id;

    // A row may already exist (same group, or a stale 'pending'): make sure it is an active membership.
    await db.query(
      `insert into group_members (group_id, user_id, role, status) values ($1, $2, 'member', 'active')
       on conflict (group_id, user_id) do update set status = 'active'`,
      [groupId, userId],
    );
  }

  const removed = await db.query<{ group_id: string }>(
    `delete from group_members m using groups g
      where g.id = m.group_id and g.auto_type = 'course_year'
        and m.user_id = $1 and ($2::uuid is null or m.group_id <> $2)
      returning m.group_id`,
    [userId, groupId],
  );

  return { groupId, created, left: removed.rows.map((r) => r.group_id) };
}
