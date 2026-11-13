import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, type Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import type { Queryable } from '../images/store.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { fail, idParam, iso, logAction, parse, requireStaff, uuid } from './shared.js';

type Options = { db: Db; requireUser: RequireUser };

type UserRow = {
  id: string; name: string | null; email: string | null; member_type: string; member_number: string | null;
  member_number_status: string; course: string | null; year_of_study: number | null; graduation_year: number | null;
  is_under_18: boolean | null; verified: boolean; suspended_at: Date | null; suspended_until: Date | null;
  suspended_reason: string | null; created_at: Date; deleted_at: Date | null;
  roles: Array<{ id: string; role: string; title: string | null; endsAt: string | null }> | null;
};

const USER_COLUMNS = `u.id, u.name, u.email, u.member_type, u.member_number, u.member_number_status, u.course, u.year_of_study,
  u.graduation_year, u.is_under_18, u.verified, u.suspended_at, u.suspended_until, u.suspended_reason, u.created_at, u.deleted_at,
  (select json_agg(json_build_object('id', r.id, 'role', r.role, 'title', r.title, 'endsAt', r.ends_at) order by r.created_at)
     from roles r where r.user_id = u.id and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())) as roles`;

/** A member as admins see them. Includes email and member number: admin endpoints only (contract section 1). */
function adminUser(u: UserRow) {
  const suspended = u.suspended_at !== null && (u.suspended_until === null || u.suspended_until > new Date());
  return {
    id: u.id, name: u.name, email: u.email, memberType: u.member_type, memberNumber: u.member_number,
    memberNumberStatus: u.member_number_status, course: u.course, yearOfStudy: u.year_of_study, graduationYear: u.graduation_year,
    isUnder18: u.is_under_18, verified: u.verified, createdAt: iso(u.created_at), deleted: u.deleted_at !== null,
    suspended: suspended ? { since: iso(u.suspended_at), until: iso(u.suspended_until), reason: u.suspended_reason } : null,
    roles: u.roles ?? [],
  };
}

async function findUser(tx: Queryable, campusId: string, id: string): Promise<UserRow | null> {
  const { rows } = await tx.query<UserRow>(`select ${USER_COLUMNS} from users u where u.id = $1 and u.campus_id = $2`, [id, campusId]);
  return rows[0] ?? null;
}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

/**
 * Management: members, roles, offices, clubs, disputes and the log (docs/api-contract.md section 11, issue #37).
 * Admins only. Everything is limited to the admin's own campus.
 */
export async function managementRoutes(app: FastifyInstance, { db, requireUser }: Options) {
  // ---- GET /api/admin/users?q=…   find members by name, email or member number (to act on them)
  app.get('/api/admin/users', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const query = parse(z.object({ q: z.string().trim().min(2).max(100) }).strict(), req.query, reply);
    if (!query) return;
    const like = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
    const { rows } = await db.query<UserRow>(
      `select ${USER_COLUMNS} from users u
        where u.campus_id = $1
          and (u.name ilike $2 or u.email ilike $2
               or u.member_number_normalised = upper(regexp_replace($3, '[\\s-]', '', 'g')))
        order by u.deleted_at is not null, u.name nulls last, u.created_at
        limit 20`,
      [actor.campusId, like, query.q],
    );
    return { items: rows.map(adminUser) };
  });

  // ---- POST /api/admin/users/:id/suspend   { reason, until? }   — also signs the member out everywhere
  app.post('/api/admin/users/:id/suspend', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    const body = params && parse(z.object({
      reason: z.string().trim().min(1).max(500),
      until: z.string().datetime({ offset: true }).optional(),   // leave out for "until an admin lifts it"
    }).strict(), req.body, reply);
    if (!params || !body) return;
    if (params.id === actor.id) return fail(reply, 400, 'invalid_input', 'You cannot suspend yourself.');
    const until = body.until ? new Date(body.until) : null;
    if (until && until.getTime() <= Date.now()) return fail(reply, 400, 'invalid_input', 'until: must be in the future.');

    const user = await inTransaction(db, async (tx) => {
      const target = await findUser(tx, actor.campusId, params.id);
      if (!target || target.deleted_at) return null;
      await tx.query('update users set suspended_at = now(), suspended_until = $2, suspended_reason = $3 where id = $1', [params.id, until, body.reason]);
      const out = await tx.query('update sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [params.id]);
      await logAction(tx, actor, 'user.suspend', 'user', params.id, { reason: body.reason, until: iso(until), sessionsRevoked: out.rowCount ?? 0 });
      return findUser(tx, actor.campusId, params.id);
    });
    if (!user) return fail(reply, 404, 'not_found', 'Member not found.');
    return adminUser(user);
  });

  // ---- POST /api/admin/users/:id/unsuspend
  app.post('/api/admin/users/:id/unsuspend', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const user = await inTransaction(db, async (tx) => {
      const target = await findUser(tx, actor.campusId, params.id);
      if (!target || target.deleted_at) return null;
      await tx.query('update users set suspended_at = null, suspended_until = null, suspended_reason = null where id = $1', [params.id]);
      await logAction(tx, actor, 'user.unsuspend', 'user', params.id);
      return findUser(tx, actor.campusId, params.id);
    });
    if (!user) return fail(reply, 404, 'not_found', 'Member not found.');
    return adminUser(user);
  });

  // ---- POST /api/admin/users/:id/roles   { role, title?, endsAt? }   — badges are granted here, never self-claimed
  app.post('/api/admin/users/:id/roles', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    const body = params && parse(z.object({
      role: z.enum(['staff', 'student_leader', 'club_leader', 'moderator', 'admin']),
      title: z.string().trim().min(1).max(120).optional(),
      endsAt: z.string().datetime({ offset: true }).optional(),
    }).strict(), req.body, reply);
    if (!params || !body) return;
    const endsAt = body.endsAt ? new Date(body.endsAt) : null;
    if (endsAt && endsAt.getTime() <= Date.now()) return fail(reply, 400, 'invalid_input', 'endsAt: must be in the future.');

    const result = await inTransaction(db, async (tx) => {
      // One grant at a time per member: two identical requests at the same moment must not both pass the duplicate check.
      await tx.query('select 1 from users where id = $1 and campus_id = $2 for update', [params.id, actor.campusId]);
      const target = await findUser(tx, actor.campusId, params.id);
      if (!target || target.deleted_at) return 'missing' as const;
      if (body.role === 'staff' && target.member_type !== 'staff') return 'not_staff' as const;
      if ((target.roles ?? []).some((r) => r.role === body.role && r.title === (body.title ?? null))) return 'duplicate' as const;
      const made = await tx.query<{ id: string }>(
        'insert into roles (user_id, role, title, ends_at, granted_by) values ($1, $2, $3, $4, $5) returning id',
        [params.id, body.role, body.title ?? null, endsAt, actor.id],
      );
      await logAction(tx, actor, 'role.grant', 'user', params.id, { roleId: made.rows[0]!.id, role: body.role, title: body.title ?? null, endsAt: iso(endsAt) });
      return findUser(tx, actor.campusId, params.id);
    });
    if (result === 'missing' || result === null) return fail(reply, 404, 'not_found', 'Member not found.');
    if (result === 'not_staff') return fail(reply, 400, 'invalid_input', 'The Staff badge is only for members who signed up with a staff email.');
    if (result === 'duplicate') return fail(reply, 409, 'already_has_role', 'This member already holds that role.');
    return reply.code(201).send(adminUser(result));
  });

  // ---- DELETE /api/admin/roles/:id   ends a role now (the row is kept as history)
  app.delete('/api/admin/roles/:id', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    if (!params) return;
    const result = await inTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ user_id: string; role: string }>(
        `select r.user_id, r.role from roles r join users u on u.id = r.user_id
          where r.id = $1 and u.campus_id = $2 and (r.ends_at is null or r.ends_at > now()) for update of r`,
        [params.id, actor.campusId],
      );
      const role = rows[0];
      if (!role) return 'missing' as const;
      // An admin ending their own admin role could leave the campus with nobody able to undo it.
      if (role.role === 'admin' && role.user_id === actor.id) return 'own_admin' as const;
      await tx.query('update roles set ends_at = greatest(now(), starts_at + interval \'1 millisecond\') where id = $1', [params.id]);
      await logAction(tx, actor, 'role.end', 'user', role.user_id, { roleId: params.id, role: role.role });
      return 'ok' as const;
    });
    if (result === 'missing') return fail(reply, 404, 'not_found', 'Role not found.');
    if (result === 'own_admin') return fail(reply, 400, 'invalid_input', 'You cannot remove your own admin role. Ask another admin.');
    return reply.code(204).send();
  });

  // ---- GET /api/admin/offices   offices with their current members
  app.get('/api/admin/offices', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const { rows } = await db.query<{ id: string; name: string; type: string; verified: boolean; created_at: Date; members: unknown[] | null }>(
      `select o.id, o.name, o.type, o.verified, o.created_at,
              (select json_agg(json_build_object('id', u.id, 'name', u.name, 'role', m.role, 'since', m.starts_at) order by m.starts_at)
                 from office_members m join users u on u.id = m.user_id
                where m.office_id = o.id and (m.ends_at is null or m.ends_at > now())) as members
         from office_accounts o where o.campus_id = $1 order by lower(o.name)`,
      [actor.campusId],
    );
    return { items: rows.map((o) => ({ id: o.id, name: o.name, type: o.type, verified: o.verified, createdAt: iso(o.created_at), members: o.members ?? [] })) };
  });

  // ---- POST /api/admin/offices   { name, type }   — offices made by an admin are official (verified)
  app.post('/api/admin/offices', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const body = parse(z.object({
      name: z.string().trim().min(1).max(120),
      type: z.enum(['department', 'office', 'student_council', 'club']),
    }).strict(), req.body, reply);
    if (!body) return;
    try {
      const office = await inTransaction(db, async (tx) => {
        const { rows } = await tx.query<{ id: string; created_at: Date }>(
          'insert into office_accounts (campus_id, name, type, verified) values ($1, $2, $3, true) returning id, created_at',
          [actor.campusId, body.name, body.type],
        );
        await logAction(tx, actor, 'office.create', 'office', rows[0]!.id, { name: body.name, type: body.type });
        return rows[0]!;
      });
      return reply.code(201).send({ id: office.id, name: body.name, type: body.type, verified: true, createdAt: iso(office.created_at), members: [] });
    } catch (err) {
      if (isUniqueViolation(err)) return fail(reply, 409, 'office_name_taken', 'An office with that name already exists.');
      throw err;
    }
  });

  // ---- POST /api/admin/offices/:id/members   { userId, role }   add someone, or change their role
  app.post('/api/admin/offices/:id/members', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    const body = params && parse(z.object({ userId: uuid, role: z.enum(['owner', 'editor']) }).strict(), req.body, reply);
    if (!params || !body) return;
    const result = await inTransaction(db, async (tx) => {
      const office = await tx.query('select 1 from office_accounts where id = $1 and campus_id = $2', [params.id, actor.campusId]);
      if (!office.rowCount) return 'no_office' as const;
      const member = await findUser(tx, actor.campusId, body.userId);
      if (!member || member.deleted_at) return 'no_user' as const;
      // Someone who left and comes back starts a fresh term.
      await tx.query(
        `insert into office_members (office_id, user_id, role) values ($1, $2, $3)
         on conflict (office_id, user_id) do update
           set role = excluded.role,
               starts_at = case when office_members.ends_at is not null and office_members.ends_at <= now() then now() else office_members.starts_at end,
               ends_at = null`,
        [params.id, body.userId, body.role],
      );
      await logAction(tx, actor, 'office.member.add', 'office', params.id, { userId: body.userId, role: body.role });
      return 'ok' as const;
    });
    if (result === 'no_office') return fail(reply, 404, 'not_found', 'Office not found.');
    if (result === 'no_user') return fail(reply, 404, 'not_found', 'Member not found.');
    return reply.code(204).send();
  });

  // ---- DELETE /api/admin/offices/:id/members/:userId   handover: the person leaves, the office and its history stay
  app.delete('/api/admin/offices/:id/members/:userId', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(z.object({ id: uuid, userId: uuid }), req.params, reply);
    if (!params) return;
    const removed = await inTransaction(db, async (tx) => {
      const out = await tx.query(
        `update office_members m set ends_at = greatest(now(), m.starts_at + interval '1 millisecond')
          from office_accounts o
         where o.id = m.office_id and o.campus_id = $3 and m.office_id = $1 and m.user_id = $2
           and (m.ends_at is null or m.ends_at > now())`,
        [params.id, params.userId, actor.campusId],
      );
      if (!out.rowCount) return false;
      await logAction(tx, actor, 'office.member.remove', 'office', params.id, { userId: params.userId });
      return true;
    });
    if (!removed) return fail(reply, 404, 'not_found', 'That person is not a member of this office.');
    return reply.code(204).send();
  });

  // ---- POST /api/admin/groups/:id/verify-club  and  …/unverify-club   the CLUB badge
  for (const verb of ['verify-club', 'unverify-club'] as const) {
    app.post(`/api/admin/groups/:id/${verb}`, async (req, reply) => {
      const actor = await requireStaff(db, requireUser, req, reply, 'admin');
      if (!actor) return;
      const params = parse(idParam, req.params, reply);
      if (!params) return;
      const result = await inTransaction(db, async (tx) => {
        const { rows } = await tx.query<{ auto_type: string }>('select auto_type from groups where id = $1 and campus_id = $2 for update', [params.id, actor.campusId]);
        if (!rows[0]) return 'missing' as const;
        if (rows[0].auto_type !== 'none') return 'class_group' as const;
        if (verb === 'verify-club') {
          await tx.query(`update groups set kind = 'club', club_verified_at = now(), club_verified_by = $2 where id = $1`, [params.id, actor.id]);
        } else {
          await tx.query('update groups set club_verified_at = null, club_verified_by = null where id = $1', [params.id]);
        }
        await logAction(tx, actor, verb === 'verify-club' ? 'group.verify_club' : 'group.unverify_club', 'group', params.id);
        return 'ok' as const;
      });
      if (result === 'missing') return fail(reply, 404, 'not_found', 'Group not found.');
      if (result === 'class_group') return fail(reply, 400, 'invalid_input', 'A class group cannot be a club.');
      return { clubVerified: verb === 'verify-club' };
    });
  }

  // ---- GET /api/admin/disputes?status=open   "someone has claimed my reg number"
  app.get('/api/admin/disputes', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const query = parse(z.object({ status: z.enum(['open', 'resolved']).default('open') }).strict(), req.query, reply);
    if (!query) return;
    const { rows } = await db.query<{
      id: string; member_number_normalised: string; details: string | null; status: string; created_at: Date; resolved_at: Date | null;
      reporter_id: string; reporter_name: string | null; reporter_email: string | null;
      holder_id: string | null; holder_name: string | null; holder_email: string | null; holder_since: Date | null;
    }>(
      `select d.id, d.member_number_normalised, d.details, d.status, d.created_at, d.resolved_at,
              rep.id as reporter_id, rep.name as reporter_name, rep.email as reporter_email,
              h.id as holder_id, h.name as holder_name, h.email as holder_email, h.created_at as holder_since
         from member_number_disputes d
         join users rep on rep.id = d.reporter_user_id
         left join users h on h.campus_id = d.campus_id and h.member_number_normalised = d.member_number_normalised and h.deleted_at is null
        where d.campus_id = $1 and d.status = $2
        order by d.created_at
        limit 100`,
      [actor.campusId, query.status],
    );
    return {
      items: rows.map((d) => ({
        id: d.id, memberNumber: d.member_number_normalised, details: d.details, status: d.status,
        createdAt: iso(d.created_at), resolvedAt: iso(d.resolved_at),
        reporter: { id: d.reporter_id, name: d.reporter_name, email: d.reporter_email },
        // Who has the number now; null if nobody does any more.
        holder: d.holder_id ? { id: d.holder_id, name: d.holder_name, email: d.holder_email, memberSince: iso(d.holder_since) } : null,
      })),
    };
  });

  // ---- POST /api/admin/disputes/:id/resolve   { releaseNumber }
  //   releaseNumber: true  — the reporter is right: the number is taken off the account holding it, so its owner can claim it.
  //   releaseNumber: false — the holder keeps it.
  app.post('/api/admin/disputes/:id/resolve', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    const body = params && parse(z.object({ releaseNumber: z.boolean() }).strict(), req.body, reply);
    if (!params || !body) return;
    const result = await inTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ member_number_normalised: string; status: string }>(
        'select member_number_normalised, status from member_number_disputes where id = $1 and campus_id = $2 for update',
        [params.id, actor.campusId],
      );
      const dispute = rows[0];
      if (!dispute) return 'missing' as const;
      if (dispute.status !== 'open') return 'done' as const;
      let releasedFrom: string | null = null;
      if (body.releaseNumber) {
        const out = await tx.query<{ id: string }>(
          `update users set member_number = null, member_number_normalised = null, member_number_status = 'unverified'
            where campus_id = $1 and member_number_normalised = $2 and deleted_at is null returning id`,
          [actor.campusId, dispute.member_number_normalised],
        );
        releasedFrom = out.rows[0]?.id ?? null;
      }
      // Every open dispute about the same number is answered by this decision.
      await tx.query(
        `update member_number_disputes set status = 'resolved', resolved_at = now()
          where campus_id = $1 and member_number_normalised = $2 and status = 'open'`,
        [actor.campusId, dispute.member_number_normalised],
      );
      await logAction(tx, actor, 'dispute.resolve', 'dispute', params.id, { releaseNumber: body.releaseNumber, releasedFrom });
      return { releasedFrom };
    });
    if (result === 'missing') return fail(reply, 404, 'not_found', 'Dispute not found.');
    if (result === 'done') return fail(reply, 409, 'already_resolved', 'That dispute has already been dealt with.');
    return { status: 'resolved', numberReleased: result.releasedFrom !== null };
  });

  // ---- GET /api/admin/log?limit&cursor   who did what, newest first
  app.get('/api/admin/log', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const query = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!query) return;
    let cursor;
    try { cursor = decodeCursor(query.cursor); } catch (err) {
      if (err instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not a cursor from this list.');
      throw err;
    }
    const { rows } = await db.query<{
      id: string; cursor_at: string; action: string; target_type: string | null; target_id: string | null; details: unknown;
      created_at: Date; admin_id: string | null; admin_name: string | null;
    }>(
      `select l.id, l.created_at::text as cursor_at, l.action, l.target_type, l.target_id, l.details, l.created_at,
              u.id as admin_id, u.name as admin_name
         from admin_log l left join users u on u.id = l.admin_user_id
        where l.campus_id = $1
          and ($2::timestamptz is null or (l.created_at, l.id) < ($2::timestamptz, $3::uuid))
        order by l.created_at desc, l.id desc
        limit $4`,
      [actor.campusId, cursor?.at ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const { rows: shown, nextCursor } = page(rows, query.limit);
    return {
      items: shown.map((l) => ({
        id: l.id, action: l.action, targetType: l.target_type, targetId: l.target_id, details: l.details, createdAt: iso(l.created_at),
        by: l.admin_id ? { id: l.admin_id, name: l.admin_name } : null,
      })),
      nextCursor,
    };
  });
}
