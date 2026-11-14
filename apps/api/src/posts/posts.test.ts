import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';
import { seed, seedId } from '../seed.js';

/**
 * Feed, posts, comments and likes against a real PostgreSQL with the development seed data
 * (npm run test:db -w apps/api). Each test seeds inside one transaction and rolls it back.
 */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);
const G = (key: string) => seedId(`group:${key}`);
const O = (key: string) => seedId(`office:${key}`);

describe.skipIf(!url)('feed, posts, comments and likes (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  let campusId: string;
  const tokens = new Map<string, string>();

  function rollbackPool(): Db {
    const tx = {
      query: (sql: string, params?: unknown[]) => {
        if (sql === 'begin') return client.query('savepoint api_tx');
        if (sql === 'commit') return client.query('release savepoint api_tx');
        if (sql === 'rollback') return client.query('rollback to savepoint api_tx');
        return client.query(sql, params);
      },
      release: () => {},
    };
    return { query: (sql: string, params?: unknown[]) => client.query(sql, params), connect: async () => tx } as unknown as Db;
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-posts-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool());
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => {
    await client.query('begin');
    await seed(client, { mediaDir });
    campusId = (await client.query('select campus_id from users where id = $1', [U('cynthia')])).rows[0].campus_id;
    tokens.clear();
  });
  afterEach(async () => { await client.query('rollback'); });

  /** Requests as a seed member (signed in with a real session cookie), or as nobody. */
  async function as(who: string | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    let token = who ? tokens.get(who) : undefined;
    if (who && !token) {
      token = await createSession(client, U(who), { userAgent: 'test', ip: '10.8.0.1' });
      tokens.set(who, token);
    }
    return app.inject({ method, url, ...(token ? { cookies: { hatua_session: token } } : {}), ...(payload ? { payload } : {}) });
  }
  async function wholeFeed(who: string) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 10; pages++) {
      const res = await as(who, 'GET', `/api/feed?limit=10${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      ids.push(...body.items.map((p: { id: string }) => p.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    return ids;
  }
  async function uploadedImage(owner: string): Promise<string> {
    const id = randomUUID();
    await client.query(`insert into images (id, user_id, path, width, height, bytes) values ($1, $2, $3, 1080, 1350, 1000)`, [id, U(owner), `2026/11/${id}`]);
    return id;
  }
  const post = (who: string, payload: object) => as(who, 'POST', '/api/posts', payload);

  // ---------------------------------------------------------------- feed
  describe('GET /api/feed', () => {
    it('pages through campus posts newest first, never hidden, deleted or group posts', async () => {
      const ids = await wholeFeed('cynthia');
      expect(new Set(ids).size).toBe(ids.length);                       // no post twice across pages
      const expected = (await client.query<{ id: string }>(
        `select id from posts where campus_id = $1 and group_id is null and hidden_at is null and deleted_at is null
          order by created_at desc, id desc`, [campusId])).rows.map((r) => r.id);
      expect(ids).toEqual(expected);
      expect(ids.length).toBeGreaterThan(20);
      for (const key of ['spam', 'modhide', 'deleted', 'chess1', 'photo2', 'study1']) expect(ids, key).not.toContain(P(key));
    });

    it('shows each post with author badges, office, image, counts and likedByMe', async () => {
      const items = (await as('brian', 'GET', '/api/feed?limit=50')).json().items as Array<Record<string, any>>;
      const photo = items.find((p) => p.id === P('photo'))!;
      expect(photo).toMatchObject({
        author: { id: U('cynthia'), name: expect.any(String), badges: ['Club Leader'] }, office: null, group: null,
        image: { url: expect.stringMatching(/^\/media\/.+\/1080\.webp$/), width: expect.any(Number), height: expect.any(Number) },
        likeCount: expect.any(Number), commentCount: 2, createdAt: expect.stringMatching(/Z$/),
      });
      const likedByBrian = (await client.query('select 1 from likes where post_id = $1 and user_id = $2', [P('photo'), U('brian')])).rows.length === 1;
      expect(photo.likedByMe).toBe(likedByBrian);

      expect(items.find((p) => p.id === P('office'))!.office).toMatchObject({ id: O('council'), name: expect.any(String) });
      expect(items.find((p) => p.id === P('gone'))!.author).toEqual({ id: null, name: 'Deleted member', photoUrl: null, badges: [] });
      expect(JSON.stringify(items)).not.toMatch(/@|memberNumber|email/);
    });

    it('hides posts between members who blocked each other', async () => {
      const made = (await post('cynthia', { body: 'Hello campus' })).json().id;
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('david'), U('cynthia')]);
      expect(await wholeFeed('david')).not.toContain(made);
      expect(await wholeFeed('esther')).toContain(made);
    });

    it('rejects made-up cursors and bad limits; needs a session', async () => {
      for (const q of ['cursor=nonsense', 'limit=0', 'limit=51', 'limit=abc', 'extra=1']) {
        expect((await as('cynthia', 'GET', `/api/feed?${q}`)).json().error, q).toBe('invalid_input');
      }
      expect((await as(null, 'GET', '/api/feed')).statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------- create
  describe('POST /api/posts', () => {
    it('creates a text post at the top of the feed', async () => {
      const res = await post('cynthia', { body: '  Library is open late tonight.  ' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ body: 'Library is open late tonight.', author: { id: U('cynthia') }, likeCount: 0, commentCount: 0, likedByMe: false, image: null });
      expect((await as('amina', 'GET', '/api/feed?limit=1')).json().items[0].id).toBe(res.json().id);
    });

    it('needs a finished profile', async () => {
      const res = await post('newbie', { body: 'hi' });
      expect([res.statusCode, res.json().error]).toEqual([403, 'profile_incomplete']);
    });

    it('rejects empty, too long and unexpected input', async () => {
      for (const body of [{ body: '' }, { body: '   ' }, { body: 'x'.repeat(2001) }, {}, { body: 'hi', authorUserId: U('hassan') }, { body: 'hi', imageId: 'nope' }]) {
        expect((await post('cynthia', body)).json().error, JSON.stringify(body).slice(0, 40)).toBe('invalid_input');
      }
    });

    it('attaches the member\'s own uploaded image, once', async () => {
      const mine = await uploadedImage('cynthia');
      const res = await post('cynthia', { body: 'Sunrise', imageId: mine });
      expect(res.json().image).toEqual({ url: `/media/2026/11/${mine}/1080.webp`, width: 1080, height: 1350 });
      expect((await post('cynthia', { body: 'Again', imageId: mine })).json().error).toBe('invalid_input');
      expect((await post('cynthia', { body: 'Theirs', imageId: await uploadedImage('brian') })).json().error).toBe('invalid_input');
    });

    it('posts in a group only as an active member, and in a club only as an admin', async () => {
      const notMember = await post('cynthia', { body: 'Kick-off?', groupId: G('football') });
      expect([notMember.statusCode, notMember.json().error]).toEqual([403, 'forbidden']);
      const member = await post('david', { body: 'Kick-off at 9?', groupId: G('football') });
      expect(member.statusCode).toBe(201);
      expect(member.json().group).toEqual({ id: G('football'), name: expect.any(String) });
      expect(await wholeFeed('david')).not.toContain(member.json().id);          // group posts stay in the group

      expect((await post('amina', { body: 'Me too', groupId: G('chess') })).statusCode).toBe(403);   // club: admins only
      expect((await post('cynthia', { body: 'Round two on Monday', groupId: G('chess') })).statusCode).toBe(201);

      expect((await post('felix', { body: 'x', groupId: G('study') })).statusCode).toBe(404);    // student-only: staff never see it
      expect((await post('cynthia', { body: 'x', groupId: randomUUID() })).statusCode).toBe(404);
    });

    it('posts as an office only for its current members', async () => {
      const res = await post('hassan', { body: 'Nominations close Friday.', officeId: O('council') });
      expect(res.statusCode).toBe(201);
      expect(res.json().office).toMatchObject({ id: O('council') });
      expect((await post('cynthia', { body: 'x', officeId: O('council') })).statusCode).toBe(403);
      await client.query(`update office_members set ends_at = clock_timestamp() where user_id = $1`, [U('hassan')]);
      expect((await post('hassan', { body: 'x', officeId: O('council') })).statusCode).toBe(403);
    });

    it('allows 20 posts per member per hour', async () => {
      await client.query(`insert into rate_limit_events (bucket, key) select 'post_user', $1 from generate_series(1, 20)`, [U('cynthia')]);
      const res = await post('cynthia', { body: 'one too many' });
      expect([res.statusCode, res.json().error]).toEqual([429, 'rate_limited']);
      expect((await post('david', { body: 'fine' })).statusCode).toBe(201);
    });
  });

  // ---------------------------------------------------------------- get and delete
  describe('GET and DELETE /api/posts/:id', () => {
    it('404 for anything the viewer may not see', async () => {
      expect((await as('cynthia', 'GET', `/api/posts/${P('photo')}`)).statusCode).toBe(200);
      for (const [who, key] of [['cynthia', 'spam'], ['cynthia', 'deleted'], ['cynthia', 'photo2'], ['felix', 'study1']] as const) {
        expect((await as(who, 'GET', `/api/posts/${P(key)}`)).statusCode, key).toBe(404);
      }
      expect((await as('cynthia', 'GET', '/api/posts/not-a-uuid')).statusCode).toBe(404);
    });

    it('the author deletes their post, and its image when nobody reported it', async () => {
      const image = await uploadedImage('cynthia');
      const id = (await post('cynthia', { body: 'oops', imageId: image })).json().id;
      expect((await as('cynthia', 'DELETE', `/api/posts/${id}`)).statusCode).toBe(204);
      expect((await as('cynthia', 'GET', `/api/posts/${id}`)).statusCode).toBe(404);
      expect((await client.query('select 1 from images where id = $1', [image])).rows).toHaveLength(0);
      expect((await as('cynthia', 'DELETE', `/api/posts/${id}`)).statusCode).toBe(404);
    });

    it('keeps the image of a deleted post while a report about it is open', async () => {
      const image = await uploadedImage('cynthia');
      const id = (await post('cynthia', { body: 'reported', imageId: image })).json().id;
      await client.query(`insert into reports (campus_id, reporter_id, target_type, target_id, reason) values ($1, $2, 'post', $3, 'nudity')`, [campusId, U('brian'), id]);
      expect((await as('cynthia', 'DELETE', `/api/posts/${id}`)).statusCode).toBe(204);
      expect((await client.query('select 1 from images where id = $1', [image])).rows).toHaveLength(1);
    });

    it('others may not delete it, admins may', async () => {
      const id = (await post('cynthia', { body: 'mine' })).json().id;
      expect([(await as('david', 'DELETE', `/api/posts/${id}`)).statusCode]).toEqual([403]);
      expect((await as('hassan', 'DELETE', `/api/posts/${id}`)).statusCode).toBe(204);
    });

    it('an author can delete their own hidden post; nobody else learns it exists', async () => {
      expect((await as('cynthia', 'DELETE', `/api/posts/${P('modhide')}`)).statusCode).toBe(404);
      await client.query(`update users set suspended_at = null where id = $1`, [U('ivy')]);
      expect((await as('ivy', 'DELETE', `/api/posts/${P('modhide')}`)).statusCode).toBe(204);
    });
  });

  // ---------------------------------------------------------------- comments
  describe('comments', () => {
    it('lists visible comments oldest first, with "Deleted member" and pages', async () => {
      const res = await as('cynthia', 'GET', `/api/posts/${P('photo')}/comments`);
      expect(res.json().items.map((c: { id: string }) => c.id)).toEqual([seedId('comment:1'), seedId('comment:2')]);
      const feed0 = (await as('cynthia', 'GET', `/api/posts/${P('feed:0')}/comments`)).json().items;
      expect(feed0.find((c: { id: string }) => c.id === seedId('comment:4')).author.name).toBe('Deleted member');
      const feed4 = (await as('cynthia', 'GET', `/api/posts/${P('feed:4')}/comments`)).json().items;
      expect(feed4.map((c: { id: string }) => c.id)).not.toContain(seedId('comment:6'));   // hidden

      const first = (await as('cynthia', 'GET', `/api/posts/${P('photo')}/comments?limit=1`)).json();
      expect(first.items).toHaveLength(1);
      const second = (await as('cynthia', 'GET', `/api/posts/${P('photo')}/comments?limit=1&cursor=${first.nextCursor}`)).json();
      expect(second.items[0].id).toBe(seedId('comment:2'));
    });

    it('hides comments between blocked members', async () => {
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('cynthia'), U('esther')]);
      const ids = (await as('cynthia', 'GET', `/api/posts/${P('photo')}/comments`)).json().items.map((c: { id: string }) => c.id);
      expect(ids).toEqual([seedId('comment:1')]);
    });

    it('adds a comment and counts it; 404 on posts the member cannot see', async () => {
      const res = await as('amina', 'POST', `/api/posts/${P('photo')}/comments`, { body: ' Lovely colours ' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ body: 'Lovely colours', author: { id: U('amina') } });
      expect((await as('amina', 'GET', `/api/posts/${P('photo')}`)).json().commentCount).toBe(3);
      expect((await as('cynthia', 'POST', `/api/posts/${P('photo2')}/comments`, { body: 'hi' })).statusCode).toBe(404);
      expect((await as('cynthia', 'POST', `/api/posts/${P('photo')}/comments`, { body: '  ' })).json().error).toBe('invalid_input');
      expect((await as('newbie', 'POST', `/api/posts/${P('photo')}/comments`, { body: 'hi' })).json().error).toBe('profile_incomplete');
    });

    it('the comment\'s author, the post\'s author or an admin may delete a comment', async () => {
      const c = async () => (await as('david', 'POST', `/api/posts/${P('photo')}/comments`, { body: 'hmm' })).json().id;
      const a = await c();
      expect((await as('esther', 'DELETE', `/api/comments/${a}`)).statusCode).toBe(403);
      expect((await as('david', 'DELETE', `/api/comments/${a}`)).statusCode).toBe(204);
      expect((await as('cynthia', 'DELETE', `/api/comments/${await c()}`)).statusCode).toBe(204);   // post author
      expect((await as('hassan', 'DELETE', `/api/comments/${await c()}`)).statusCode).toBe(204);    // admin
      expect((await as('david', 'DELETE', `/api/comments/${a}`)).statusCode).toBe(404);             // already gone
    });
  });

  // ---------------------------------------------------------------- likes
  describe('likes', () => {
    it('like and unlike are idempotent and return the count', async () => {
      const before = (await as('felix', 'GET', `/api/posts/${P('feed:2')}`)).json().likeCount;
      expect((await as('felix', 'PUT', `/api/posts/${P('feed:2')}/like`)).json()).toEqual({ liked: true, likeCount: before + 1 });
      expect((await as('felix', 'PUT', `/api/posts/${P('feed:2')}/like`)).json()).toEqual({ liked: true, likeCount: before + 1 });
      expect((await as('felix', 'GET', `/api/posts/${P('feed:2')}`)).json().likedByMe).toBe(true);
      expect((await as('felix', 'DELETE', `/api/posts/${P('feed:2')}/like`)).json()).toEqual({ liked: false, likeCount: before });
      expect((await as('felix', 'DELETE', `/api/posts/${P('feed:2')}/like`)).json()).toEqual({ liked: false, likeCount: before });
    });

    it('404 when liking a post the member cannot see', async () => {
      expect((await as('cynthia', 'PUT', `/api/posts/${P('spam')}/like`)).statusCode).toBe(404);
      expect((await as('felix', 'PUT', `/api/posts/${P('study1')}/like`)).statusCode).toBe(404);
    });
  });
});
