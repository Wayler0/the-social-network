import type { Queryable } from '../images/store.js';

/**
 * The member's own profile (docs/api-contract.md section 4, issue #20).
 * Email and member number are personal data: only GET/PATCH /api/me and admin endpoints return them.
 */

/** Role badges shown on profiles. Admin is a permission, not a badge. */
const BADGES: Record<string, string> = {
  staff: 'Staff', student_leader: 'Student Leader', club_leader: 'Club Leader', moderator: 'Moderator',
};

export type MeRow = {
  id: string; campus_slug: string; campus_name: string; email: string; member_type: string;
  name: string | null; photo_url: string | null; photo_image_id: string | null; course: string | null;
  year_of_study: number | null; graduation_year: number | null;
  member_number: string | null; member_number_status: string; is_under_18: boolean | null;
  interests: string[]; roles: string[]; is_admin: boolean;
  member_number_normalised?: string | null; reg_number_pattern?: string | null;
  ask_feedback?: boolean;
  personal_email?: string | null;
  year_check_from?: number | null;
};

const ME_SQL = `
  select u.id, c.slug as campus_slug, c.name as campus_name, u.email, u.member_type, u.name, u.photo_url, u.photo_image_id,
         u.course, u.year_of_study, u.graduation_year, u.member_number, u.member_number_status, u.is_under_18, u.interests,
         u.member_number_normalised, c.reg_number_pattern, u.year_check_from, u.personal_email,
         (u.feedback_given_at is null and u.active_days >= u.feedback_ask_at_day) as ask_feedback,
         coalesce(array(select distinct r.role from roles r
                         where r.user_id = u.id and r.starts_at <= clock_timestamp()
                           and (r.ends_at is null or r.ends_at > clock_timestamp())
                         order by r.role), '{}') as roles,
         exists (select 1 from roles r where r.user_id = u.id and r.role = 'admin'
                  and r.starts_at <= clock_timestamp() and (r.ends_at is null or r.ends_at > clock_timestamp())) as is_admin
    from users u join campuses c on c.id = u.campus_id
   where u.id = $1 and u.deleted_at is null`;

export async function loadMe(db: Queryable, userId: string): Promise<MeRow | null> {
  return (await db.query<MeRow>(ME_SQL, [userId])).rows[0] ?? null;
}

/** Display names of the badges for a member's current roles. */
export const badgesFor = (roles: string[]) => roles.map((r) => BADGES[r]).filter((b): b is string => Boolean(b));

export const isStudent = (memberType: string) => memberType === 'fresher' || memberType === 'continuing';

/**
 * Complete once name and member type are set, the under-18 question is answered, and students have
 * a year of study or alumni a graduation year. The registration number is OPTIONAL for students and
 * alumni (team decision 25 Nov 2026: the university email already proves membership); staff still
 * give a staff number. A reg number that is given must match the campus format. Until complete the
 * web app shows onboarding, and posting or joining groups answers 403 profile_incomplete.
 */
export function profileComplete(u: Pick<MeRow, 'name' | 'member_type' | 'member_number' | 'is_under_18' | 'year_of_study' | 'graduation_year'
  | 'member_number_normalised' | 'reg_number_pattern'>): boolean {
  if (!u.name || !u.member_type || u.is_under_18 === null) return false;
  if (u.member_type === 'staff' && !u.member_number) return false;
  // A reg number saved before the campus format existed (e.g. "EBT1") must be fixed or removed first.
  if (memberNumberNeedsFix(u)) return false;
  if (isStudent(u.member_type)) return u.year_of_study !== null;
  if (u.member_type === 'alumni') return u.graduation_year !== null;
  return true;
}

export function meBody(u: MeRow) {
  return {
    id: u.id,
    campus: { slug: u.campus_slug, name: u.campus_name },
    email: u.email,
    /** Linked for signing in after graduating (only ever shown to the member). */
    personalEmail: u.personal_email ?? null,
    memberType: u.member_type,
    name: u.name,
    photoUrl: u.photo_url,
    course: u.course,
    yearOfStudy: u.year_of_study,
    graduationYear: u.graduation_year,
    memberNumber: u.member_number,
    memberNumberStatus: u.member_number_status,
    isUnder18: u.is_under_18,
    interests: u.interests,
    badges: badgesFor(u.roles),
    isAdmin: u.is_admin,
    profileComplete: profileComplete(u),
    memberNumberNeedsFix: memberNumberNeedsFix(u),
    /** Third day in the app and no feedback yet: show the "Enjoying it?" prompt. */
    askFeedback: Boolean(u.ask_feedback) && profileComplete(u),
    /** Moved up a year automatically: the app asks them to confirm. Null when nothing to ask. */
    yearCheck: u.year_check_from != null && isStudent(u.member_type) && u.year_of_study != null
      ? { from: u.year_check_from, to: u.year_of_study } : null,
  };
}

/**
 * Interests as members type them: spaces tidied, empty ones dropped, duplicates removed ignoring
 * case (the first spelling wins). Null when one is longer than 40 characters or there are more than 10.
 */
export function normaliseInterests(input: string[]): string[] | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const interest = raw.trim().replace(/\s+/g, ' ');
    if (!interest) continue;
    if (interest.length > 40) return null;
    const key = interest.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(interest); }
  }
  return out.length <= 10 ? out : null;
}

/**
 * Reg and staff numbers: upper-case, spaces and dashes removed, slashes kept
 * ("abt5 / 09919-23" -> "ABT5/0991923"). Null when it cannot be a member number:
 * 3 to 40 characters of A-Z, 0-9 and /, with at least one digit.
 */
export function normaliseMemberNumber(input: string): string | null {
  const n = input.toUpperCase().replace(/[\s-]+/g, '');
  return /^[A-Z0-9/]{3,40}$/.test(n) && /\d/.test(n) ? n : null;
}

/**
 * Does a normalised registration number match its campus's format (campuses.reg_number_pattern)?
 * No pattern means no format check. A pattern that isn't a valid regular expression is ignored
 * rather than locking everyone out (an admin typo must not stop sign-ups).
 */
export function matchesRegFormat(normalised: string, pattern: string | null): boolean {
  if (!pattern) return true;
  let re: RegExp;
  try { re = new RegExp(pattern); } catch { return true; }
  return re.test(normalised);
}

/** A student's or alumnus's saved reg number doesn't match the campus format (staff are never checked). */
export function memberNumberNeedsFix(u: Pick<MeRow, 'member_type' | 'member_number_normalised' | 'reg_number_pattern'>): boolean {
  if (u.member_type === 'staff' || !u.member_number_normalised) return false;
  return !matchesRegFormat(u.member_number_normalised, u.reg_number_pattern ?? null);
}
