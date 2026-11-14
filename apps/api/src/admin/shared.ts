import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { fail } from '../http.js';
import type { Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import type { Queryable } from '../images/store.js';

/** The staff member making the request: who they are, which campus they manage, and how much they may do. */
export type Actor = { id: string; campusId: string; isAdmin: boolean };

// The general helpers moved to ../http.ts; re-exported so admin code keeps importing from here.
export { fail, idParam, iso, parse, uuid } from '../http.js';

/**
 * Who may use the admin API (docs/api-contract.md section 11):
 *   moderators — the report queue and hiding content;
 *   admins     — everything, including suspending members, offices, roles and disputes.
 * A role counts only while it is in force, and never for a suspended or deleted account.
 * Returns null after sending 401 or 403.
 */
export async function requireStaff(
  db: Db, requireUser: RequireUser, req: FastifyRequest, reply: FastifyReply, need: 'moderator' | 'admin',
): Promise<Actor | null> {
  const user = await requireUser(req);
  if (!user) { fail(reply, 401, 'not_signed_in', 'Please sign in.'); return null; }
  const { rows } = await db.query<{ campus_id: string; is_admin: boolean; is_moderator: boolean }>(
    `select u.campus_id,
            exists (select 1 from roles r where r.user_id = u.id and r.role = 'admin'
                     and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())) as is_admin,
            exists (select 1 from roles r where r.user_id = u.id and r.role = 'moderator'
                     and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())) as is_moderator
       from users u
      where u.id = $1 and u.deleted_at is null
        and (u.suspended_at is null or (u.suspended_until is not null and u.suspended_until <= now()))`,
    [user.id],
  );
  const row = rows[0];
  const allowed = row && (row.is_admin || (need === 'moderator' && row.is_moderator));
  if (!allowed) { fail(reply, 403, 'forbidden', 'You are not allowed to do that.'); return null; }
  return { id: user.id, campusId: row.campus_id, isAdmin: row.is_admin };
}

/** Every admin action is recorded: who, what, on what, when (and why, where a reason is given). */
export async function logAction(
  tx: Queryable, actor: Actor, action: string, targetType: string | null, targetId: string | null, details: object | null = null,
): Promise<void> {
  await tx.query(
    // clock_timestamp(): the real time of this action, not the start of the surrounding transaction.
    'insert into admin_log (campus_id, admin_user_id, action, target_type, target_id, details, created_at) values ($1, $2, $3, $4, $5, $6, clock_timestamp())',
    [actor.campusId, actor.id, action, targetType, targetId, details ? JSON.stringify(details) : null],
  );
}

/** The moderated content types and where they live. Table and column names are constants, never user input. */
export const CONTENT = {
  post:     { table: 'posts',     campus: 't.campus_id' },
  comment:  { table: 'comments',  campus: '(select p.campus_id from posts p where p.id = t.post_id)' },
  question: { table: 'questions', campus: 't.campus_id' },
  answer:   { table: 'answers',   campus: '(select q.campus_id from questions q where q.id = t.question_id)' },
} as const;
export type ContentType = keyof typeof CONTENT;
export const contentType = z.enum(['post', 'comment', 'question', 'answer']);
