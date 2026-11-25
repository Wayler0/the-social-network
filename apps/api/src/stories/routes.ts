import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, iso, parse, useContractErrors, uuid } from '../http.js';
import { attachImage, deleteImage, imageUrls, type Queryable } from '../images/store.js';
import { badgesFor } from '../me/profile.js';
import { requireCompleteProfile } from '../me/routes.js';
import { activeRoles } from '../posts/shape.js';
import { notBlocked, visibleGroup, visibleStory, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };

export const STORY_HOURS = 24;
const STORIES_PER_DAY = 30;
const LIST_LIMIT = 200;   // close friends and "hide from"

/** Live stories the row can show at once; more than enough for 24 hours of one campus. */
const ROW_LIMIT = 500;

type StoryRow = {
  id: string; body: string | null; audience: 'followers' | 'close_friends'; created_at: Date; expires_at: Date;
  author_user_id: string; author_name: string | null; author_photo: string | null; author_roles: string[];
  office_id: string | null; office_name: string | null; office_photo: string | null;
  group_id: string | null; group_name: string | null; group_verified: boolean | null;
  image_path: string | null; image_width: number | null; image_height: number | null;
  seen: boolean; view_count: number | null; liked_by_me: boolean; like_count: number | null;
};

const STORY_SELECT = `
  select s.id, s.body, s.audience, s.created_at, s.expires_at,
         s.author_user_id, au.name as author_name, au.photo_url as author_photo, ${activeRoles('au.id')} as author_roles,
         o.id as office_id, o.name as office_name, o.photo_url as office_photo,
         g.id as group_id, g.name as group_name, (g.club_verified_at is not null) as group_verified,
         i.path as image_path, i.width as image_width, i.height as image_height,
         exists (select 1 from story_views sv where sv.story_id = s.id and sv.viewer_id = $1) as seen,
         case when s.author_user_id = $1 then (select count(*) from story_views sv where sv.story_id = s.id)::int end as view_count,
         exists (select 1 from story_likes sl where sl.story_id = s.id and sl.user_id = $1) as liked_by_me,
         case when s.author_user_id = $1 then (select count(*) from story_likes sl where sl.story_id = s.id)::int end as like_count
    from stories s
    join users au on au.id = s.author_user_id
    left join office_accounts o on o.id = s.author_office_id
    left join groups g on g.id = s.author_group_id
    left join images i on i.id = s.image_id`;

type Kind = 'me' | 'office' | 'club' | 'user';
const KIND_ORDER: Record<Kind, number> = { me: 0, office: 1, club: 2, user: 3 };

/** Who a story belongs to on the row: the office, the club, or the person. */
function owner(s: StoryRow, viewerId: string) {
  if (s.office_id) return { kind: 'office' as Kind, key: `office:${s.office_id}`,
    author: { type: 'office', id: s.office_id, name: s.office_name, photoUrl: s.office_photo, badges: ['Official'] } };
  if (s.group_id) return { kind: 'club' as Kind, key: `group:${s.group_id}`,
    author: { type: 'group', id: s.group_id, name: s.group_name, photoUrl: null, badges: s.group_verified ? ['Club'] : [] } };
  return { kind: (s.author_user_id === viewerId ? 'me' : 'user') as Kind, key: `user:${s.author_user_id}`,
    author: { type: 'user', id: s.author_user_id, name: s.author_name, photoUrl: s.author_photo, badges: badgesFor(s.author_roles) } };
}

function storyBody(s: StoryRow) {
  return {
    id: s.id, body: s.body,
    image: s.image_path ? { ...imageUrls(s.image_path), width: s.image_width, height: s.image_height } : null,
    audience: s.audience, createdAt: iso(s.created_at), expiresAt: iso(s.expires_at), seen: s.seen,
    likedByMe: s.liked_by_me,
    ...(s.view_count !== null ? { viewCount: s.view_count } : {}),
    ...(s.like_count !== null ? { likeCount: s.like_count } : {}),
  };
}

/** Builds the stories row: your own, then official accounts, then clubs, then people; unseen first, then newest. */
export function storyRow(rows: StoryRow[], viewerId: string) {
  const byOwner = new Map<string, { kind: Kind; author: ReturnType<typeof owner>['author']; stories: StoryRow[] }>();
  for (const s of rows) {
    const o = owner(s, viewerId);
    const entry = byOwner.get(o.key) ?? { kind: o.kind, author: o.author, stories: [] };
    entry.stories.push(s);
    byOwner.set(o.key, entry);
  }
  const entries = [...byOwner.values()].map((e) => {
    e.stories.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : 1));   // oldest first, like reading
    return { ...e, allSeen: e.stories.every((s) => s.seen), latest: e.stories[e.stories.length - 1]!.created_at.getTime() };
  });
  entries.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(a.allSeen) - Number(b.allSeen) || b.latest - a.latest);
  return entries.map((e) => ({ author: e.author, isMine: e.kind === 'me', allSeen: e.allSeen, stories: e.stories.map(storyBody) }));
}

/**
 * Who manages a story: its author, the current members of its office, or its club's admins.
 * Admins may also delete any story on their campus. $1 viewer, $2 campus, $3 story.
 */
const MANAGES = `
  select s.id, s.author_user_id = $1
         or (s.author_office_id is not null and exists (
               select 1 from office_members om where om.office_id = s.author_office_id and om.user_id = $1
                  and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())))
         or (s.author_group_id is not null and exists (
               select 1 from group_members gm where gm.group_id = s.author_group_id and gm.user_id = $1
                  and gm.status = 'active' and gm.role = 'admin')) as manages,
         exists (select 1 from roles r where r.user_id = $1 and r.role = 'admin'
                  and r.starts_at <= clock_timestamp() and (r.ends_at is null or r.ends_at > clock_timestamp())) as is_admin
    from stories s
   where s.id = $3 and s.campus_id = $2 and s.deleted_at is null`;

const userParam = z.object({ userId: uuid });

/**
 * Stories (v0.2; docs/api-contract.md section 13).
 *   GET    /api/stories                 the stories row
 *   POST   /api/stories                 { body?, imageId?, audience?, officeId? | groupId? }
 *   POST   /api/stories/:id/view        mark as seen (idempotent)
 *   PUT    /api/stories/:id/like        like it (idempotent; not your own)
 *   DELETE /api/stories/:id/like        unlike it (idempotent)
 *   GET    /api/stories/:id/viewers     who saw it (whoever manages the story)
 *   DELETE /api/stories/:id             the author, the office/club managing it, or an admin
 *   GET|PUT|DELETE /api/me/close-friends[/:userId]
 *   GET|PUT|DELETE /api/me/story-hidden[/:userId]
 */
export async function storyRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);
  const notFound = (reply: FastifyReply) => fail(reply, 404, 'not_found', 'Story not found.');

  app.get('/api/stories', async (req) => {
    const { rows } = await db.query<StoryRow>(
      `${STORY_SELECT} where ${visibleStory('s', V)} order by s.created_at desc limit ${ROW_LIMIT}`,
      [req.auth!.userId, req.auth!.campusId],
    );
    return { items: storyRow(rows, req.auth!.userId) };
  });

  app.post('/api/stories', async (req, reply) => {
    const body = parse(z.object({
      body: z.string().transform((s) => s.trim()).pipe(z.string().min(1, 'cannot be empty').max(500)).optional(),
      imageId: z.string().uuid().optional(),
      audience: z.enum(['followers', 'close_friends']).default('followers'),
      officeId: z.string().uuid().optional(),
      groupId: z.string().uuid().optional(),
    }).strict()
      .refine((b) => b.body !== undefined || b.imageId !== undefined, { message: 'add a photo or some text' })
      .refine((b) => !(b.officeId && b.groupId), { message: 'post as an office or a club, not both' })
      .refine((b) => b.audience === 'followers' || (!b.officeId && !b.groupId), { message: 'audience: close friends is for personal stories' }),
    req.body, reply);
    if (!body) return;
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;

    type Outcome = { ok: true; id: string } | { ok: false; status: number; error: string; message: string } | { ok: false; wait: number };
    const outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
      if (body.officeId) {
        const { rows } = await tx.query(
          `select 1 from office_members om join office_accounts o on o.id = om.office_id
            where om.office_id = $3 and om.user_id = $1 and o.campus_id = $2 and o.verified
              and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())`,
          [viewer.userId, viewer.campusId, body.officeId]);
        if (rows.length === 0) return { ok: false, status: 403, error: 'forbidden', message: 'Only members of a verified office post its stories.' };
      }
      if (body.groupId) {
        const { rows } = await tx.query(
          `select 1 from groups g join group_members m on m.group_id = g.id and m.user_id = $1
            where g.id = $3 and g.kind = 'club' and ${visibleGroup('g', V)} and m.status = 'active' and m.role = 'admin'`,
          [viewer.userId, viewer.campusId, body.groupId]);
        if (rows.length === 0) return { ok: false, status: 403, error: 'forbidden', message: 'Only a club’s admins post its stories.' };
      }
      const wait = await takeRateLimits(tx, [{ bucket: 'story_user', key: viewer.userId, max: STORIES_PER_DAY, windowSeconds: 86_400 }]);
      if (wait) return { ok: false, wait };
      let imageId: string | null = null;
      if (body.imageId) {
        const image = await attachImage(tx, body.imageId, viewer.userId);
        if (!image) return { ok: false, status: 400, error: 'invalid_input', message: 'imageId: upload the photo first, then use the imageId you got back.' };
        imageId = image.id;
      }
      const { rows } = await tx.query<{ id: string }>(
        `insert into stories (campus_id, author_user_id, author_office_id, author_group_id, body, image_id, audience, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, clock_timestamp(), clock_timestamp() + make_interval(hours => $8)) returning id`,
        [viewer.campusId, viewer.userId, body.officeId ?? null, body.groupId ?? null, body.body ?? null, imageId, body.audience, STORY_HOURS]);
      return { ok: true, id: rows[0]!.id };
    });
    if (!outcome.ok) {
      if ('wait' in outcome) {
        reply.header('Retry-After', String(outcome.wait));
        return fail(reply, 429, 'rate_limited', `You have posted a lot of stories today. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
      }
      return fail(reply, outcome.status, outcome.error, outcome.message);
    }
    const { rows } = await db.query<StoryRow>(`${STORY_SELECT} where s.id = $3 and s.campus_id = $2`, [viewer.userId, viewer.campusId, outcome.id]);
    return reply.code(201).send(storyBody(rows[0]!));
  });

  app.post('/api/stories/:id/view', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return notFound(reply);
    const { userId, campusId } = req.auth!;
    const story = (await db.query<{ own: boolean }>(
      `select s.author_user_id = $1 as own from stories s where s.id = $3 and ${visibleStory('s', V)}`,
      [userId, campusId, params.data.id])).rows[0];
    if (!story) return notFound(reply);
    // The author's own views are not counted.
    if (!story.own) {
      await db.query('insert into story_views (story_id, viewer_id) values ($1, $2) on conflict do nothing', [params.data.id, userId]);
    }
    return reply.code(204).send();
  });

  // ---- PUT / DELETE /api/stories/:id/like   a story you can see, not your own; liking also counts as viewing
  for (const liked of [true, false]) {
    app.route({
      method: liked ? 'PUT' : 'DELETE',
      url: '/api/stories/:id/like',
      handler: async (req, reply) => {
        const params = idParam.safeParse(req.params);
        if (!params.success) return notFound(reply);
        const { userId, campusId } = req.auth!;
        const story = (await db.query<{ own: boolean }>(
          `select s.author_user_id = $1 as own from stories s where s.id = $3 and ${visibleStory('s', V)}`,
          [userId, campusId, params.data.id])).rows[0];
        if (!story) return notFound(reply);
        if (story.own) return fail(reply, 400, 'invalid_input', 'You can’t like your own story.');
        if (liked) {
          await db.query('insert into story_views (story_id, viewer_id) values ($1, $2) on conflict do nothing', [params.data.id, userId]);
          await db.query('insert into story_likes (story_id, user_id) values ($1, $2) on conflict do nothing', [params.data.id, userId]);
        } else {
          await db.query('delete from story_likes where story_id = $1 and user_id = $2', [params.data.id, userId]);
        }
        return { liked };
      },
    });
  }

  app.get('/api/stories/:id/viewers', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return notFound(reply);
    const { userId, campusId } = req.auth!;
    const m = (await db.query<{ manages: boolean }>(MANAGES, [userId, campusId, params.data.id])).rows[0];
    if (!m) return notFound(reply);
    if (!m.manages) return fail(reply, 403, 'forbidden', 'Only whoever posted the story sees who viewed it.');
    const { rows } = await db.query<{ id: string; name: string | null; photo_url: string | null; viewed_at: Date; liked: boolean }>(
      `select u.id, u.name, u.photo_url, v.viewed_at,
              exists (select 1 from story_likes sl where sl.story_id = v.story_id and sl.user_id = u.id) as liked
         from story_views v join users u on u.id = v.viewer_id
        where v.story_id = $3 and u.campus_id = $2 and u.deleted_at is null and v.viewer_id <> $1 and ${notBlocked('u.id', V)}
        order by v.viewed_at desc limit 1000`,
      [userId, campusId, params.data.id]);
    // Likers first, then the most recent viewers.
    const items = rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url, viewedAt: iso(r.viewed_at), liked: r.liked }))
      .sort((a, b) => Number(b.liked) - Number(a.liked));
    return { count: rows.length, likeCount: items.filter((i) => i.liked).length, items };
  });

  app.delete('/api/stories/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return notFound(reply);
    const { userId, campusId } = req.auth!;
    const m = (await db.query<{ manages: boolean; is_admin: boolean }>(MANAGES, [userId, campusId, params.data.id])).rows[0];
    if (!m) return notFound(reply);
    if (!m.manages && !m.is_admin) return fail(reply, 403, 'forbidden', 'You can only delete your own stories.');
    await db.query('update stories set deleted_at = clock_timestamp() where id = $1 and deleted_at is null', [params.data.id]);
    // The photo goes now unless the story is reported (kept for moderators, section 6).
    await removeStoryImages(db, config.MEDIA_DIR, `s.id = $1`, [params.data.id]);
    return reply.code(204).send();
  });

  // ---- close friends and "hide my stories from": two lists of other members, same rules
  const lists = [
    { path: '/api/me/close-friends', table: 'close_friends', column: 'friend_id', what: 'close friends' },
    { path: '/api/me/story-hidden', table: 'story_hidden_from', column: 'hidden_user_id', what: 'people your stories are hidden from' },
  ] as const;
  for (const list of lists) {
    app.get(list.path, async (req) => {
      const { rows } = await db.query<{ id: string; name: string | null; photo_url: string | null }>(
        `select u.id, u.name, u.photo_url from ${list.table} l join users u on u.id = l.${list.column}
          where l.user_id = $1 and u.campus_id = $2 and u.deleted_at is null and ${notBlocked('u.id', V)}
          order by u.name, u.id`,
        [req.auth!.userId, req.auth!.campusId]);
      return { items: rows.map((r) => ({ id: r.id, name: r.name, photoUrl: r.photo_url })) };
    });
    app.put(`${list.path}/:userId`, async (req, reply) => {
      const p = userParam.safeParse(req.params);
      if (!p.success) return fail(reply, 404, 'not_found', 'Member not found.');
      const { userId, campusId } = req.auth!;
      if (p.data.userId === userId) return fail(reply, 400, 'invalid_input', 'Choose someone else.');
      const outcome = await inTransaction(db, async (tx) => {
        const ok = await tx.query(`select 1 from users u where u.id = $3 and u.campus_id = $2 and u.deleted_at is null and ${notBlocked('u.id', V)}`,
          [userId, campusId, p.data.userId]);
        if (ok.rows.length === 0) return 'missing' as const;
        await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`${list.table}:${userId}`]);
        const n = (await tx.query<{ n: number }>(`select count(*)::int as n from ${list.table} where user_id = $1`, [userId])).rows[0]!.n;
        const inserted = await tx.query(`insert into ${list.table} (user_id, ${list.column}) select $1, $2 where $3 < ${LIST_LIMIT} on conflict do nothing`,
          [userId, p.data.userId, n]);
        const exists = await tx.query(`select 1 from ${list.table} where user_id = $1 and ${list.column} = $2`, [userId, p.data.userId]);
        return inserted.rowCount || exists.rows.length ? 'ok' as const : 'full' as const;
      });
      if (outcome === 'missing') return fail(reply, 404, 'not_found', 'Member not found.');
      if (outcome === 'full') return fail(reply, 409, 'list_full', `You can have up to ${LIST_LIMIT} ${list.what}.`);
      return reply.code(204).send();
    });
    app.delete(`${list.path}/:userId`, async (req, reply) => {
      const p = userParam.safeParse(req.params);
      if (!p.success) return fail(reply, 404, 'not_found', 'Member not found.');
      await db.query(`delete from ${list.table} where user_id = $1 and ${list.column} = $2`, [req.auth!.userId, p.data.userId]);
      return reply.code(204).send();
    });
  }
}

/**
 * Deletes the photos of stories matching `where` (alias `s`) that are not under an open report,
 * files included. Table and column names are constants; values are bound.
 */
async function removeStoryImages(db: Queryable, mediaDir: string, where: string, params: unknown[]): Promise<void> {
  const { rows } = await db.query<{ image_id: string }>(
    // A story without its photo is over: mark it deleted too (a story must keep a photo or text).
    `update stories s set image_id = null, deleted_at = coalesce(s.deleted_at, clock_timestamp())
       from stories old
      where old.id = s.id and ${where} and s.image_id is not null
        and not exists (select 1 from reports r where r.target_type = 'story' and r.target_id = s.id and r.status = 'open')
      returning old.image_id`, params);
  for (const r of rows) await deleteImage(db, mediaDir, r.image_id);
}

/**
 * Housekeeping (hourly): stories past their 24 hours, or deleted, go for good — row, views and
 * photo — unless a report on them is still open (moderators need them, section 6). Also story
 * rate-limit counts after a day. Returns how many stories were removed.
 */
export async function cleanupStories(db: Queryable, mediaDir: string): Promise<number> {
  const gone = `(s.expires_at <= now() or s.deleted_at is not null)`;
  await removeStoryImages(db, mediaDir, gone, []);
  const { rowCount } = await db.query(
    `delete from stories s
      where ${gone}
        and not exists (select 1 from reports r where r.target_type = 'story' and r.target_id = s.id and r.status = 'open')`);
  await db.query(`delete from rate_limit_events where bucket = 'story_user' and created_at < now() - interval '1 day'`);
  return rowCount ?? 0;
}
