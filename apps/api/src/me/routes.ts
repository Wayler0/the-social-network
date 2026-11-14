import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { ensureGroupHasAdmin } from '../groups/admins.js';
import { normaliseCourse, syncClassGroup } from '../groups/class-groups.js';
import { clearSessionCookie } from '../auth/sessions.js';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import { fail, idParam, parse, useContractErrors } from '../http.js';
import { notBlocked, type ViewerSql } from '../visibility.js';
import { attachImage, deleteImage, type Queryable } from '../images/store.js';
import { badgesFor, isStudent, loadMe, meBody, normaliseMemberNumber, profileComplete } from './profile.js';

const year = (min: number, max: number) => z.number().int().min(min).max(max);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberType: z.enum(['fresher', 'continuing', 'alumni', 'staff']),
  course: z.string().max(200).nullable(),
  yearOfStudy: year(1, 8).nullable(),
  graduationYear: year(1990, 2100).nullable(),
  memberNumber: z.string().max(60),
  isUnder18: z.boolean(),
  /** From POST /api/images; null removes the photo. */
  photoImageId: z.string().uuid().nullable(),
}).partial().strict();

/**
 * Me and profiles (docs/api-contract.md section 4, issues #20, #21):
 *   GET    /api/me                          the member's own profile, including private fields
 *   PATCH  /api/me                          onboarding and edit profile; send only what changes
 *   POST   /api/me/member-number-dispute    "someone has claimed my number"
 *   GET    /api/users/:id                   someone's public profile
 *   DELETE /api/me                          delete the account
 */
export async function meRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);

  app.get('/api/me', async (req, reply) => {
    const me = await loadMe(db, req.auth!.userId);
    if (!me) return fail(reply, 401, 'not_signed_in', 'Please sign in.');
    return meBody(me);
  });

  app.patch('/api/me', async (req, reply) => {
    const body = parse(patchSchema, req.body, reply);
    if (!body) return;
    const userId = req.auth!.userId;

    type Outcome = { ok: true; oldPhoto: string | null } | { ok: false; status: number; error: string; message: string };
    let outcome: Outcome;
    try {
      outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
        const cur = (await tx.query<{
          member_type: string; course: string | null; year_of_study: number | null; graduation_year: number | null;
          member_number_normalised: string | null; photo_image_id: string | null;
        }>('select member_type, course, year_of_study, graduation_year, member_number_normalised, photo_image_id from users where id = $1 for update', [userId])).rows[0]!;
        const bad = (message: string): Outcome => ({ ok: false, status: 400, error: 'invalid_input', message });

        // Staff accounts come from staff emails and stay staff; students choose fresher, continuing or alumni.
        let memberType = cur.member_type;
        if (body.memberType !== undefined) {
          if ((cur.member_type === 'staff') !== (body.memberType === 'staff')) {
            return bad(cur.member_type === 'staff'
              ? 'memberType: staff accounts stay staff.'
              : 'memberType: choose fresher, continuing or alumni. Staff accounts need a staff email.');
          }
          memberType = body.memberType;
        }

        const sets: string[] = [];
        const params: unknown[] = [userId];
        const set = (column: string, value: unknown) => { params.push(value); sets.push(`${column} = $${params.length}`); };

        if (body.name !== undefined) set('name', body.name.replace(/\s+/g, ' '));
        if (body.memberType !== undefined) set('member_type', memberType);
        if (body.course !== undefined) {
          const course = body.course === null ? '' : normaliseCourse(body.course);
          if (course.length > 120) return bad('course: at most 120 characters.');
          set('course', course || null);
        }
        if (body.isUnder18 !== undefined) set('is_under_18', body.isUnder18);

        // Year of study is for current students, graduation year for alumni; the other is cleared.
        let yearOfStudy = body.yearOfStudy !== undefined ? body.yearOfStudy : cur.year_of_study;
        let graduationYear = body.graduationYear !== undefined ? body.graduationYear : cur.graduation_year;
        if (!isStudent(memberType)) yearOfStudy = null;
        if (memberType !== 'alumni') graduationYear = null;
        if (yearOfStudy !== cur.year_of_study) set('year_of_study', yearOfStudy);
        if (graduationYear !== cur.graduation_year) set('graduation_year', graduationYear);

        if (body.memberNumber !== undefined) {
          const normalised = normaliseMemberNumber(body.memberNumber);
          if (!normalised) {
            return bad(memberType === 'staff'
              ? 'memberNumber: that doesn’t look like a staff number.'
              : 'memberNumber: that doesn’t look like a registration number, e.g. ABT5/09919/23.');
          }
          if (normalised !== cur.member_number_normalised) {
            set('member_number', body.memberNumber.trim().replace(/\s+/g, ' ').slice(0, 40));
            set('member_number_normalised', normalised);
            set('member_number_status', 'unverified');
          }
        }

        let oldPhoto: string | null = null;
        if (body.photoImageId !== undefined && body.photoImageId !== cur.photo_image_id) {
          if (body.photoImageId === null) {
            set('photo_image_id', null);
            set('photo_url', null);
          } else {
            const image = await attachImage(tx, body.photoImageId, userId);
            if (!image) return bad('photoImageId: upload the photo first, then use the imageId you got back.');
            set('photo_image_id', image.id);
            set('photo_url', image.thumbUrl);
          }
          oldPhoto = cur.photo_image_id;
        }

        if (sets.length > 0) await tx.query(`update users set ${sets.join(', ')} where id = $1`, params);
        // Same transaction: the member moves to the class group of their new course and year.
        await syncClassGroup(tx, userId);
        return { ok: true, oldPhoto };
      });
    } catch (err) {
      if ((err as { code?: string; constraint?: string }).constraint === 'users_member_number_key') {
        return fail(reply, 409, 'member_number_taken',
          'Another account already uses this number. If it is yours, tell us with “Someone has my number”.');
      }
      throw err;
    }
    if (!outcome.ok) return fail(reply, outcome.status, outcome.error, outcome.message);

    if (outcome.oldPhoto) await deleteImage(db, config.MEDIA_DIR, outcome.oldPhoto);   // the files of a replaced photo
    return meBody((await loadMe(db, userId))!);
  });

  // ---- POST /api/me/member-number-dispute   "someone has claimed my reg number" -> admin queue
  app.post('/api/me/member-number-dispute', async (req, reply) => {
    const body = parse(z.object({ memberNumber: z.string().max(60), details: z.string().trim().max(2000).optional() }).strict(), req.body, reply);
    if (!body) return;
    const normalised = normaliseMemberNumber(body.memberNumber);
    if (!normalised) return fail(reply, 400, 'invalid_input', 'memberNumber: that doesn’t look like a registration or staff number.');
    const { userId, campusId } = req.auth!;

    const outcome = await inTransaction(db, async (tx) => {
      const mine = await tx.query('select 1 from users where id = $1 and member_number_normalised = $2', [userId, normalised]);
      if (mine.rows.length > 0) return 'own' as const;
      const wait = await takeRateLimits(tx, [{ bucket: 'dispute_user', key: userId, max: 3, windowSeconds: 86_400 }]);
      if (wait) return wait;
      await tx.query(
        `insert into member_number_disputes (campus_id, member_number_normalised, reporter_user_id, details) values ($1, $2, $3, $4)`,
        [campusId, normalised, userId, body.details || null],
      );
      // Flag the account holding it, unless an admin already confirmed it is theirs. Admins decide (admin API).
      await tx.query(
        `update users set member_number_status = 'disputed'
          where campus_id = $1 and member_number_normalised = $2 and deleted_at is null and member_number_status = 'unverified'`,
        [campusId, normalised],
      );
      return 'ok' as const;
    });
    if (outcome === 'own') return fail(reply, 400, 'invalid_input', 'memberNumber: that number is already on your account.');
    if (typeof outcome === 'number') {
      reply.header('Retry-After', String(outcome));
      return fail(reply, 429, 'rate_limited', `You have reported enough numbers for today. Try again in ${waitText(outcome)}.`, { retryAfterSeconds: outcome });
    }
    // The same answer whether or not anyone holds the number.
    return reply.code(202).send({ received: true });
  });

  // ---- GET /api/users/:id   someone's public profile: never email or member number
  app.get('/api/users/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const notFound = () => fail(reply, 404, 'not_found', 'Member not found.');
    if (!params.success) return notFound();
    const viewer: ViewerSql = { id: '$1', campusId: '$2' };
    const { rows } = await db.query<{
      id: string; name: string | null; photo_url: string | null; member_type: string; course: string | null;
      year_of_study: number | null; graduation_year: number | null; roles: string[];
    }>(
      `select u.id, u.name, u.photo_url, u.member_type, u.course, u.year_of_study, u.graduation_year,
              coalesce(array(select distinct r.role from roles r
                              where r.user_id = u.id and r.starts_at <= clock_timestamp()
                                and (r.ends_at is null or r.ends_at > clock_timestamp())
                              order by r.role), '{}') as roles
         from users u
        where u.id = $3 and u.campus_id = ${viewer.campusId} and u.deleted_at is null
          and ${notBlocked('u.id', viewer)}`,
      [req.auth!.userId, req.auth!.campusId, params.data.id],
    );
    const u = rows[0];
    if (!u) return notFound();
    return {
      id: u.id, name: u.name, photoUrl: u.photo_url, memberType: u.member_type, course: u.course,
      yearOfStudy: u.year_of_study, graduationYear: u.graduation_year, badges: badgesFor(u.roles),
      isFollowing: false,   // follows arrive in v0.2
    };
  });

  /**
   * DELETE /api/me   { confirm: "DELETE" }  (Data Protection Act: erasure)
   * Removed: email, name, photo, course, years, member number, under-18 answer, every uploaded
   *   image (profile and post photos, files included), sessions, sign-in codes, likes, helpful
   *   votes, blocks, group memberships (a group they ran alone gets a new admin). Roles and office
 *   memberships are ended (kept as history).
   * Kept, shown as "Deleted member": posts, comments, questions and answers; reports and the
   *   admin log, which moderation needs. The email is free to sign up again as a new member.
   */
  app.delete('/api/me', { config: { allowSuspended: true } }, async (req, reply) => {
    const body = parse(z.object({ confirm: z.literal('DELETE') }).strict(), req.body, reply);
    if (!body) return;
    const userId = req.auth!.userId;

    const imageIds = await inTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ email: string | null }>('select email from users where id = $1 and deleted_at is null for update', [userId]);
      const email = rows[0]?.email ?? null;
      const images = (await tx.query<{ id: string }>('select id from images where user_id = $1', [userId])).rows.map((r) => r.id);
      await tx.query('update posts set image_id = null where author_user_id = $1 and image_id is not null', [userId]);
      await tx.query(
        `update users set email = null, name = null, photo_url = null, photo_image_id = null, course = null,
                year_of_study = null, graduation_year = null, member_number = null, member_number_normalised = null,
                member_number_status = 'unverified', is_under_18 = null, deleted_at = clock_timestamp()
          where id = $1`,
        [userId],
      );
      await tx.query('update sessions set revoked_at = clock_timestamp() where user_id = $1 and revoked_at is null', [userId]);
      if (email) {
        await tx.query('delete from auth_codes where email = $1', [email]);
        await tx.query(`delete from rate_limit_events where bucket = 'code_email' and key = $1`, [email]);
      }
      await tx.query('delete from likes where user_id = $1', [userId]);
      await tx.query('delete from answer_helpful where user_id = $1', [userId]);
      await tx.query('delete from blocks where blocker_id = $1 or blocked_id = $1', [userId]);
      const adminOf = (await tx.query<{ group_id: string; role: string }>(
        `delete from group_members where user_id = $1 returning group_id, role`, [userId])).rows
        .filter((r) => r.role === 'admin').map((r) => r.group_id);
      // A group this member ran alone gets its longest-standing member as admin.
      for (const groupId of adminOf) await ensureGroupHasAdmin(tx, groupId);
      for (const table of ['roles', 'office_members']) {
        await tx.query(
          `update ${table} set ends_at = greatest(clock_timestamp(), starts_at + interval '1 millisecond')
            where user_id = $1 and (ends_at is null or ends_at > clock_timestamp())`,
          [userId],
        );
      }
      await syncClassGroup(tx, userId);
      return images;
    });

    // Files last, once the database no longer points at them.
    for (const id of imageIds) await deleteImage(db, config.MEDIA_DIR, id);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });
}

/**
 * For routes that need a finished profile (posting, joining groups): sends 403 profile_incomplete
 * and returns false when onboarding is not done.
 */
export async function requireCompleteProfile(db: Queryable, req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const me = await loadMe(db, req.auth!.userId);
  if (me && profileComplete(me)) return true;
  fail(reply, 403, 'profile_incomplete', 'Finish your profile first.');
  return false;
}
