import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import { seed, seedId } from '../seed.js';
import { rollbackPool } from '../testing/rollback-pool.js';
import { cleanupStories } from './routes.js';

/** Stories against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const O = (key: string) => seedId(`office:${key}`);
const G = (key: string) => seedId(`group:${key}`);

describe.skipIf(!url)('Stories (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-stories-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.13.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const follows = (a: string, b: string) =>
    client.query(`insert into follows (follower_id, target_type, target_id) values ($1, 'user', $2) on conflict do nothing`, [U(a), U(b)]);
  const post = async (who: string, payload: object) => {
    const res = await as(who, 'POST', '/api/stories', { body: 'Hello', ...payload });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  };
  /** Story ids the member sees on their row. */
  const seen = async (who: string) => ((await as(who, 'GET', '/api/stories')).json().items as Array<{ stories: Array<{ id: string }> }>)
    .flatMap((e) => e.stories.map((s) => s.id));

  it('posts a text story that lasts 24 hours; followers see it, others do not', async () => {
    const res = await as('cynthia', 'POST', '/api/stories', { body: '  Exam week, good luck!  ' });
    expect(res.statusCode).toBe(201);
    const story = res.json();
    expect(story).toEqual({ id: expect.any(String), body: 'Exam week, good luck!', image: null, audience: 'followers',
      createdAt: expect.any(String), expiresAt: expect.any(String), seen: false, viewCount: 0 });
    expect(new Date(story.expiresAt).getTime() - new Date(story.createdAt).getTime()).toBe(24 * 3600 * 1000);

    await follows('brian', 'cynthia');
    expect(await seen('brian')).toEqual([story.id]);
    expect(await seen('david')).toEqual([]);              // does not follow
    expect(await seen('cynthia')).toEqual([story.id]);    // your own
  });

  it('rejects empty stories, both pages at once, close friends for pages, and unfinished profiles', async () => {
    for (const payload of [{}, { body: '   ' }, { body: 'x'.repeat(501) }, { body: 'a', officeId: O('dean'), groupId: G('chess') },
      { body: 'a', officeId: O('dean'), audience: 'close_friends' }, { body: 'a', extra: 1 }]) {
      expect((await as('cynthia', 'POST', '/api/stories', payload)).json().error, JSON.stringify(payload)).toBe('invalid_input');
    }
    expect((await as('newbie', 'POST', '/api/stories', { body: 'hi' })).json().error).toBe('profile_incomplete');
  });

  it('an under-18 author is seen only by people they follow back', async () => {
    const id = await post('amina', {});                   // amina is under 18
    await follows('cynthia', 'amina');
    expect(await seen('cynthia')).toEqual([]);
    await follows('amina', 'cynthia');
    expect(await seen('cynthia')).toEqual([id]);
  });

  it('staff see a student\'s story only if the student follows them; alumni are not students', async () => {
    const student = await post('cynthia', {});
    const alumna = await post('esther', {});
    await follows('felix', 'cynthia');
    await follows('felix', 'esther');
    expect(await seen('felix')).toEqual([alumna]);
    await follows('cynthia', 'felix');
    expect((await seen('felix')).sort()).toEqual([student, alumna].sort());
  });

  it('close friends and "hide my stories from"', async () => {
    await follows('brian', 'cynthia');
    await follows('david', 'cynthia');
    const close = await post('cynthia', { audience: 'close_friends' });
    expect(await seen('brian')).toEqual([]);
    expect((await as('cynthia', 'PUT', `/api/me/close-friends/${U('brian')}`)).statusCode).toBe(204);
    expect(await seen('brian')).toEqual([close]);
    expect((await as('cynthia', 'GET', '/api/me/close-friends')).json().items).toEqual([{ id: U('brian'), name: expect.any(String), photoUrl: null }]);

    const open = await post('cynthia', {});
    expect(await seen('david')).toEqual([open]);
    expect((await as('cynthia', 'PUT', `/api/me/story-hidden/${U('david')}`)).statusCode).toBe(204);
    expect(await seen('david')).toEqual([]);
    expect((await as('cynthia', 'DELETE', `/api/me/story-hidden/${U('david')}`)).statusCode).toBe(204);
    expect(await seen('david')).toEqual([open]);

    for (const bad of [U('cynthia'), U('gone'), randomUUID(), 'nope']) {
      expect((await as('cynthia', 'PUT', `/api/me/close-friends/${bad}`)).statusCode, bad).toBeGreaterThanOrEqual(400);
    }
  });

  it('blocks hide stories both ways', async () => {
    await follows('brian', 'cynthia');
    await post('cynthia', {});
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('cynthia'), U('brian')]);
    expect(await seen('brian')).toEqual([]);
  });

  it('office stories reach everyone; only current members of a verified office post them', async () => {
    const id = await post('felix', { officeId: O('dean') });
    for (const who of ['amina', 'brian', 'esther']) expect(await seen(who), who).toEqual([id]);
    expect((await as('brian', 'POST', '/api/stories', { body: 'x', officeId: O('dean') })).statusCode).toBe(403);
    await client.query('update office_accounts set verified = false where id = $1', [O('dean')]);
    expect(await seen('amina')).toEqual([]);
  });

  it('club stories reach members and followers; only club admins post them', async () => {
    const id = await post('cynthia', { groupId: G('chess') });   // cynthia is the chess club admin
    expect(await seen('amina')).toEqual([id]);                    // member
    expect(await seen('brian')).toEqual([]);
    await client.query(`insert into follows (follower_id, target_type, target_id) values ($1, 'group', $2)`, [U('brian'), G('chess')]);
    expect(await seen('brian')).toEqual([id]);                    // follower
    expect((await as('amina', 'POST', '/api/stories', { body: 'x', groupId: G('chess') })).statusCode).toBe(403);   // not an admin
    expect((await as('brian', 'POST', '/api/stories', { body: 'x', groupId: G('football') })).statusCode).toBe(403); // not a club
  });

  it('the row: your own, then official, then clubs, then people; unseen before seen', async () => {
    await follows('amina', 'brian');
    await follows('amina', 'cynthia');
    await follows('brian', 'amina');                 // amina is under 18: her story is for people she follows back
    const brian = await post('brian', {});
    const cynthia = await post('cynthia', {});
    const club = await post('cynthia', { groupId: G('chess') });
    const office = await post('felix', { officeId: O('library') });
    const mine = await post('amina', {});
    await as('amina', 'POST', `/api/stories/${cynthia}/view`);

    const row = (await as('amina', 'GET', '/api/stories')).json().items;
    expect(row.map((e: { author: { type: string; id: string } }) => [e.author.type, e.author.id])).toEqual([
      ['user', U('amina')], ['office', O('library')], ['group', G('chess')], ['user', U('brian')], ['user', U('cynthia')],
    ]);
    expect(row.map((e: { stories: Array<{ id: string }> }) => e.stories[0]!.id)).toEqual([mine, office, club, brian, cynthia]);
    expect(row[0]).toMatchObject({ isMine: true, allSeen: false });
    expect(row[1].author).toMatchObject({ name: 'Library (seed)', badges: ['Official'] });
    expect(row[2].author).toMatchObject({ badges: ['Club'] });
    expect(row[4]).toMatchObject({ allSeen: true, stories: [expect.objectContaining({ seen: true })] });
  });

  it('views: counted once, not your own; only the author sees the viewer list', async () => {
    const id = await post('cynthia', {});
    await follows('brian', 'cynthia');
    await follows('david', 'cynthia');
    for (const who of ['brian', 'brian', 'david', 'cynthia']) expect((await as(who, 'POST', `/api/stories/${id}/view`)).statusCode).toBe(204);
    const viewers = (await as('cynthia', 'GET', `/api/stories/${id}/viewers`)).json();
    expect(viewers.count).toBe(2);
    expect(viewers.items.map((v: { id: string }) => v.id).sort()).toEqual([U('brian'), U('david')].sort());
    expect((await as('cynthia', 'GET', '/api/stories')).json().items[0].stories[0].viewCount).toBe(2);
    expect((await as('brian', 'GET', `/api/stories/${id}/viewers`)).statusCode).toBe(403);
    expect((await as('esther', 'POST', `/api/stories/${id}/view`)).statusCode).toBe(404);   // cannot see it
  });

  it('delete: the author or an admin; others get 403', async () => {
    await follows('brian', 'cynthia');
    const a = await post('cynthia', {});
    expect((await as('brian', 'DELETE', `/api/stories/${a}`)).statusCode).toBe(403);
    expect((await as('cynthia', 'DELETE', `/api/stories/${a}`)).statusCode).toBe(204);
    expect(await seen('brian')).toEqual([]);
    expect((await as('cynthia', 'DELETE', `/api/stories/${a}`)).statusCode).toBe(404);
    const b = await post('cynthia', {});
    expect((await as('hassan', 'DELETE', `/api/stories/${b}`)).statusCode).toBe(204);    // hassan is an admin
  });

  it('reports: three hide a story; moderators see it in the queue', async () => {
    const id = await post('felix', { officeId: O('dean') });
    for (const who of ['amina', 'brian', 'cynthia']) {
      expect((await as(who, 'POST', '/api/reports', { targetType: 'story', targetId: id, reason: 'spam' })).statusCode).toBe(202);
    }
    expect(await seen('esther')).toEqual([]);
    const queue = (await as('grace', 'GET', '/api/admin/reports')).json().items;
    expect(queue.find((r: { targetId: string }) => r.targetId === id)).toMatchObject({ targetType: 'story', target: expect.objectContaining({ autoHidden: true }) });
  });

  it('housekeeping removes expired stories and their photos, but keeps reported ones', async () => {
    const imageId = randomUUID();
    const dir = path.join(mediaDir, '2026', '11', imageId);
    await mkdir(dir, { recursive: true });
    await client.query(`insert into images (id, user_id, path, width, height, bytes) values ($1, $2, $3, 320, 320, 1000)`, [imageId, U('cynthia'), `2026/11/${imageId}`]);
    const photo = (await as('cynthia', 'POST', '/api/stories', { imageId })).json().id;
    const reported = await post('felix', { officeId: O('dean') });
    await as('amina', 'POST', '/api/reports', { targetType: 'story', targetId: reported, reason: 'false_info' });
    const fresh = await post('cynthia', {});
    await client.query(`update stories set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = any($1)`, [[photo, reported]]);

    expect(await cleanupStories(client, mediaDir)).toBe(1);
    const left = (await client.query<{ id: string }>('select id from stories where id = any($1)', [[photo, reported, fresh]])).rows.map((r) => r.id);
    expect(left.sort()).toEqual([reported, fresh].sort());
    expect((await client.query('select 1 from images where id = $1', [imageId])).rows).toHaveLength(0);
    await expect(stat(dir)).rejects.toThrow();
  });

  it('deleting an account ends its stories, views and lists', async () => {
    await follows('brian', 'cynthia');
    await post('cynthia', {});
    const other = await post('david', {});
    await follows('cynthia', 'david');
    await as('cynthia', 'POST', `/api/stories/${other}/view`);
    await as('cynthia', 'PUT', `/api/me/close-friends/${U('brian')}`);
    expect((await as('cynthia', 'DELETE', '/api/me', { confirm: 'DELETE' })).statusCode).toBe(204);
    expect(await seen('brian')).toEqual([]);
    for (const sql of ['select 1 from story_views where viewer_id = $1', 'select 1 from close_friends where user_id = $1',
      'select 1 from stories where author_user_id = $1 and deleted_at is null']) {
      expect((await client.query(sql, [U('cynthia')])).rows, sql).toHaveLength(0);
    }
  });
});
