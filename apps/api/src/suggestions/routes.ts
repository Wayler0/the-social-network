import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { useContractErrors } from '../http.js';
import { badgesFor } from '../me/profile.js';
import { activeRoles } from '../posts/shape.js';
import { isActiveMember, notBlocked, visibleGroup, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };
const PEOPLE = 20;
const CLUBS = 6;

/** Course names compare ignoring case and extra spaces (as class groups do). */
const courseKey = (col: string) => `lower(regexp_replace(btrim(coalesce(${col}, '')), '\\s+', ' ', 'g'))`;
const isStudentSql = (col: string) => `${col} in ('fresher', 'continuing')`;

/**
 * People to follow, best first (docs/api-contract.md section 12a). Candidates are live, verified,
 * finished profiles on your campus that you don't follow yet, with no block either way and not
 * suspended. Privacy rules:
 *   - staff are never shown students (student-first rule, CLAUDE.md section 6);
 *   - an under-18 member is suggested only to their own classmates (students, same course and year);
 *   - the reason shown is only "Same class", "Same course", "Staff" or a mutual count: nothing
 *     about where anyone lives or what they do.
 * Ranked: same class, then same course, then mutual follows, then followers.
 */
const PEOPLE_SQL = `
  with me as (
    select u.id, u.member_type, ${courseKey('u.course')} as course_key, u.year_of_study from users u where u.id = $1
  ), c as (
    select u.id, u.name, u.photo_url, u.member_type, u.course, u.year_of_study, u.is_under_18, ${activeRoles('u.id')} as roles,
           (${courseKey('u.course')} <> '' and ${courseKey('u.course')} = me.course_key) as same_course,
           (${courseKey('u.course')} <> '' and ${courseKey('u.course')} = me.course_key
             and ${isStudentSql('u.member_type')} and ${isStudentSql('me.member_type')}
             and u.year_of_study is not null and u.year_of_study = me.year_of_study) as same_class,
           (select count(*) from follows f1
              join follows f2 on f2.follower_id = f1.target_id and f2.target_type = 'user' and f2.target_id = u.id
             where f1.follower_id = $1 and f1.target_type = 'user')::int as mutual,
           (select count(*) from follows f where f.target_type = 'user' and f.target_id = u.id)::int as followers,
           me.member_type as my_type
      from users u, me
     where u.campus_id = $2 and u.id <> $1 and u.deleted_at is null and u.verified and u.name is not null and u.member_type is not null
       and not (u.suspended_at is not null and (u.suspended_until is null or u.suspended_until > clock_timestamp()))
       and ${notBlocked('u.id', V)}
       and not exists (select 1 from follows f where f.follower_id = $1 and f.target_type = 'user' and f.target_id = u.id)
  )
  select * from c
   where not (my_type = 'staff' and ${isStudentSql('member_type')})
     and (is_under_18 is not true or same_class)
     and (same_course or mutual > 0 or member_type = 'staff')
   order by same_class desc, same_course desc, mutual desc, followers desc, name
   limit ${PEOPLE}`;

/** Public clubs you may see and are neither in nor following: verified (CLUB badge) first, then most followed. */
const CLUBS_SQL = `
  select g.id, g.name, g.description, g.club_verified_at is not null as verified,
         (select count(*) from follows f where f.target_type = 'group' and f.target_id = g.id)::int as followers
    from groups g
   where g.kind = 'club' and g.visibility = 'public' and ${visibleGroup('g', V)}
     and not ${isActiveMember('g.id', V)}
     and not exists (select 1 from follows f where f.follower_id = $1 and f.target_type = 'group' and f.target_id = g.id)
   order by verified desc, followers desc, g.name
   limit ${CLUBS}`;

type PersonRow = {
  id: string; name: string; photo_url: string | null; member_type: string; course: string | null; year_of_study: number | null;
  roles: string[]; same_course: boolean; same_class: boolean; mutual: number; followers: number;
};

function reason(r: PersonRow): string {
  const parts = [r.same_class ? 'Same class' : r.same_course ? 'Same course' : r.member_type === 'staff' ? 'Staff' : null,
    r.mutual > 0 ? `${r.mutual} mutual` : null].filter(Boolean);
  return parts.join(' · ');
}

/**
 * GET /api/suggestions → { people: [...], clubs: [...] }: who to follow, for the onboarding
 * "follow classmates" step and "People in your course" on Discover. Never email or reg numbers.
 */
export async function suggestionRoutes(app: FastifyInstance, { db }: { db: Db }) {
  useContractErrors(app);

  app.get('/api/suggestions', async (req) => {
    const args = [req.auth!.userId, req.auth!.campusId];
    const [people, clubs] = await Promise.all([
      db.query<PersonRow>(PEOPLE_SQL, args),
      db.query<{ id: string; name: string; description: string | null; verified: boolean; followers: number }>(CLUBS_SQL, args),
    ]);
    return {
      people: people.rows.map((r) => ({
        id: r.id, name: r.name, photoUrl: r.photo_url, memberType: r.member_type, course: r.course,
        yearOfStudy: r.year_of_study, badges: badgesFor(r.roles), reason: reason(r), mutualCount: r.mutual,
      })),
      clubs: clubs.rows.map((g) => ({ id: g.id, name: g.name, description: g.description, clubVerified: g.verified, followerCount: g.followers })),
    };
  });
}
