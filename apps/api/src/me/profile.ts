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
  roles: string[]; is_admin: boolean;
};

const ME_SQL = `
  select u.id, c.slug as campus_slug, c.name as campus_name, u.email, u.member_type, u.name, u.photo_url, u.photo_image_id,
         u.course, u.year_of_study, u.graduation_year, u.member_number, u.member_number_status, u.is_under_18,
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
 * Complete once name, member type and member number are set, the under-18 question is answered,
 * and students have a year of study or alumni a graduation year. Until then the web app shows
 * onboarding, and posting or joining groups answers 403 profile_incomplete.
 */
export function profileComplete(u: Pick<MeRow, 'name' | 'member_type' | 'member_number' | 'is_under_18' | 'year_of_study' | 'graduation_year'>): boolean {
  if (!u.name || !u.member_type || !u.member_number || u.is_under_18 === null) return false;
  if (isStudent(u.member_type)) return u.year_of_study !== null;
  if (u.member_type === 'alumni') return u.graduation_year !== null;
  return true;
}

export function meBody(u: MeRow) {
  return {
    id: u.id,
    campus: { slug: u.campus_slug, name: u.campus_name },
    email: u.email,
    memberType: u.member_type,
    name: u.name,
    photoUrl: u.photo_url,
    course: u.course,
    yearOfStudy: u.year_of_study,
    graduationYear: u.graduation_year,
    memberNumber: u.member_number,
    memberNumberStatus: u.member_number_status,
    isUnder18: u.is_under_18,
    badges: badgesFor(u.roles),
    isAdmin: u.is_admin,
    profileComplete: profileComplete(u),
  };
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
