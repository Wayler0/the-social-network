import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { parse, useContractErrors } from '../http.js';
import { badgesFor } from '../me/profile.js';
import { activeRoles, POST_SELECT, postBody, type PostRow } from '../posts/shape.js';
import { isActiveMember, notBlocked, visibleGroup, visiblePost, visibleQuestion, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id, $2 their campus and $3 the LIKE pattern. */
const V: ViewerSql = { id: '$1', campusId: '$2' };

/** "50%_off" must match literally: escape LIKE's wildcards. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const query = z.object({
  q: z.string().transform((s) => s.trim().replace(/\s+/g, ' ')).pipe(z.string().min(2, 'type at least 2 characters').max(80)),
  /** One kind only (a "See all" tab), or all four (the first look). */
  type: z.enum(['all', 'people', 'groups', 'posts', 'questions']).default('all'),
}).strict();

/**
 * GET /api/search?q=&type=   people, groups and clubs, posts, Ask a Senior questions (MVP item 10).
 * The same privacy rules as everywhere else (src/visibility.ts):
 *   - never by email or registration number; only names, group names, post and question text;
 *   - own campus only; nothing blocked, hidden, deleted or suspended;
 *   - groups the viewer may see (staff never see student-only ones; others' class groups are left out);
 *   - an under-18 member appears only to their classmates (students, same course and year) or to
 *     people they follow back, like suggestions;
 *   - questions come without who asked (hidden names stay hidden).
 * Up to 8 of each kind for "all", 30 for one kind. Plain ILIKE: fine at campus size; switch to
 * full-text search or Meilisearch if it gets slow (CLAUDE.md section 12).
 */
export async function searchRoutes(app: FastifyInstance, { db }: { db: Db }) {
  useContractErrors(app);

  app.get('/api/search', async (req, reply) => {
    const q = parse(query, req.query, reply);
    if (!q) return;
    const { userId, campusId } = req.auth!;
    const limit = q.type === 'all' ? 8 : 30;
    const args = [userId, campusId, likePattern(q.q)];
    const want = (k: string) => q.type === 'all' || q.type === k;
    const course = (col: string) => `lower(regexp_replace(btrim(coalesce(${col}, '')), '\\s+', ' ', 'g'))`;

    const [people, groups, posts, questions] = await Promise.all([
      want('people') ? db.query<{ id: string; name: string; photo_url: string | null; member_type: string; course: string | null; year_of_study: number | null; roles: string[] }>(
        `with me as (select member_type, ${course('course')} as course_key, year_of_study from users where id = $1)
         select u.id, u.name, u.photo_url, u.member_type, u.course, u.year_of_study, ${activeRoles('u.id')} as roles
           from users u, me
          where u.campus_id = $2 and u.deleted_at is null and u.verified and u.name is not null
            and u.name ilike $3 escape '\\'
            and not (u.suspended_at is not null and (u.suspended_until is null or u.suspended_until > clock_timestamp()))
            and ${notBlocked('u.id', V)}
            and (u.is_under_18 is not true or u.id = $1
                 or (me.member_type in ('fresher', 'continuing') and u.member_type in ('fresher', 'continuing')
                     and ${course('u.course')} <> '' and ${course('u.course')} = me.course_key and u.year_of_study = me.year_of_study)
                 or exists (select 1 from follows f where f.follower_id = u.id and f.target_type = 'user' and f.target_id = $1))
          order by (u.name ilike substr($3, 2)) desc, u.name
          limit ${limit}`, args) : null,
      want('groups') ? db.query<{ id: string; name: string; description: string | null; kind: string; visibility: string; club_verified: boolean; member_count: number }>(
        `select g.id, g.name, g.description, g.kind, g.visibility, g.club_verified_at is not null as club_verified,
                (select count(*) from group_members m where m.group_id = g.id and m.status = 'active')::int as member_count
           from groups g
          where ${visibleGroup('g', V)} and (g.name ilike $3 escape '\\' or g.description ilike $3 escape '\\')
            and (g.auto_type <> 'course_year' or ${isActiveMember('g.id', V)})
          order by (g.name ilike $3 escape '\\') desc, member_count desc, g.name
          limit ${limit}`, args) : null,
      want('posts') ? db.query<PostRow>(
        `${POST_SELECT}
          where ${visiblePost('p', V)} and p.body ilike $3 escape '\\'
          order by p.created_at desc, p.id desc
          limit ${limit}`, args) : null,
      want('questions') ? db.query<{ id: string; body: string; answer_count: number; created_at: Date }>(
        `select q.id, q.body, q.created_at,
                (select count(*) from answers a where a.question_id = q.id and a.hidden_at is null and a.deleted_at is null)::int as answer_count
           from questions q
          where ${visibleQuestion('q', V)}
            and (q.body ilike $3 escape '\\' or exists (select 1 from answers a where a.question_id = q.id
                   and a.hidden_at is null and a.deleted_at is null and a.body ilike $3 escape '\\'))
          order by q.created_at desc
          limit ${limit}`, args) : null,
    ]);

    return {
      q: q.q,
      people: people?.rows.map((u) => ({ id: u.id, name: u.name, photoUrl: u.photo_url, memberType: u.member_type, course: u.course, yearOfStudy: u.year_of_study, badges: badgesFor(u.roles) })) ?? [],
      groups: groups?.rows.map((g) => ({ id: g.id, name: g.name, description: g.description, kind: g.kind, visibility: g.visibility, clubVerified: g.club_verified, memberCount: g.member_count })) ?? [],
      posts: posts?.rows.map(postBody) ?? [],
      questions: questions?.rows.map((x) => ({ id: x.id, body: x.body, answerCount: x.answer_count, createdAt: x.created_at.toISOString() })) ?? [],
    };
  });
}
