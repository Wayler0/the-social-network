import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { notify } from '../notifications/notify.js';
import { fail, iso, parse, useContractErrors, uuid } from '../http.js';
import type { Queryable } from '../images/store.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { notBlocked, visibleGroup, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id, $2 their campus and $3 the target. */
const V: ViewerSql = { id: '$1', campusId: '$2' };
const FOLLOWS_PER_HOUR = 200;

export type FollowTarget = 'user' | 'office' | 'group';

/**
 * What may be followed, per type. Anything else answers 404, so following reveals nothing:
 *   user   — another live member of your campus, no block either way;
 *   office — a verified office account of your campus;
 *   group  — a public club of your campus that you may see (staff never see student-only groups).
 *            Private clubs and ordinary groups are joined, not followed.
 */
const FOLLOWABLE: Record<FollowTarget, string> = {
  user:   `select 1 from users t where t.id = $3 and t.id <> $1 and t.campus_id = $2 and t.deleted_at is null and ${notBlocked('t.id', V)}`,
  // $1 is unused here but bound, so give it a type.
  office: `select 1 from office_accounts t where t.id = $3 and t.campus_id = $2 and t.verified and $1::uuid is not null`,
  group:  `select 1 from groups t where t.id = $3 and t.kind = 'club' and t.visibility = 'public' and ${visibleGroup('t', V)}`,
};

const params = z.object({ type: z.enum(['user', 'office', 'group']), id: uuid });

/**
 * Follows (v0.2; docs/api-contract.md section 12).
 *   PUT    /api/follows/:type/:id     follow (idempotent) → { following: true, followerCount }
 *   DELETE /api/follows/:type/:id     unfollow (idempotent) → { following: false, followerCount }
 *   GET    /api/me/following?type&limit&cursor   whom I follow, newest first
 *   GET    /api/me/followers?limit&cursor        members who follow me, newest first
 */
export async function followRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);
  const badCursor = (reply: Parameters<typeof fail>[0]) => fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.');

  for (const following of [true, false]) {
    app.route({
      method: following ? 'PUT' : 'DELETE',
      url: '/api/follows/:type/:id',
      handler: async (req, reply) => {
        const p = params.safeParse(req.params);
        if (!p.success) return fail(reply, 404, 'not_found', 'Not found.');
        const { type, id } = p.data;
        const { userId, campusId } = req.auth!;

        if (!following) {
          await db.query('delete from follows where follower_id = $1 and target_type = $2 and target_id = $3', [userId, type, id]);
          return { following: false, followerCount: await followerCount(db, type, id) };
        }

        const outcome = await inTransaction(db, async (tx) => {
          const ok = await tx.query(FOLLOWABLE[type], [userId, campusId, id]);
          if (ok.rows.length === 0) return 'missing' as const;
          const already = await tx.query('select 1 from follows where follower_id = $1 and target_type = $2 and target_id = $3', [userId, type, id]);
          if (already.rows.length > 0) return 'ok' as const;
          const wait = await takeRateLimits(tx, [{ bucket: 'follow_user', key: userId, max: FOLLOWS_PER_HOUR, windowSeconds: 3600 }]);
          if (wait) return wait;
          await tx.query('insert into follows (follower_id, target_type, target_id) values ($1, $2, $3) on conflict do nothing', [userId, type, id]);
          if (type === 'user') await notify(tx, config.APP_NAME, { type: 'follow', userIds: [id], actorId: userId, targetId: userId });
          return 'ok' as const;
        });
        if (outcome === 'missing') return fail(reply, 404, 'not_found', 'Not found.');
        if (typeof outcome === 'number') {
          reply.header('Retry-After', String(outcome));
          return fail(reply, 429, 'rate_limited', `You have followed a lot today. Try again in ${waitText(outcome)}.`, { retryAfterSeconds: outcome });
        }
        return { following: true, followerCount: await followerCount(db, type, id) };
      },
    });
  }

  // ---- GET /api/me/following?type=user|office|group
  app.get('/api/me/following', async (req, reply) => {
    const q = parse(z.object({ ...pageQuery, type: z.enum(['user', 'office', 'group']).optional() }).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    // Targets that are gone, blocked, or no longer followable are left out (housekeeping removes them).
    const { rows } = await db.query<{ id: string; type: FollowTarget; name: string; photo_url: string | null;
      created_at: Date; cursor_at: string }>(
      `select f.target_id as id, f.target_type as type, coalesce(u.name, o.name, g.name) as name,
              coalesce(u.photo_url, o.photo_url) as photo_url, f.created_at, f.created_at::text as cursor_at
         from follows f
         left join users u on f.target_type = 'user' and u.id = f.target_id and u.deleted_at is null and ${notBlocked('u.id', V)}
         left join office_accounts o on f.target_type = 'office' and o.id = f.target_id
         left join groups g on f.target_type = 'group' and g.id = f.target_id and ${visibleGroup('g', V)}
        where f.follower_id = $1 and ($3::text is null or f.target_type = $3)
          and coalesce(u.id, o.id, g.id) is not null
          and ($4::timestamptz is null or (f.created_at, f.target_id) < ($4::timestamptz, $5::uuid))
        order by f.created_at desc, f.target_id desc
        limit $6`,
      [req.auth!.userId, req.auth!.campusId, q.type ?? null, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return {
      items: p.rows.map((r) => ({ type: r.type, id: r.id, name: r.name, photoUrl: r.photo_url, since: iso(r.created_at) })),
      nextCursor: p.nextCursor,
    };
  });

  // ---- GET /api/me/followers   members who follow me
  app.get('/api/me/followers', async (req, reply) => {
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return badCursor(reply); throw e; }
    const { rows } = await db.query<{ id: string; name: string | null; photo_url: string | null; follows_back: boolean;
      created_at: Date; cursor_at: string }>(
      `select u.id, u.name, u.photo_url, f.created_at, f.created_at::text as cursor_at,
              exists (select 1 from follows b where b.follower_id = $1 and b.target_type = 'user' and b.target_id = u.id) as follows_back
         from follows f join users u on u.id = f.follower_id
        where f.target_type = 'user' and f.target_id = $1
          and u.campus_id = $2 and u.deleted_at is null and ${notBlocked('u.id', V)}
          and ($3::timestamptz is null or (f.created_at, u.id) < ($3::timestamptz, $4::uuid))
        order by f.created_at desc, u.id desc
        limit $5`,
      [req.auth!.userId, req.auth!.campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return {
      items: p.rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, followsBack: r.follows_back, since: iso(r.created_at) })),
      nextCursor: p.nextCursor,
    };
  });
}

/** Live followers of something: deleted accounts are not counted. */
export async function followerCount(db: Queryable, type: FollowTarget, id: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from follows f join users u on u.id = f.follower_id
      where f.target_type = $1 and f.target_id = $2 and u.deleted_at is null`, [type, id]);
  return rows[0]!.n;
}

/** Blocking ends follows both ways (call inside the block). */
export async function unfollowBothWays(db: Queryable, a: string, b: string): Promise<void> {
  await db.query(
    `delete from follows where target_type = 'user' and ((follower_id = $1 and target_id = $2) or (follower_id = $2 and target_id = $1))`,
    [a, b]);
}

/**
 * Housekeeping (hourly): follows pointing at nothing — a deleted member, an office or group that
 * is gone, a group that is no longer a public club — and follow rate-limit counts after a day.
 */
export async function cleanupFollows(db: Queryable): Promise<number> {
  const { rowCount } = await db.query(
    `delete from follows f
      where (f.target_type = 'user'   and not exists (select 1 from users u where u.id = f.target_id and u.deleted_at is null))
         or (f.target_type = 'office' and not exists (select 1 from office_accounts o where o.id = f.target_id))
         or (f.target_type = 'group'  and not exists (select 1 from groups g where g.id = f.target_id and g.kind = 'club' and g.visibility = 'public'))`);
  await db.query(`delete from rate_limit_events where bucket = 'follow_user' and created_at < now() - interval '1 day'`);
  return rowCount ?? 0;
}
