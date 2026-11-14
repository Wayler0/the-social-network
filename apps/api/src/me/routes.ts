import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { normaliseCourse, syncClassGroup } from '../groups/class-groups.js';
import { fail, parse, useContractErrors } from '../http.js';
import { attachImage, deleteImage, type Queryable } from '../images/store.js';
import { isStudent, loadMe, meBody, normaliseMemberNumber, profileComplete } from './profile.js';

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
 * Me and profile (docs/api-contract.md section 4, issue #20):
 *   GET   /api/me   the member's own profile, including private fields
 *   PATCH /api/me   onboarding and edit profile; send only what changes
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
