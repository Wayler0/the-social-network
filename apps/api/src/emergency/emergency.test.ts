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

/** Emergency button, against the seed data; each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);

describe.skipIf(!url)('Emergency button (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-sos-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.30.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const inbox = async (who: string) => (await client.query('select type from notifications where user_id = $1 and type = $2', [U(who), 'emergency'])).rows.length;

  it('shows the campus numbers to any member', async () => {
    const res = await as('brian', 'GET', '/api/emergency');
    expect(res.statusCode).toBe(200);
    expect(res.json().contacts).toEqual(expect.arrayContaining([{ label: expect.any(String), phone: '999' }]));
  });

  it('alerts moderators, admins and safety-office members, not everyone', async () => {
    const res = await as('brian', 'POST', '/api/emergency', { message: 'Fight outside hostel B' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: expect.any(String), contacts: expect.any(Array) });
    expect(await inbox('hassan')).toBe(1);   // admin
    expect(await inbox('grace')).toBe(1);    // moderator
    expect(await inbox('cynthia')).toBe(0);  // ordinary member
    expect(await inbox('brian')).toBe(0);    // not themselves
  });

  it('alerts current members of safety offices', async () => {
    const { rows } = await client.query<{ office_id: string; user_id: string }>(
      `select m.office_id, m.user_id from office_members m join users u on u.id = m.user_id
        where u.deleted_at is null and not exists (select 1 from roles r where r.user_id = m.user_id and r.role in ('moderator', 'admin')) limit 1`);
    if (!rows[0]) return;
    await client.query('update office_accounts set safety = true where id = $1', [rows[0].office_id]);
    await as('brian', 'POST', '/api/emergency', {});
    expect((await client.query(`select 1 from notifications where user_id = $1 and type = 'emergency'`, [rows[0].user_id])).rows.length).toBe(1);
  });

  it('moderators see who raised it and mark it handled; members cannot', async () => {
    const { id } = (await as('brian', 'POST', '/api/emergency', { message: 'Help' })).json();
    expect((await as('cynthia', 'GET', '/api/admin/emergencies')).statusCode).toBe(403);
    const list = (await as('grace', 'GET', '/api/admin/emergencies')).json();
    expect(list.items[0]).toMatchObject({ id, message: 'Help', status: 'open', member: { id: U('brian') } });
    expect((await as('grace', 'POST', `/api/admin/emergencies/${id}/handled`)).statusCode).toBe(204);
    expect((await as('grace', 'GET', '/api/admin/emergencies?status=handled')).json().items[0]).toMatchObject({ id, status: 'handled' });
    expect((await as('grace', 'POST', `/api/admin/emergencies/${id}/handled`)).statusCode).toBe(404);
  });

  it('limits alerts to 3 an hour, pointing to the numbers', async () => {
    for (let i = 0; i < 3; i++) expect((await as('brian', 'POST', '/api/emergency', {})).statusCode).toBe(201);
    const res = await as('brian', 'POST', '/api/emergency', {});
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toContain('call one of the numbers');
  });
});
