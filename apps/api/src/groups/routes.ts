import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, parse, useContractErrors, uuid } from '../http.js';
import type { Queryable } from '../images/store.js';
import { isStudent, loadMe } from '../me/profile.js';
import { requireCompleteProfile } from '../me/routes.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { POST_SELECT, postBody, type PostRow } from '../posts/shape.js';
import { notBlocked, visibleGroup, visiblePost, type ViewerSql } from '../visibility.js';
import { ensureGroupHasAdmin } from './admins.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };
const GROUPS_PER_DAY = 5;

const GROUP_SELECT = `
  select g.id, g.name, g.description, g.visibility, g.student_only, g.kind, g.posting, g.auto_type,
         g.club_verified_at is not null as club_verified, g.created_at, g.created_at::text as cursor_at,
         (select count(*) from group_members c where c.group_id = g.id and c.status = 'active')::int as member_count,
         m.status as my_status, m.role as my_role
    from groups g
    left join group_members m on m.group_id = g.id and m.user_id = $1`;

type GroupRow = {
  id: string; name: string; description: string | null; visibility: 'public' | 'private'; student_only: boolean;
  kind: 'group' | 'club'; posting: 'everyone' | 'admins_only'; auto_type: string; club_verified: boolean;
  created_at: Date; cursor_at: string; member_count: number; my_status: 'pending' | 'active' | null; my_role: 'admin' | 'member' | null;
};

function groupBody(g: GroupRow) {
  const insider = g.my_status === 'active';
  return {
    id: g.id, name: g.name, description: g.description, visibility: g.visibility, studentOnly: g.student_only,
    kind: g.kind, clubVerified: g.club_verified, posting: g.posting, isClassGroup: g.auto_type === 'course_year',
    // Private groups show name and description only to non-members.
    memberCount: g.visibility === 'public' || insider ? g.member_count : null,
    myStatus: g.my_status ?? 'none', myRole: insider ? g.my_role : null,
  };
}

async function loadGroup(q: Queryable, viewer: { userId: string; campusId: string }, groupId: string): Promise<GroupRow | null> {
  const { rows } = await q.query<GroupRow>(`${GROUP_SELECT} where g.id = $3 and ${visibleGroup('g', V)}`, [viewer.userId, viewer.campusId, groupId]);
  return rows[0] ?? null;
}

/**
 * Groups (docs/api-contract.md section 8, issue #25). Class groups (one per course and year) are
 * managed from profiles by syncClassGroup: nobody joins or leaves them by hand.
 */
export async function groupRoutes(app: FastifyInstance, { db }: { db: Db }) {
  useContractErrors(app);
  const notFound = (reply: Parameters<typeof fail>[0]) => fail(reply, 404, 'not_found', 'Group not found.');
  const badCursor = (reply: Parameters<typeof fail>[0]) => fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.');

  // ---- GET /api/groups?mine=true&limit&cursor   newest first
  app.get('/api/groups', async (req, reply) => {
    const q = parse(z.object({ ...pageQuery, mine: z.enum(['true', 'false']).default('false') }).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    // Discover leaves out other people's class groups; "mine" is every group I belong to or asked to join.
    const filter = q.mine === 'true' ? 'm.user_id is not null' : `(g.auto_type = 'none' or m.status = 'active')`;
    const { rows } = await db.query<GroupRow>(
      `${GROUP_SELECT}
        where ${visibleGroup('g', V)} and ${filter}
          and ($3::timestamptz is null or (g.created_at, g.id) < ($3::timestamptz, $4::uuid))
        order by g.created_at desc, g.id desc
        limit $5`,
      [req.auth!.userId, req.auth!.campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: p.rows.map(groupBody), nextCursor: p.nextCursor };
  });

  // ---- POST /api/groups   { name, description?, visibility, studentOnly? }   the creator is its admin
  app.post('/api/groups', async (req, reply) => {
    const body = parse(z.object({
      name: z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1, 'cannot be empty').max(120)),
      description: z.string().trim().max(1000).optional(),
      visibility: z.enum(['public', 'private']),
      studentOnly: z.boolean().default(false),
    }).strict(), req.body, reply);
    if (!body) return;
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;
    const me = (await loadMe(db, viewer.userId))!;
    if (body.studentOnly && !isStudent(me.member_type)) {
      return fail(reply, 403, 'forbidden', 'Only current students can make a students-only group.');
    }

    const outcome = await inTransaction(db, async (tx) => {
      const wait = await takeRateLimits(tx, [{ bucket: 'group_create', key: viewer.userId, max: GROUPS_PER_DAY, windowSeconds: 86_400 }]);
      if (wait) return { ok: false as const, wait };
      const { rows } = await tx.query<{ id: string }>(
        `insert into groups (campus_id, name, description, visibility, student_only, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [viewer.campusId, body.name, body.description || null, body.visibility, body.studentOnly, viewer.userId],
      );
      const id = rows[0]!.id;
      await tx.query(`insert into group_members (group_id, user_id, role, status) values ($1, $2, 'admin', 'active')`, [id, viewer.userId]);
      return { ok: true as const, id };
    });
    if (!outcome.ok) {
      reply.header('Retry-After', String(outcome.wait));
      return fail(reply, 429, 'rate_limited', `You have made ${GROUPS_PER_DAY} groups today. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
    }
    return reply.code(201).send(groupBody((await loadGroup(db, viewer, outcome.id))!));
  });

  // ---- GET /api/groups/:id
  app.get('/api/groups/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const g = params.success ? await loadGroup(db, req.auth!, params.data.id) : null;
    return g ? groupBody(g) : notFound(reply);
  });

  // ---- PUT /api/groups/:id/membership   join a public group, or ask to join a private one
  app.put('/api/groups/:id/membership', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const g = params.success ? await loadGroup(db, req.auth!, params.data.id) : null;
    if (!g) return notFound(reply);
    if (g.auto_type === 'course_year') return fail(reply, 403, 'forbidden', 'Class groups follow your course and year in your profile.');
    if (g.my_status) return { status: g.my_status };                       // already in, or already asked
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const status = g.visibility === 'public' ? 'active' : 'pending';
    const { rows } = await db.query<{ status: 'active' | 'pending' }>(
      `insert into group_members (group_id, user_id, role, status) values ($1, $2, 'member', $3)
       on conflict (group_id, user_id) do update set status = group_members.status returning status`,
      [g.id, req.auth!.userId, status],
    );
    return { status: rows[0]!.status };
  });

  // ---- DELETE /api/groups/:id/membership   leave, or withdraw a request
  app.delete('/api/groups/:id/membership', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const g = params.success ? await loadGroup(db, req.auth!, params.data.id) : null;
    if (!g) return notFound(reply);
    if (g.auto_type === 'course_year' && g.my_status) {
      return fail(reply, 403, 'forbidden', 'Class groups follow your course and year in your profile.');
    }
    await inTransaction(db, async (tx) => {
      await tx.query('select 1 from groups where id = $1 for update', [g.id]);   // one leave at a time per group
      const { rows } = await tx.query<{ role: string; status: string }>(
        'delete from group_members where group_id = $1 and user_id = $2 returning role, status', [g.id, req.auth!.userId]);
      // The last admin is leaving: the longest-standing member takes over, so no group is left without one.
      if (rows[0]?.role === 'admin') await ensureGroupHasAdmin(tx, g.id);
    });
    return reply.code(204).send();
  });

  /** The viewer must be an active admin of a group they can see; sends 404 or 403 otherwise. */
  async function asAdmin(req: Parameters<typeof loadGroup>[1] & object, groupId: string, reply: Parameters<typeof fail>[0]) {
    const g = await loadGroup(db, req, groupId);
    if (!g) { notFound(reply); return null; }
    if (g.my_status !== 'active' || g.my_role !== 'admin') { fail(reply, 403, 'forbidden', 'Only the group’s admins can do that.'); return null; }
    return g;
  }

  // ---- GET /api/groups/:id/requests   admins: who is waiting
  app.get('/api/groups/:id/requests', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return notFound(reply);
    if (!(await asAdmin(req.auth!, params.data.id, reply))) return;
    const { rows } = await db.query<{ id: string; name: string | null; photo_url: string | null; member_type: string; joined_at: Date }>(
      `select u.id, u.name, u.photo_url, u.member_type, m.joined_at
         from group_members m join users u on u.id = m.user_id
        where m.group_id = $1 and m.status = 'pending' and u.deleted_at is null
        order by m.joined_at, m.user_id limit 200`,
      [params.data.id],
    );
    return { items: rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, memberType: r.member_type, requestedAt: r.joined_at.toISOString() })) };
  });

  // ---- POST /api/groups/:id/requests/:userId   admins: { approve }
  app.post('/api/groups/:id/requests/:userId', async (req, reply) => {
    const params = z.object({ id: uuid, userId: uuid }).safeParse(req.params);
    const body = parse(z.object({ approve: z.boolean() }).strict(), req.body, reply);
    if (!body) return;
    if (!params.success) return notFound(reply);
    if (!(await asAdmin(req.auth!, params.data.id, reply))) return;
    const { rowCount } = await db.query(
      body.approve
        ? `update group_members set status = 'active', joined_at = clock_timestamp() where group_id = $1 and user_id = $2 and status = 'pending'`
        : `delete from group_members where group_id = $1 and user_id = $2 and status = 'pending'`,
      [params.data.id, params.data.userId],
    );
    if (!rowCount) return fail(reply, 404, 'not_found', 'No request from that member.');
    return { status: body.approve ? 'active' : 'none' };
  });

  // ---- GET /api/groups/:id/members   active members only, longest-standing first (each with their role)
  app.get('/api/groups/:id/members', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    const g = params.success ? await loadGroup(db, req.auth!, params.data.id) : null;
    if (!g) return notFound(reply);
    if (g.my_status !== 'active') return fail(reply, 403, 'forbidden', 'Join the group to see who is in it.');
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    const { rows } = await db.query<{ id: string; name: string | null; photo_url: string | null; member_type: string; role: string; joined_at: Date; cursor_at: string }>(
      `select u.id, u.name, u.photo_url, u.member_type, m.role, m.joined_at, m.joined_at::text as cursor_at
         from group_members m join users u on u.id = m.user_id
        where m.group_id = $3 and m.status = 'active' and u.deleted_at is null and ${notBlocked('u.id', V)} and $2::uuid is not null
          and ($4::timestamptz is null or (m.joined_at, u.id) > ($4::timestamptz, $5::uuid))
        order by m.joined_at, u.id
        limit $6`,
      [req.auth!.userId, req.auth!.campusId, g.id, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return {
      items: p.rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, memberType: r.member_type, role: r.role, joinedAt: r.joined_at.toISOString() })),
      nextCursor: p.nextCursor,
    };
  });

  // ---- PUT /api/groups/:id/members/:userId/role   admins: { role: "admin" | "member" }
  app.put('/api/groups/:id/members/:userId/role', async (req, reply) => {
    const params = z.object({ id: uuid, userId: uuid }).safeParse(req.params);
    const body = parse(z.object({ role: z.enum(['admin', 'member']) }).strict(), req.body, reply);
    if (!body) return;
    if (!params.success) return notFound(reply);
    if (!(await asAdmin(req.auth!, params.data.id, reply))) return;
    const outcome = await inTransaction(db, async (tx) => {
      await tx.query('select 1 from groups where id = $1 for update', [params.data.id]);   // one role change at a time
      const { rows } = await tx.query<{ role: string }>(
        `select role from group_members where group_id = $1 and user_id = $2 and status = 'active'`, [params.data.id, params.data.userId]);
      if (!rows[0]) return 'missing' as const;
      if (body.role === 'member' && rows[0].role === 'admin') {
        const others = await tx.query(
          `select 1 from group_members where group_id = $1 and role = 'admin' and status = 'active' and user_id <> $2`, [params.data.id, params.data.userId]);
        if (others.rows.length === 0) return 'last' as const;
      }
      await tx.query('update group_members set role = $3 where group_id = $1 and user_id = $2', [params.data.id, params.data.userId, body.role]);
      return 'ok' as const;
    });
    if (outcome === 'missing') return fail(reply, 404, 'not_found', 'That person is not a member of this group.');
    if (outcome === 'last') return fail(reply, 409, 'last_admin', 'A group needs at least one admin. Make someone else an admin first.');
    return { role: body.role };
  });

  // ---- DELETE /api/groups/:id/members/:userId   admins remove a member (not another admin; not in class groups)
  app.delete('/api/groups/:id/members/:userId', async (req, reply) => {
    const params = z.object({ id: uuid, userId: uuid }).safeParse(req.params);
    if (!params.success) return notFound(reply);
    const g = await asAdmin(req.auth!, params.data.id, reply);
    if (!g) return;
    if (g.auto_type === 'course_year') return fail(reply, 403, 'forbidden', 'Class groups follow members’ profiles.');
    if (params.data.userId === req.auth!.userId) return fail(reply, 400, 'invalid_input', 'To leave the group, use leave.');
    const { rows } = await db.query<{ role: string }>(
      `select role from group_members where group_id = $1 and user_id = $2 and status = 'active'`, [g.id, params.data.userId]);
    if (!rows[0]) return fail(reply, 404, 'not_found', 'That person is not a member of this group.');
    if (rows[0].role === 'admin') return fail(reply, 403, 'forbidden', 'Make them a member first, then remove them.');
    await db.query('delete from group_members where group_id = $1 and user_id = $2', [g.id, params.data.userId]);
    return reply.code(204).send();
  });

  // ---- GET /api/groups/:id/posts   members only, newest first
  app.get('/api/groups/:id/posts', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    const g = params.success ? await loadGroup(db, req.auth!, params.data.id) : null;
    if (!g) return notFound(reply);
    if (g.my_status !== 'active') return fail(reply, 403, 'forbidden', 'Join the group to see its posts.');
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    const { rows } = await db.query<PostRow>(
      `${POST_SELECT}
        where p.group_id = $3 and ${visiblePost('p', V)}
          and ($4::timestamptz is null or (p.created_at, p.id) < ($4::timestamptz, $5::uuid))
        order by p.created_at desc, p.id desc
        limit $6`,
      [req.auth!.userId, req.auth!.campusId, g.id, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: p.rows.map(postBody), nextCursor: p.nextCursor };
  });
}

/** Housekeeping: group-creation rate-limit counts after a day. */
export async function cleanupGroups(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket = 'group_create' and created_at < now() - interval '2 days'`);
}
