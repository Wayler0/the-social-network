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

/** The day-3 feedback prompt and admins' anonymous list (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);

describe.skipIf(!url)('Feedback (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-feedback-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); await client.query('delete from feedback'); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.14.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  /** Opens the app on a new day: as if the last visit was yesterday. */
  async function newDay(who: string) {
    await client.query(`update users set last_active_on = (now() at time zone 'Africa/Nairobi')::date - 1 where id = $1`, [U(who)]);
    return (await as(who, 'GET', '/api/me')).json();
  }
  const fresh = (who: string) => client.query('update users set active_days = 0, last_active_on = null, feedback_ask_at_day = 3, feedback_given_at = null where id = $1', [U(who)]);

  it('asks on the third day, once a day counts once; "Not now" waits three more days', async () => {
    await fresh('cynthia');
    expect((await as('cynthia', 'GET', '/api/me')).json().askFeedback).toBe(false);   // day 1
    expect((await as('cynthia', 'GET', '/api/me')).json().askFeedback).toBe(false);   // still day 1
    expect((await newDay('cynthia')).askFeedback).toBe(false);                         // day 2
    expect((await newDay('cynthia')).askFeedback).toBe(true);                          // day 3

    expect((await as('cynthia', 'POST', '/api/feedback/later')).statusCode).toBe(204);
    expect((await as('cynthia', 'GET', '/api/me')).json().askFeedback).toBe(false);
    expect((await newDay('cynthia')).askFeedback).toBe(false);
    expect((await newDay('cynthia')).askFeedback).toBe(false);
    expect((await newDay('cynthia')).askFeedback).toBe(true);                          // three days later
  });

  it('sending feedback stops the prompt; bad input is refused', async () => {
    await fresh('brian');
    await client.query('update users set active_days = 5 where id = $1', [U('brian')]);
    expect((await as('brian', 'GET', '/api/me')).json().askFeedback).toBe(true);
    for (const body of [{}, { rating: 0 }, { rating: 6 }, { rating: 4.5 }, { rating: 4, body: 'x'.repeat(2001) }, { rating: 4, extra: 1 }]) {
      expect((await as('brian', 'POST', '/api/feedback', body)).json().error, JSON.stringify(body)).toBe('invalid_input');
    }
    expect((await as('brian', 'POST', '/api/feedback', { rating: 4, body: '  More clubs please  ' })).statusCode).toBe(201);
    expect((await as('brian', 'GET', '/api/me')).json().askFeedback).toBe(false);
    expect((await newDay('brian')).askFeedback).toBe(false);
  });

  it('admins read feedback without names; others get 403; it goes with the account', async () => {
    await as('brian', 'POST', '/api/feedback', { rating: 4, body: 'More clubs please' });
    await as('cynthia', 'POST', '/api/feedback', { rating: 2 });
    // One test transaction = one now(): make Brian's older so 'newest first' has a fixed order.
    await client.query(`update feedback set created_at = created_at - interval '1 minute' where user_id = $1`, [U('brian')]);
    const admin = await client.query<{ user_id: string }>(`select user_id from roles where role = 'admin' limit 1`);
    const adminKey = Object.entries({ hassan: U('hassan'), grace: U('grace') }).find(([, id]) => id === admin.rows[0]?.user_id)?.[0] ?? 'hassan';
    const res = (await as(adminKey, 'GET', '/api/admin/feedback')).json();
    expect(res).toMatchObject({ count: 2, average: 3 });
    expect(res.items.map((i: { rating: number }) => i.rating)).toEqual([2, 4]);
    expect(res.items[1]).toEqual({ id: expect.any(String), rating: 4, body: 'More clubs please', createdAt: expect.any(String) });
    expect(JSON.stringify(res)).not.toMatch(/Brian|Cynthia|seed|@/);
    expect((await as('brian', 'GET', '/api/admin/feedback')).statusCode).toBe(403);

    expect((await as('brian', 'GET', '/api/me/export')).json().feedback).toEqual([expect.objectContaining({ rating: 4 })]);
  });
});
