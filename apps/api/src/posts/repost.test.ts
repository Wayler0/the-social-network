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

/** Reposting feed posts, against the seed data; each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);

describe.skipIf(!url)('Reposts (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-repost-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.40.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const repost = (who: string, id: string, body = '') => as(who, 'POST', '/api/posts', { body, repostOf: id });

  it('reposts a feed post with or without a comment; shows the original, counts and notifies', async () => {
    const res = await repost('brian', P('photo'), 'Look at this!');
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ body: 'Look at this!', author: { id: U('brian') },
      repostOf: { available: true, id: P('photo'), author: { id: U('cynthia') }, body: 'Sunset from the hostel roof this evening.', image: { url: expect.any(String) } } });
    expect((await as('esther', 'GET', `/api/posts/${P('photo')}`)).json()).toMatchObject({ repostCount: 1, repostedByMe: false });
    expect((await as('brian', 'GET', `/api/posts/${P('photo')}`)).json()).toMatchObject({ repostedByMe: true });
    expect((await client.query(`select 1 from notifications where user_id = $1 and type = 'repost'`, [U('cynthia')])).rows.length).toBe(1);
    expect((await repost('esther', P('photo'))).statusCode).toBe(201);   // no comment needed
  });

  it('once per person; undo removes it; reposting a repost reposts the original', async () => {
    const first = (await repost('brian', P('photo'))).json();
    expect((await repost('brian', P('photo'))).statusCode).toBe(409);
    const viaRepost = await repost('esther', first.id);
    expect(viaRepost.json().repostOf.id).toBe(P('photo'));
    expect((await as('brian', 'DELETE', `/api/posts/${P('photo')}/repost`)).statusCode).toBe(204);
    expect((await as('brian', 'GET', `/api/posts/${first.id}`)).statusCode).toBe(404);
    expect((await repost('brian', P('photo'))).statusCode).toBe(201);
  });

  it('only campus feed posts the reposter may see; no group posts, no hidden posts', async () => {
    const { rows } = await client.query<{ id: string }>('select id from posts where group_id is not null and deleted_at is null and hidden_at is null limit 1');
    if (rows[0]) expect((await repost('brian', rows[0].id)).statusCode).toBe(404);
    expect((await repost('brian', P('spam'))).statusCode).toBe(404);
    expect((await as('brian', 'POST', '/api/posts', { body: '', repostOf: P('photo'), groupId: seedId('group:chess') })).statusCode).toBe(400);
  });

  it('the original disappears for people who can no longer see it', async () => {
    const r = (await repost('brian', P('photo'))).json();
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('esther'), U('cynthia')]);
    expect((await as('esther', 'GET', `/api/posts/${r.id}`)).json().repostOf).toEqual({ available: false });
    await client.query('update posts set deleted_at = now() where id = $1', [P('photo')]);
    expect((await as('david', 'GET', `/api/posts/${r.id}`)).json().repostOf).toEqual({ available: false });
  });
});
