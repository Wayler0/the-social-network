import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { inTransaction, type Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import type { Queryable } from '../images/store.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { CONTENT, contentType, fail, idParam, iso, logAction, parse, requireStaff, type Actor, type ContentType } from './shared.js';

type Options = { db: Db; requireUser: RequireUser };

const isContent = (type: string): type is ContentType => type in CONTENT;

/** Hides one item, if it exists on the actor's campus. Returns whether it was found. */
async function hide(tx: Queryable, actor: Actor, type: ContentType, id: string): Promise<boolean> {
  const { table, campus } = CONTENT[type];
  const result = await tx.query(
    `update ${table} t set hidden_at = coalesce(t.hidden_at, now()), hidden_by = $3 where t.id = $1 and ${campus} = $2`,
    [id, actor.campusId, actor.id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Makes one item visible again, if it exists on the actor's campus. With `onlyAutoHidden`, it is
 * left alone when a moderator hid it on purpose (only the three-reports rule is undone).
 */
async function unhide(tx: Queryable, actor: Actor, type: ContentType, id: string, onlyAutoHidden = false): Promise<boolean> {
  const { table, campus } = CONTENT[type];
  const result = await tx.query(
    `update ${table} t set hidden_at = null, hidden_by = null
      where t.id = $1 and ${campus} = $2 ${onlyAutoHidden ? 'and t.hidden_at is not null and t.hidden_by is null' : ''}`,
    [id, actor.campusId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Closes every open report on one item with the same outcome. Returns how many were closed. */
async function closeReports(tx: Queryable, actor: Actor, type: string, id: string, status: 'hidden' | 'dismissed'): Promise<number> {
  const result = await tx.query(
    `update reports set status = $5, resolved_by = $2, resolved_at = now()
      where campus_id = $1 and target_type = $3 and target_id = $4 and status = 'open'`,
    [actor.campusId, actor.id, type, id, status],
  );
  return result.rowCount ?? 0;
}

type Snapshot = Record<string, unknown>;

/** Loads what each report is about, one query per kind of item on the page. */
async function loadTargets(db: Db, campusId: string, wanted: Array<{ type: string; id: string }>): Promise<Map<string, Snapshot>> {
  const found = new Map<string, Snapshot>();
  const ids = (type: string) => [...new Set(wanted.filter((w) => w.type === type).map((w) => w.id))];
  const author = (r: { author_id: string; author_name: string | null; author_deleted: boolean }) =>
    ({ id: r.author_id, name: r.author_deleted ? null : r.author_name, deleted: r.author_deleted });

  for (const type of ['post', 'comment', 'question', 'answer'] as const) {
    const list = ids(type);
    if (list.length === 0) continue;
    const { table, campus } = CONTENT[type];
    const authorColumn = type === 'post' ? 'author_user_id' : 'user_id';
    const deletedColumn = type === 'post' || type === 'comment' ? 't.deleted_at' : 'null::timestamptz';
    const { rows } = await db.query<{
      id: string; body: string; hidden_at: Date | null; hidden_by: string | null; deleted_at: Date | null; created_at: Date;
      author_id: string; author_name: string | null; author_deleted: boolean;
    }>(
      `select t.id, t.body, t.hidden_at, t.hidden_by, ${deletedColumn} as deleted_at, t.created_at,
              u.id as author_id, u.name as author_name, (u.deleted_at is not null) as author_deleted
         from ${table} t join users u on u.id = t.${authorColumn}
        where t.id = any($1::uuid[]) and ${campus} = $2`,
      [list, campusId],
    );
    for (const r of rows) {
      found.set(`${type}:${r.id}`, {
        body: r.body, author: author(r), createdAt: iso(r.created_at), deletedAt: iso(r.deleted_at),
        hiddenAt: iso(r.hidden_at), autoHidden: r.hidden_at !== null && r.hidden_by === null,
      });
    }
  }

  const users = ids('user');
  if (users.length) {
    const { rows } = await db.query<{ id: string; name: string | null; member_type: string; suspended_at: Date | null; suspended_until: Date | null; deleted_at: Date | null }>(
      'select id, name, member_type, suspended_at, suspended_until, deleted_at from users where id = any($1::uuid[]) and campus_id = $2',
      [users, campusId],
    );
    for (const r of rows) {
      found.set(`user:${r.id}`, {
        name: r.name, memberType: r.member_type, deleted: r.deleted_at !== null,
        suspended: r.suspended_at !== null && (r.suspended_until === null || r.suspended_until > new Date()),
        suspendedUntil: iso(r.suspended_until),
      });
    }
  }

  const groups = ids('group');
  if (groups.length) {
    const { rows } = await db.query<{ id: string; name: string; kind: string; visibility: string; student_only: boolean }>(
      'select id, name, kind, visibility, student_only from groups where id = any($1::uuid[]) and campus_id = $2',
      [groups, campusId],
    );
    for (const r of rows) found.set(`group:${r.id}`, { name: r.name, kind: r.kind, visibility: r.visibility, studentOnly: r.student_only });
  }
  return found;
}

/**
 * Moderation: the report queue and hiding content (docs/api-contract.md section 11, issue #37).
 * Open to moderators and admins. Everything is limited to the staff member's own campus.
 */
export async function moderationRoutes(app: FastifyInstance, { db, requireUser }: Options) {
  // ---- GET /api/admin/reports?status=open&limit&cursor
  // Open reports come oldest first (a queue); closed ones newest first (a history).
  app.get('/api/admin/reports', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'moderator');
    if (!actor) return;
    const query = parse(z.object({ status: z.enum(['open', 'hidden', 'dismissed']).default('open'), ...pageQuery }).strict(), req.query, reply);
    if (!query) return;
    let cursor;
    try { cursor = decodeCursor(query.cursor); } catch (err) {
      if (err instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not a cursor from this list.');
      throw err;
    }
    const oldestFirst = query.status === 'open';
    const { rows } = await db.query<{
      id: string; cursor_at: string; target_type: string; target_id: string; reason: string; details: string | null; status: string;
      created_at: Date; resolved_at: Date | null; reporter_id: string | null; reporter_name: string | null;
      resolver_id: string | null; resolver_name: string | null; open_reports: number;
    }>(
      `select r.id, r.created_at::text as cursor_at, r.target_type, r.target_id, r.reason, r.details, r.status,
              r.created_at, r.resolved_at, rep.id as reporter_id, rep.name as reporter_name,
              res.id as resolver_id, res.name as resolver_name,
              (select count(*)::int from reports o
                where o.target_type = r.target_type and o.target_id = r.target_id and o.status = 'open') as open_reports
         from reports r
         left join users rep on rep.id = r.reporter_id
         left join users res on res.id = r.resolved_by
        where r.campus_id = $1 and r.status = $2
          and ($3::timestamptz is null or (r.created_at, r.id) ${oldestFirst ? '>' : '<'} ($3::timestamptz, $4::uuid))
        order by r.created_at ${oldestFirst ? 'asc' : 'desc'}, r.id ${oldestFirst ? 'asc' : 'desc'}
        limit $5`,
      [actor.campusId, query.status, cursor?.at ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const { rows: shown, nextCursor } = page(rows, query.limit);
    const targets = await loadTargets(db, actor.campusId, shown.map((r) => ({ type: r.target_type, id: r.target_id })));
    return {
      items: shown.map((r) => ({
        id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, status: r.status,
        createdAt: iso(r.created_at), resolvedAt: iso(r.resolved_at),
        reporter: r.reporter_id ? { id: r.reporter_id, name: r.reporter_name } : null,
        resolvedBy: r.resolver_id ? { id: r.resolver_id, name: r.resolver_name } : null,
        reportCount: r.open_reports,
        target: targets.get(`${r.target_type}:${r.target_id}`) ?? null,   // null: the item no longer exists
      })),
      nextCursor,
    };
  });

  // ---- POST /api/admin/reports/:id/resolve   { action: "hide" | "dismiss" }
  // Decides every open report on the same item at once, so the queue never asks twice.
  //   hide    — hides the item (posts, comments, questions, answers only).
  //   dismiss — the item is fine; if three reports had auto-hidden it, it becomes visible again.
  app.post('/api/admin/reports/:id/resolve', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'moderator');
    if (!actor) return;
    const params = parse(idParam, req.params, reply);
    const body = params && parse(z.object({ action: z.enum(['hide', 'dismiss']) }).strict(), req.body, reply);
    if (!params || !body) return;

    const outcome = await inTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ target_type: string; target_id: string; status: string }>(
        'select target_type, target_id, status from reports where id = $1 and campus_id = $2 for update',
        [params.id, actor.campusId],
      );
      const report = rows[0];
      if (!report) return { code: 404 as const };
      if (report.status !== 'open') return { code: 409 as const };
      const type = report.target_type;
      if (body.action === 'hide') {
        if (!isContent(type)) return { code: 400 as const };
        await hide(tx, actor, type, report.target_id);
      } else if (isContent(type)) {
        await unhide(tx, actor, type, report.target_id, true);
      }
      const status = body.action === 'hide' ? 'hidden' as const : 'dismissed' as const;
      const resolved = await closeReports(tx, actor, type, report.target_id, status);
      await logAction(tx, actor, `report.${body.action}`, type, report.target_id, { reportId: params.id, reportsClosed: resolved });
      return { code: 200 as const, status, resolved };
    });

    if (outcome.code === 404) return fail(reply, 404, 'not_found', 'Report not found.');
    if (outcome.code === 409) return fail(reply, 409, 'already_resolved', 'That report has already been dealt with.');
    if (outcome.code === 400) return fail(reply, 400, 'invalid_input', 'Members and groups cannot be hidden. Dismiss the report, or suspend the member.');
    return { status: outcome.status, resolved: outcome.resolved };
  });

  // ---- POST /api/admin/content/:type/:id/hide  and  …/unhide
  for (const verb of ['hide', 'unhide'] as const) {
    app.post(`/api/admin/content/:type/:id/${verb}`, async (req, reply) => {
      const actor = await requireStaff(db, requireUser, req, reply, 'moderator');
      if (!actor) return;
      const params = parse(z.object({ type: contentType, id: z.string().uuid() }), req.params, reply);
      const body = params && parse(z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict(), req.body, reply);
      if (!params || !body) return;

      const done = await inTransaction(db, async (tx) => {
        const found = verb === 'hide' ? await hide(tx, actor, params.type, params.id) : await unhide(tx, actor, params.type, params.id);
        if (!found) return null;
        // Hiding answers any open reports on the item; showing it again leaves the record as it is.
        const resolved = verb === 'hide' ? await closeReports(tx, actor, params.type, params.id, 'hidden') : 0;
        await logAction(tx, actor, `content.${verb}`, params.type, params.id, { reason: body.reason ?? null, reportsClosed: resolved });
        return { resolved };
      });
      if (!done) return fail(reply, 404, 'not_found', 'Not found.');
      return { hidden: verb === 'hide', resolved: done.resolved };
    });
  }
}
