import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, iso, parse, useContractErrors } from '../http.js';
import { attachImage, deleteImage, imageUrls, type Queryable } from '../images/store.js';
import { requireCompleteProfile } from '../me/routes.js';
import { notify } from '../notifications/notify.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { author, authorColumns, type AuthorRow } from '../posts/shape.js';
import { notBlocked, visibleEvent, visibleGroup, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };
const EVENTS_PER_DAY = 10;
const MAX_DAYS_AHEAD = 366;

const EVENT_SELECT = `
  select e.id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.cancelled_at, e.created_at,
         e.starts_at::text as cursor_at, ${authorColumns('au')},
         o.id as office_id, o.name as office_name, o.photo_url as office_photo, o.verified as office_verified,
         g.id as group_id, g.name as group_name, g.kind as group_kind,
         i.path as image_path, i.width as image_width, i.height as image_height,
         (select count(*) from event_rsvps r join users ru on ru.id = r.user_id
           where r.event_id = e.id and r.status = 'going' and ru.deleted_at is null)::int as going_count,
         (select count(*) from event_rsvps r join users ru on ru.id = r.user_id
           where r.event_id = e.id and r.status = 'interested' and ru.deleted_at is null)::int as interested_count,
         (select r.status from event_rsvps r where r.event_id = e.id and r.user_id = $1) as my_rsvp,
         (e.created_by = $1
          or (e.office_id is not null and exists (select 1 from office_members om where om.office_id = e.office_id and om.user_id = $1
               and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())))
          or (e.group_id is not null and exists (select 1 from group_members gm where gm.group_id = e.group_id and gm.user_id = $1
               and gm.status = 'active' and gm.role = 'admin'))) as can_manage
    from events e
    join users au on au.id = e.created_by
    left join office_accounts o on o.id = e.office_id
    left join groups g on g.id = e.group_id
    left join images i on i.id = e.image_id`;

type EventRow = AuthorRow & {
  id: string; title: string; description: string | null; location: string | null; starts_at: Date; ends_at: Date | null;
  cancelled_at: Date | null; created_at: Date; cursor_at: string;
  office_id: string | null; office_name: string | null; office_photo: string | null; office_verified: boolean | null;
  group_id: string | null; group_name: string | null; group_kind: string | null;
  image_path: string | null; image_width: number | null; image_height: number | null;
  going_count: number; interested_count: number; my_rsvp: 'going' | 'interested' | null; can_manage: boolean;
};

function eventBody(e: EventRow) {
  return {
    id: e.id, title: e.title, description: e.description, location: e.location,
    startsAt: iso(e.starts_at), endsAt: iso(e.ends_at), cancelled: e.cancelled_at !== null,
    createdBy: author(e),
    office: e.office_id ? { id: e.office_id, name: e.office_name, photoUrl: e.office_photo, verified: e.office_verified } : null,
    group: e.group_id ? { id: e.group_id, name: e.group_name, kind: e.group_kind } : null,
    image: e.image_path ? { url: imageUrls(e.image_path).url, width: e.image_width, height: e.image_height } : null,
    goingCount: e.going_count, interestedCount: e.interested_count, myRsvp: e.my_rsvp, canManage: e.can_manage,
    createdAt: iso(e.created_at),
  };
}

const text = (max: number) => z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, 'cannot be empty').max(max));
const longText = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().max(max));
const when = z.string().datetime({ offset: true });

/**
 * Events (v0.2; docs/api-contract.md section 14).
 *   GET    /api/events?when=upcoming|past&groupId&limit&cursor
 *   GET    /api/me/events                   upcoming events I am going to or interested in
 *   POST   /api/events                      { title, description?, location?, startsAt, endsAt?, imageId?, officeId? | groupId? }
 *   GET    /api/events/:id
 *   PATCH  /api/events/:id                  host: change details, or { cancelled: true|false }
 *   DELETE /api/events/:id                  host or admin
 *   PUT    /api/events/:id/rsvp             { status: "going" | "interested" };  DELETE removes it
 *   GET    /api/events/:id/attendees?status=going|interested&limit&cursor
 */
export async function eventRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);
  const notFound = (reply: FastifyReply) => fail(reply, 404, 'not_found', 'Event not found.');
  const badCursor = (reply: FastifyReply) => fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.');

  async function loadEvent(q: Queryable, viewer: { userId: string; campusId: string }, id: string): Promise<EventRow | null> {
    const { rows } = await q.query<EventRow>(`${EVENT_SELECT} where e.id = $3 and ${visibleEvent('e', V)}`, [viewer.userId, viewer.campusId, id]);
    return rows[0] ?? null;
  }

  // ---- GET /api/events   upcoming: soonest first (still running counts as upcoming); past: latest first
  app.get('/api/events', async (req, reply) => {
    const q = parse(z.object({ ...pageQuery, when: z.enum(['upcoming', 'past']).default('upcoming'), groupId: z.string().uuid().optional() }).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    const upcoming = q.when === 'upcoming';
    const { rows } = await db.query<EventRow>(
      `${EVENT_SELECT}
        where ${visibleEvent('e', V)}
          and ${upcoming ? 'coalesce(e.ends_at, e.starts_at) >= now()' : 'coalesce(e.ends_at, e.starts_at) < now()'}
          and ($3::uuid is null or e.group_id = $3)
          and ($4::timestamptz is null or (e.starts_at, e.id) ${upcoming ? '>' : '<'} ($4::timestamptz, $5::uuid))
        order by e.starts_at ${upcoming ? 'asc' : 'desc'}, e.id ${upcoming ? 'asc' : 'desc'}
        limit $6`,
      [req.auth!.userId, req.auth!.campusId, q.groupId ?? null, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1]);
    const p = page(rows, q.limit);
    return { items: p.rows.map(eventBody), nextCursor: p.nextCursor };
  });

  // ---- GET /api/me/events   upcoming events I answered, soonest first
  app.get('/api/me/events', async (req, reply) => {
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    const { rows } = await db.query<EventRow>(
      `${EVENT_SELECT}
        where ${visibleEvent('e', V)} and coalesce(e.ends_at, e.starts_at) >= now()
          and exists (select 1 from event_rsvps r where r.event_id = e.id and r.user_id = $1)
          and ($3::timestamptz is null or (e.starts_at, e.id) > ($3::timestamptz, $4::uuid))
        order by e.starts_at, e.id
        limit $5`,
      [req.auth!.userId, req.auth!.campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1]);
    const p = page(rows, q.limit);
    return { items: p.rows.map(eventBody), nextCursor: p.nextCursor };
  });

  // ---- POST /api/events
  app.post('/api/events', async (req, reply) => {
    const body = parse(z.object({
      title: text(140),
      description: longText(5000).optional(),
      location: text(200).optional(),
      startsAt: when,
      endsAt: when.optional(),
      imageId: z.string().uuid().optional(),
      officeId: z.string().uuid().optional(),
      groupId: z.string().uuid().optional(),
    }).strict()
      .refine((b) => !(b.officeId && b.groupId), { message: 'host as an office or in a group, not both' })
      .refine((b) => !b.endsAt || new Date(b.endsAt) > new Date(b.startsAt), { message: 'endsAt: must be after startsAt' }),
    req.body, reply);
    if (!body) return;
    const startsAt = new Date(body.startsAt);
    if (startsAt.getTime() < Date.now() - 3600_000) return fail(reply, 400, 'invalid_input', 'startsAt: must not be in the past.');
    if (startsAt.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) return fail(reply, 400, 'invalid_input', 'startsAt: at most a year ahead.');
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;

    type Outcome = { ok: true; id: string } | { ok: false; status: number; error: string; message: string } | { ok: false; wait: number };
    const outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
      if (body.officeId) {
        const { rows } = await tx.query(
          `select 1 from office_members om join office_accounts o on o.id = om.office_id
            where om.office_id = $3 and om.user_id = $1 and o.campus_id = $2
              and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())`,
          [viewer.userId, viewer.campusId, body.officeId]);
        if (rows.length === 0) return { ok: false, status: 403, error: 'forbidden', message: 'You can only host as an office you belong to.' };
      }
      if (body.groupId) {
        const { rows } = await tx.query<{ kind: string; posting: string; role: string | null; status: string | null }>(
          `select g.kind, g.posting, m.role, m.status from groups g left join group_members m on m.group_id = g.id and m.user_id = $1
            where g.id = $3 and ${visibleGroup('g', V)}`,
          [viewer.userId, viewer.campusId, body.groupId]);
        const g = rows[0];
        if (!g) return { ok: false, status: 404, error: 'not_found', message: 'Group not found.' };
        if (g.status !== 'active') return { ok: false, status: 403, error: 'forbidden', message: 'Join the group to create its events.' };
        if ((g.kind === 'club' || g.posting === 'admins_only') && g.role !== 'admin') {
          return { ok: false, status: 403, error: 'forbidden', message: 'Only the group’s admins create its events.' };
        }
      }
      const wait = await takeRateLimits(tx, [{ bucket: 'event_user', key: viewer.userId, max: EVENTS_PER_DAY, windowSeconds: 86_400 }]);
      if (wait) return { ok: false, wait };
      let imageId: string | null = null;
      if (body.imageId) {
        const image = await attachImage(tx, body.imageId, viewer.userId);
        if (!image) return { ok: false, status: 400, error: 'invalid_input', message: 'imageId: upload the image first, then use the imageId you got back.' };
        imageId = image.id;
      }
      const { rows } = await tx.query<{ id: string }>(
        `insert into events (campus_id, created_by, office_id, group_id, title, description, location, starts_at, ends_at, image_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [viewer.campusId, viewer.userId, body.officeId ?? null, body.groupId ?? null, body.title, body.description || null,
          body.location ?? null, body.startsAt, body.endsAt ?? null, imageId]);
      return { ok: true, id: rows[0]!.id };
    });
    if (!outcome.ok) {
      if ('wait' in outcome) {
        reply.header('Retry-After', String(outcome.wait));
        return fail(reply, 429, 'rate_limited', `You have created a lot of events today. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
      }
      return fail(reply, outcome.status, outcome.error, outcome.message);
    }
    return reply.code(201).send(eventBody((await loadEvent(db, viewer, outcome.id))!));
  });

  app.get('/api/events/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const e = params.success ? await loadEvent(db, req.auth!, params.data.id) : null;
    return e ? eventBody(e) : notFound(reply);
  });

  // ---- PATCH /api/events/:id   the host (creator, the office's members, the group's admins)
  app.patch('/api/events/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const body = parse(z.object({
      title: text(140), description: longText(5000).nullable(), location: text(200).nullable(),
      startsAt: when, endsAt: when.nullable(), cancelled: z.boolean(),
    }).partial().strict(), req.body, reply);
    if (!body) return;
    const e = params.success ? await loadEvent(db, req.auth!, params.data.id) : null;
    if (!e) return notFound(reply);
    if (!e.can_manage) return fail(reply, 403, 'forbidden', 'Only the event’s host can change it.');
    const startsAt = body.startsAt ?? e.starts_at.toISOString();
    const endsAt = body.endsAt !== undefined ? body.endsAt : e.ends_at?.toISOString() ?? null;
    if (endsAt && new Date(endsAt) <= new Date(startsAt)) return fail(reply, 400, 'invalid_input', 'endsAt: must be after startsAt.');

    const sets: string[] = [];
    const values: unknown[] = [e.id];
    const set = (column: string, value: unknown) => { values.push(value); sets.push(`${column} = $${values.length}`); };
    if (body.title !== undefined) set('title', body.title);
    if (body.description !== undefined) set('description', body.description || null);
    if (body.location !== undefined) set('location', body.location);
    if (body.startsAt !== undefined) set('starts_at', body.startsAt);
    if (body.endsAt !== undefined) set('ends_at', body.endsAt);
    if (body.cancelled !== undefined) sets.push(body.cancelled ? 'cancelled_at = coalesce(cancelled_at, clock_timestamp())' : 'cancelled_at = null');
    if (sets.length) await db.query(`update events set ${sets.join(', ')} where id = $1`, values);
    if (body.cancelled === true && !e.cancelled_at) {
      const people = await db.query<{ user_id: string }>('select user_id from event_rsvps where event_id = $1', [e.id]);
      await notify(db, config.APP_NAME, { type: 'event_cancelled', userIds: people.rows.map((p) => p.user_id), actorId: req.auth!.userId, targetId: e.id });
    }
    return eventBody((await loadEvent(db, req.auth!, e.id))!);
  });

  app.delete('/api/events/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const e = params.success ? await loadEvent(db, req.auth!, params.data.id) : null;
    if (!e) return notFound(reply);
    const admin = await db.query(
      `select 1 from roles where user_id = $1 and role = 'admin' and starts_at <= clock_timestamp() and (ends_at is null or ends_at > clock_timestamp())`,
      [req.auth!.userId]);
    if (!e.can_manage && admin.rows.length === 0) return fail(reply, 403, 'forbidden', 'Only the event’s host can delete it.');
    const { rows } = await db.query<{ image_id: string | null; reported: boolean }>(
      `update events ev set deleted_at = clock_timestamp() where ev.id = $1
       returning ev.image_id, exists (select 1 from reports r where r.target_type = 'event' and r.target_id = ev.id and r.status = 'open') as reported`,
      [e.id]);
    const gone = rows[0];
    // The picture goes too, unless moderators still need it for an open report.
    if (gone?.image_id && !gone.reported) {
      await db.query('update events set image_id = null where id = $1', [e.id]);
      await deleteImage(db, config.MEDIA_DIR, gone.image_id);
    }
    return reply.code(204).send();
  });

  // ---- PUT / DELETE /api/events/:id/rsvp
  for (const on of [true, false]) {
    app.route({
      method: on ? 'PUT' : 'DELETE',
      url: '/api/events/:id/rsvp',
      handler: async (req, reply) => {
        let status: 'going' | 'interested' = 'going';
        if (on) {
          const body = parse(z.object({ status: z.enum(['going', 'interested']) }).strict(), req.body, reply);
          if (!body) return;
          status = body.status;
        }
        const params = idParam.safeParse(req.params);
        const e = params.success ? await loadEvent(db, req.auth!, params.data.id) : null;
        if (!e) return notFound(reply);
        const userId = req.auth!.userId;
        if (on) {
          if (e.cancelled_at) return fail(reply, 409, 'event_cancelled', 'This event was cancelled.');
          if ((e.ends_at ?? e.starts_at).getTime() < Date.now()) return fail(reply, 409, 'event_over', 'This event is over.');
          await db.query(
            `insert into event_rsvps (event_id, user_id, status) values ($1, $2, $3)
             on conflict (event_id, user_id) do update set status = excluded.status, created_at = now()`,
            [e.id, userId, status]);
        } else {
          await db.query('delete from event_rsvps where event_id = $1 and user_id = $2', [e.id, userId]);
        }
        const after = (await loadEvent(db, req.auth!, e.id))!;
        return { myRsvp: after.my_rsvp, goingCount: after.going_count, interestedCount: after.interested_count };
      },
    });
  }

  // ---- GET /api/events/:id/attendees?status=going   members first to answer first
  app.get('/api/events/:id/attendees', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const q = parse(z.object({ ...pageQuery, status: z.enum(['going', 'interested']).default('going') }).strict(), req.query, reply);
    if (!q) return;
    const e = params.success ? await loadEvent(db, req.auth!, params.data.id) : null;
    if (!e) return notFound(reply);
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (err) { if (err instanceof CursorError) return badCursor(reply); throw err; }
    const { rows } = await db.query<{ id: string; name: string | null; photo_url: string | null; created_at: Date; cursor_at: string }>(
      `select u.id, u.name, u.photo_url, r.created_at, r.created_at::text as cursor_at
         from event_rsvps r join users u on u.id = r.user_id
        where r.event_id = $3 and r.status = $4 and u.campus_id = $2 and u.deleted_at is null and ${notBlocked('u.id', V)}
          and ($5::timestamptz is null or (r.created_at, u.id) > ($5::timestamptz, $6::uuid))
        order by r.created_at, u.id
        limit $7`,
      [req.auth!.userId, req.auth!.campusId, e.id, q.status, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1]);
    const p = page(rows, q.limit);
    return { items: p.rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, since: iso(r.created_at) })), nextCursor: p.nextCursor };
  });
}

/** Housekeeping: event rate-limit counts after a day. */
export async function cleanupEvents(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket = 'event_user' and created_at < now() - interval '1 day'`);
}
