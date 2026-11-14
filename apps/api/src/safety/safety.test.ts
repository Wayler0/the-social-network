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
import { seed, seedId } from '../seed.js';
import { rollbackPool } from '../testing/rollback-pool.js';

/** Report and block against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);
const G = (key: string) => seedId(`group:${key}`);

describe.skipIf(!url)('report and block (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-safety-'));
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
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.9.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const report = (who: string, targetType: string, targetId: string, reason = 'spam', details?: string) =>
    as(who, 'POST', '/api/reports', { targetType, targetId, reason, ...(details ? { details } : {}) });
  const openReports = async (targetId: string) =>
    (await client.query<{ n: number }>(`select count(*)::int as n from reports where target_id = $1 and status = 'open'`, [targetId])).rows[0]!.n;
  const hiddenAt = async (table: string, id: string) => (await client.query(`select hidden_at, hidden_by from ${table} where id = $1`, [id])).rows[0];

  describe('POST /api/reports', () => {
    it('records a report for the moderators', async () => {
      const res = await report('amina', 'post', P('feed:3'), 'harassment', 'Mean about a classmate.');
      expect([res.statusCode, res.json()]).toEqual([202, { received: true }]);
      const row = (await client.query('select reporter_id, reason, details, status, campus_id is not null as campus from reports where target_id = $1 and reporter_id = $2', [P('feed:3'), U('amina')])).rows[0];
      expect(row).toEqual({ reporter_id: U('amina'), reason: 'harassment', details: 'Mean about a classmate.', status: 'open', campus: true });
    });

    it('a second report of the same item by the same member counts once', async () => {
      const before = await openReports(P('feed:3'));
      await report('amina', 'post', P('feed:3'));
      expect((await report('amina', 'post', P('feed:3'), 'hate')).statusCode).toBe(202);
      expect(await openReports(P('feed:3'))).toBe(before + 1);
    });

    it('3 open reports from different members hide the content until a moderator reviews it', async () => {
      const id = P('feed:5');
      await client.query(`delete from reports where target_id = $1`, [id]);
      await report('amina', 'post', id);
      await report('amina', 'post', id);                       // same member again: still one
      await report('brian', 'post', id);
      expect((await hiddenAt('posts', id)).hidden_at).toBeNull();
      await report('david', 'post', id);
      expect(await hiddenAt('posts', id)).toMatchObject({ hidden_at: expect.any(Date), hidden_by: null });
      expect((await as('esther', 'GET', `/api/posts/${id}`)).statusCode).toBe(404);
    });

    it('auto-hides comments, questions and answers too, but never people or groups', async () => {
      const comment = seedId('comment:2');
      const question = seedId('question:hostel');
      for (const [type, id] of [['comment', comment], ['question', question], ['user', U('esther')], ['group', G('football')]] as const) {
        await client.query(`delete from reports where target_id = $1`, [id]);
        for (const who of ['amina', 'brian', 'david']) expect((await report(who, type, id)).statusCode, `${type} by ${who}`).toBe(202);
      }
      expect((await hiddenAt('comments', comment)).hidden_at).not.toBeNull();
      expect((await hiddenAt('questions', question)).hidden_at).not.toBeNull();
      expect(await openReports(U('esther'))).toBe(3);           // waiting for a moderator, nothing hidden
    });

    it('404 for things the reporter cannot see, so reports reveal nothing', async () => {
      for (const [who, type, id] of [
        ['cynthia', 'post', P('photo2')], ['felix', 'post', P('study1')], ['felix', 'group', G('study')],
        ['cynthia', 'post', P('deleted')], ['cynthia', 'post', randomUUID()], ['cynthia', 'user', U('gone')], ['cynthia', 'user', U('cynthia')],
      ] as const) {
        const res = await report(who, type, id);
        expect([res.statusCode, res.json().error], `${who} ${type}`).toEqual([404, 'not_found']);
      }
    });

    it('a member can still report someone they blocked', async () => {
      expect((await report('brian', 'user', U('ivy'), 'harassment')).statusCode).toBe(202);   // brian blocked ivy
    });

    it('rejects bad input and allows 20 reports an hour', async () => {
      for (const body of [{ targetType: 'post', targetId: P('feed:3'), reason: 'boring' }, { targetType: 'reel', targetId: P('feed:3'), reason: 'spam' },
        { targetType: 'post', targetId: 'x', reason: 'spam' }, { targetType: 'post', targetId: P('feed:3'), reason: 'spam', details: 'd'.repeat(2001) }]) {
        expect((await as('amina', 'POST', '/api/reports', body)).json().error).toBe('invalid_input');
      }
      await client.query(`insert into rate_limit_events (bucket, key) select 'report_user', $1 from generate_series(1, 20)`, [U('amina')]);
      expect((await report('amina', 'post', P('feed:7'))).json().error).toBe('rate_limited');
    });
  });

  describe('block', () => {
    it('blocking hides both members from each other, and unblocking restores it', async () => {
      const mine = (await as('esther', 'POST', '/api/posts', { body: 'Alumni meet-up on Friday' })).json().id;
      expect((await as('cynthia', 'PUT', `/api/users/${U('esther')}/block`)).statusCode).toBe(204);
      expect((await as('cynthia', 'PUT', `/api/users/${U('esther')}/block`)).statusCode).toBe(204);     // idempotent
      expect((await as('cynthia', 'GET', `/api/posts/${mine}`)).statusCode).toBe(404);
      expect((await as('esther', 'GET', `/api/users/${U('cynthia')}`)).statusCode).toBe(404);
      expect((await as('cynthia', 'GET', '/api/me/blocks')).json()).toEqual({ items: [{ id: U('esther'), name: expect.any(String) }] });

      expect((await as('cynthia', 'DELETE', `/api/users/${U('esther')}/block`)).statusCode).toBe(204);
      expect((await as('cynthia', 'DELETE', `/api/users/${U('esther')}/block`)).statusCode).toBe(204);
      expect((await as('cynthia', 'GET', `/api/posts/${mine}`)).statusCode).toBe(200);
      expect((await as('cynthia', 'GET', '/api/me/blocks')).json()).toEqual({ items: [] });
    });

    it('cannot block yourself, deleted accounts or made-up ids', async () => {
      expect((await as('cynthia', 'PUT', `/api/users/${U('cynthia')}/block`)).json().error).toBe('invalid_input');
      for (const id of [U('gone'), randomUUID(), 'nope']) expect((await as('cynthia', 'PUT', `/api/users/${id}/block`)).statusCode, id).toBe(404);
    });

    it('lists the seed block', async () => {
      expect((await as('brian', 'GET', '/api/me/blocks')).json().items.map((b: { id: string }) => b.id)).toEqual([U('ivy')]);
    });
  });
});

describe.skipIf(!url)('reports at the same moment (real database)', () => {
  it('three different members reporting at once still hide the post', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    const app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! }), pool);
    const campus = (await pool.query<{ id: string }>(`select id from campuses where status = 'active' order by created_at limit 1`)).rows[0]!.id;
    const ids: string[] = [];
    try {
      await app.ready();
      for (let i = 0; i < 4; i++) {
        ids.push((await pool.query<{ id: string }>(
          `insert into users (campus_id, email, member_type, name) values ($1, $2, 'continuing', 'Race') returning id`,
          [campus, `report-race-${i}-${process.pid}@example.org`])).rows[0]!.id);
      }
      const post = (await pool.query<{ id: string }>(`insert into posts (campus_id, author_user_id, body) values ($1, $2, 'race') returning id`, [campus, ids[0]])).rows[0]!.id;
      const cookies = await Promise.all(ids.slice(1).map((id) => createSession(pool, id, { userAgent: 'test', ip: '10.9.9.9' })));
      await Promise.all(Array.from({ length: 5 }, () => pool.query('select pg_sleep(0.05)')));
      const answers = await Promise.all(cookies.map((token) => app.inject({
        method: 'POST', url: '/api/reports', cookies: { hatua_session: token }, payload: { targetType: 'post', targetId: post, reason: 'spam' } })));
      expect(answers.map((a) => a.statusCode)).toEqual([202, 202, 202]);
      expect((await pool.query('select hidden_at from posts where id = $1', [post])).rows[0].hidden_at).not.toBeNull();
    } finally {
      await pool.query('delete from reports where reporter_id = any($1::uuid[])', [ids]);
      await pool.query('delete from rate_limit_events where key = any($1::text[])', [ids]);
      await pool.query('delete from posts where author_user_id = any($1::uuid[])', [ids]);
      await pool.query('delete from users where id = any($1::uuid[])', [ids]);
      await app.close();
      await pool.end();
    }
  });
});
