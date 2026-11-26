import { mkdtemp, rm } from 'node:fs/promises';
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

/** Editing a post (PATCH /api/posts/:id), against the seed data; each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);

describe.skipIf(!url)('Editing posts (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-edit-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'PATCH' | 'DELETE' | 'POST', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.15.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const edits = async (id: string) => (await client.query('select body from post_edits where post_id = $1 order by edited_at', [id])).rows.map((r) => r.body);

  it('the author changes the text; the post says when, and the old text is kept for moderators', async () => {
    const res = await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: '  Sunset from the hostel roof tonight.  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ body: 'Sunset from the hostel roof tonight.', editedAt: expect.any(String) });
    expect((await as('brian', 'GET', `/api/posts/${P('photo')}`)).json()).toMatchObject({ body: 'Sunset from the hostel roof tonight.', editedAt: expect.any(String) });
    expect(await edits(P('photo'))).toEqual(['Sunset from the hostel roof this evening.']);
  });

  it('unchanged text is not an edit; empty text, others and unknown posts are refused', async () => {
    const same = await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: 'Sunset from the hostel roof this evening.' });
    expect(same.json().editedAt).toBeNull();
    expect((await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: '   ' })).statusCode).toBe(400);
    expect((await as('brian', 'PATCH', `/api/posts/${P('photo')}`, { body: 'Hacked' })).statusCode).toBe(403);
    expect((await as('cynthia', 'PATCH', `/api/posts/${seedId('post:nope')}`, { body: 'x' })).statusCode).toBe(404);
    expect((await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: 'x', imageId: null })).statusCode).toBe(400);
  });

  it('hidden posts cannot be edited (no sneaking around moderation)', async () => {
    await client.query('update posts set hidden_at = now() where id = $1', [P('photo')]);
    expect((await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: 'Nothing to see here' })).statusCode).toBe(404);
    expect(await edits(P('photo'))).toEqual([]);
  });

  it('moderators see the earlier text of a reported post', async () => {
    await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: 'Harmless now.' });
    await client.query(`insert into reports (campus_id, reporter_id, target_type, target_id, reason)
      select campus_id, $1, 'post', id, 'harassment' from posts where id = $2`, [U('brian'), P('photo')]);
    const { items } = (await as('hassan', 'GET', '/api/admin/reports')).json() as { items: Array<{ targetId: string; target: Record<string, unknown> }> };
    const item = items.find((i) => i.targetId === P('photo'))!;
    expect(item.target).toMatchObject({ body: 'Harmless now.', earlierVersions: [{ body: 'Sunset from the hostel roof this evening.' }] });
  });

  it('deleting the post deletes earlier versions, unless a report is open', async () => {
    await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: 'Edited once.' });
    expect((await as('cynthia', 'DELETE', `/api/posts/${P('photo')}`)).statusCode).toBe(204);
    expect(await edits(P('photo'))).toEqual([]);
  });

  it('the author’s data export includes edits', async () => {
    await as('cynthia', 'PATCH', `/api/posts/${P('photo')}`, { body: 'Edited for export.' });
    const data = (await as('cynthia', 'GET', '/api/me/export')).json() as { posts: Array<{ id: string; editedAt: string | null; earlierVersions: Array<{ body: string }> }> };
    const p = data.posts.find((x) => x.id === P('photo'))!;
    expect(p.editedAt).toEqual(expect.any(String));
    expect(p.earlierVersions.map((e) => e.body)).toEqual(['Sunset from the hostel roof this evening.']);
  });
});
