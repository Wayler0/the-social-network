import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, parse, useContractErrors } from '../http.js';
import type { Queryable } from '../images/store.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';

/** Normal announcements pinned at once per campus. Urgent ones are never blocked by this. */
export const MAX_PINNED = 5;
/** How far ahead a pin may last. */
export const MAX_PIN_DAYS = 14;
const PER_OFFICE_PER_DAY = 10;

const SELECT = `
  select a.id, a.title, a.body, a.urgency, a.pinned_until, a.created_at, a.created_at::text as cursor_at,
         (a.pinned_until is not null and a.pinned_until > clock_timestamp()) as pinned,
         o.id as office_id, o.name as office_name, o.photo_url as office_photo, o.verified as office_verified
    from announcements a join office_accounts o on o.id = a.office_id`;

type Row = {
  id: string; title: string; body: string; urgency: 'normal' | 'urgent'; pinned_until: Date | null; created_at: Date; cursor_at: string;
  pinned: boolean; office_id: string; office_name: string; office_photo: string | null; office_verified: boolean;
};

const body = (r: Row) => ({
  id: r.id,
  office: { id: r.office_id, name: r.office_name, photoUrl: r.office_photo, verified: r.office_verified },
  title: r.title, body: r.body, urgency: r.urgency,
  pinned: r.pinned, pinnedUntil: r.pinned_until?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

/** Is this member a current owner/editor of the office (on their campus)? Returns their role. */
async function officeRole(q: Queryable, userId: string, campusId: string, officeId: string) {
  const { rows } = await q.query<{ role: 'owner' | 'editor'; verified: boolean }>(
    `select om.role, o.verified from office_members om join office_accounts o on o.id = om.office_id
      where om.office_id = $1 and om.user_id = $2 and o.campus_id = $3
        and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())`,
    [officeId, userId, campusId],
  );
  return rows[0] ?? null;
}

/**
 * Today board (docs/api-contract.md section 9, issue #26): official announcements from verified
 * office accounts. Everyone on the campus sees them; there is no blocking an office.
 */
export async function announcementRoutes(app: FastifyInstance, { db }: { db: Db }) {
  useContractErrors(app);

  // ---- GET /api/announcements   first page: every current pin (urgent first, newest first), then the rest newest first
  app.get('/api/announcements', async (req, reply) => {
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const campusId = req.auth!.campusId;
    const pinned = cursor ? [] : (await db.query<Row>(
      `${SELECT} where a.campus_id = $1 and a.pinned_until > clock_timestamp()
        order by (a.urgency = 'urgent') desc, a.created_at desc, a.id desc`,
      [campusId],
    )).rows;
    const { rows } = await db.query<Row>(
      `${SELECT}
        where a.campus_id = $1 and (a.pinned_until is null or a.pinned_until <= clock_timestamp())
          and ($2::timestamptz is null or (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
        order by a.created_at desc, a.id desc
        limit $4`,
      [campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: [...pinned, ...p.rows].map(body), nextCursor: p.nextCursor };
  });

  // ---- POST /api/announcements   { officeId, title, body, urgency, pinnedUntil? }
  app.post('/api/announcements', async (req, reply) => {
    const input = parse(z.object({
      officeId: z.string().uuid(),
      title: z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, 'cannot be empty').max(140)),
      body: z.string().transform((s) => s.trim()).pipe(z.string().min(1, 'cannot be empty').max(5000)),
      urgency: z.enum(['normal', 'urgent']),
      pinnedUntil: z.string().datetime({ offset: true }).optional(),
    }).strict(), req.body, reply);
    if (!input) return;
    const { userId, campusId } = req.auth!;
    const pinnedUntil = input.pinnedUntil ? new Date(input.pinnedUntil) : null;
    if (pinnedUntil && (pinnedUntil.getTime() <= Date.now() || pinnedUntil.getTime() > Date.now() + MAX_PIN_DAYS * 86_400_000)) {
      return fail(reply, 400, 'invalid_input', `pinnedUntil: must be in the future and at most ${MAX_PIN_DAYS} days ahead.`);
    }

    type Outcome = { ok: true; id: string } | { ok: false; status: number; error: string; message: string; wait?: number };
    const outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
      const role = await officeRole(tx, userId, campusId, input.officeId);
      if (!role) return { ok: false, status: 403, error: 'forbidden', message: 'You can only post for an office you belong to.' };
      if (!role.verified) return { ok: false, status: 403, error: 'forbidden', message: 'Only verified office accounts can post to the Today board.' };
      const wait = await takeRateLimits(tx, [{ bucket: 'announce_office', key: input.officeId, max: PER_OFFICE_PER_DAY, windowSeconds: 86_400 }]);
      if (wait) return { ok: false, status: 429, error: 'rate_limited', message: `This office has posted a lot today. Try again in ${waitText(wait)}.`, wait };
      if (pinnedUntil && input.urgency === 'normal') {
        // One pin decision at a time per campus, so two offices cannot both take the last place.
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`pins:${campusId}`]);
        const { rows } = await tx.query<{ n: number }>(
          `select count(*)::int as n from announcements
            where campus_id = $1 and urgency = 'normal' and pinned_until > clock_timestamp()`,
          [campusId],
        );
        if (rows[0]!.n >= MAX_PINNED) {
          return { ok: false, status: 409, error: 'pin_limit', message: `The Today board already has ${MAX_PINNED} pinned announcements. Post without pinning, or wait for a pin to end.` };
        }
      }
      const { rows } = await tx.query<{ id: string }>(
        `insert into announcements (campus_id, office_id, created_by, title, body, urgency, pinned_until)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [campusId, input.officeId, userId, input.title, input.body, input.urgency, pinnedUntil],
      );
      return { ok: true, id: rows[0]!.id };
    });

    if (!outcome.ok) {
      if (outcome.wait) reply.header('Retry-After', String(outcome.wait));
      return fail(reply, outcome.status, outcome.error, outcome.message, outcome.wait ? { retryAfterSeconds: outcome.wait } : {});
    }
    const { rows } = await db.query<Row>(`${SELECT} where a.id = $1`, [outcome.id]);
    return reply.code(201).send(body(rows[0]!));
  });

  // ---- DELETE /api/announcements/:id   the office's owner, or an admin
  app.delete('/api/announcements/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const notFound = () => fail(reply, 404, 'not_found', 'Announcement not found.');
    if (!params.success) return notFound();
    const { userId, campusId } = req.auth!;
    const { rows } = await db.query<{ office_id: string }>('select office_id from announcements where id = $1 and campus_id = $2', [params.data.id, campusId]);
    const a = rows[0];
    if (!a) return notFound();
    const role = await officeRole(db, userId, campusId, a.office_id);
    if (role?.role !== 'owner') {
      const admin = await db.query(
        `select 1 from roles where user_id = $1 and role = 'admin'
            and starts_at <= clock_timestamp() and (ends_at is null or ends_at > clock_timestamp())`, [userId]);
      if (admin.rows.length === 0) return fail(reply, 403, 'forbidden', 'Only the office’s owner or an admin can remove this.');
    }
    await db.query('delete from announcements where id = $1', [params.data.id]);
    return reply.code(204).send();
  });

  // ---- GET /api/me/offices   offices the member can post for (for the composer's "post as" choice)
  app.get('/api/me/offices', async (req) => {
    const { rows } = await db.query<{ id: string; name: string; photo_url: string | null; verified: boolean; role: string }>(
      `select o.id, o.name, o.photo_url, o.verified, om.role
         from office_members om join office_accounts o on o.id = om.office_id
        where om.user_id = $1 and o.campus_id = $2
          and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())
        order by o.name`,
      [req.auth!.userId, req.auth!.campusId],
    );
    return { items: rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, verified: r.verified, role: r.role })) };
  });
}

/** Housekeeping: announcement rate-limit counts after two days. */
export async function cleanupAnnouncements(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket = 'announce_office' and created_at < now() - interval '2 days'`);
}
