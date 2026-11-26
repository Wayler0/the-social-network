import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { logAction, requireStaff } from '../admin/shared.js';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { fail, parse, useContractErrors } from '../http.js';
import { notify } from '../notifications/notify.js';

/**
 * Emergency button (CLAUDE.md section 4, MVP item 8; docs/api-contract.md section 18).
 *   GET  /api/emergency                       -> { contacts: [{ label, phone }] }   the campus's numbers
 *   POST /api/emergency { message? }          -> { id, contacts }   alerts moderators, admins and safety offices
 *   GET  /api/admin/emergencies?status=open   -> { items }          moderators and admins
 *   POST /api/admin/emergencies/:id/handled   -> 204
 * Who raised an alert is shown to those who handle it: they need to reach the person.
 */
const ALERTS_PER_HOUR = 3;
type Contact = { label: string; phone: string };

export async function emergencyRoutes(app: FastifyInstance, { config, db, requireUser }: { config: Config; db: Db; requireUser: RequireUser }) {
  useContractErrors(app);
  const contactsFor = async (campusId: string) =>
    ((await db.query<{ c: Contact[] }>('select emergency_contacts as c from campuses where id = $1', [campusId])).rows[0]?.c ?? [])
      .filter((x) => x && typeof x.label === 'string' && typeof x.phone === 'string');

  app.get('/api/emergency', async (req) => ({ contacts: await contactsFor(req.auth!.campusId) }));

  app.post('/api/emergency', async (req, reply) => {
    const body = parse(z.object({ message: z.string().transform((s) => s.trim()).pipe(z.string().max(500)).optional() }).strict(), req.body ?? {}, reply);
    if (!body) return;
    const { userId, campusId } = req.auth!;
    type Outcome = { wait: number } | { id: string; alerted: number };
    const outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
      const wait = await takeRateLimits(tx, [{ bucket: 'emergency_user', key: userId, max: ALERTS_PER_HOUR, windowSeconds: 3600 }]);
      if (wait) return { wait };
      const { rows } = await tx.query<{ id: string }>(
        'insert into emergency_alerts (campus_id, user_id, message) values ($1, $2, $3) returning id', [campusId, userId, body.message || null]);
      const id = rows[0]!.id;
      // Moderators, admins and current members of the campus's safety offices.
      const { rows: who } = await tx.query<{ id: string }>(
        `select distinct u.id from users u
          where u.campus_id = $1 and u.deleted_at is null and u.id <> $2
            and (exists (select 1 from roles r where r.user_id = u.id and r.role in ('moderator', 'admin')
                          and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()))
                 or exists (select 1 from office_members m join office_accounts o on o.id = m.office_id
                             where m.user_id = u.id and o.safety and o.campus_id = $1
                               and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now())))`,
        [campusId, userId]);
      const ids = who.map((r) => r.id);
      await notify(tx, config.APP_NAME, { type: 'emergency', userIds: ids, actorId: userId, targetId: id });
      // A push even to those who turned urgent pushes off: handling emergencies is their job.
      await tx.query(
        `insert into push_outbox (user_id, kind, title, body, url)
         select u.id, 'urgent', $2, 'A member pressed the emergency button', '/admin?tab=alerts' from users u
          where u.id = any($1::uuid[]) and exists (select 1 from push_subscriptions s where s.user_id = u.id)
            and not exists (select 1 from push_outbox p where p.user_id = u.id and p.url = '/admin?tab=alerts' and p.sent_at is null)`,
        [ids, `Emergency · ${config.APP_NAME}`]);
      return { id, alerted: ids.length };
    });
    if ('wait' in outcome) {
      reply.header('Retry-After', String(outcome.wait));
      return fail(reply, 429, 'rate_limited', `You’ve already sent alerts. If you’re in danger, call one of the numbers now. You can alert again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
    }
    req.log.warn({ alertId: outcome.id, alerted: outcome.alerted }, 'EMERGENCY ALERT');
    return reply.code(201).send({ id: outcome.id, contacts: await contactsFor(campusId) });
  });

  app.get('/api/admin/emergencies', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'moderator');
    if (!actor) return;
    const q = parse(z.object({ status: z.enum(['open', 'handled']).default('open') }).strict(), req.query, reply);
    if (!q) return;
    const { rows } = await db.query<{ id: string; message: string | null; status: string; created_at: Date; handled_at: Date | null;
      user_id: string | null; name: string | null; member_type: string | null; course: string | null; year_of_study: number | null; handler: string | null }>(
      `select a.id, a.message, a.status, a.created_at, a.handled_at,
              u.id as user_id, u.name, u.member_type, u.course, u.year_of_study, h.name as handler
         from emergency_alerts a left join users u on u.id = a.user_id left join users h on h.id = a.handled_by
        where a.campus_id = $1 and a.status = $2
        order by a.created_at desc limit 100`, [actor.campusId, q.status]);
    return {
      items: rows.map((r) => ({
        id: r.id, message: r.message, status: r.status, createdAt: r.created_at.toISOString(),
        handledAt: r.handled_at?.toISOString() ?? null, handledBy: r.handler,
        member: r.user_id ? { id: r.user_id, name: r.name, memberType: r.member_type, course: r.course, yearOfStudy: r.year_of_study } : null,
      })),
    };
  });

  app.post('/api/admin/emergencies/:id/handled', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'moderator');
    if (!actor) return;
    const p = z.object({ id: z.string().uuid() }).safeParse(req.params);
    if (!p.success) return fail(reply, 404, 'not_found', 'Alert not found.');
    const { rowCount } = await db.query(
      `update emergency_alerts set status = 'handled', handled_by = $3, handled_at = clock_timestamp()
        where id = $1 and campus_id = $2 and status = 'open'`, [p.data.id, actor.campusId, actor.id]);
    if (!rowCount) return fail(reply, 404, 'not_found', 'Alert not found or already handled.');
    await logAction(db, actor, 'emergency_handled', 'emergency', p.data.id);
    return reply.code(204).send();
  });
}
