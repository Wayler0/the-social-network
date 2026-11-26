import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import type { Mailer } from '../email/mailer.js';
import { rollbackPool } from '../testing/rollback-pool.js';

/**
 * Alumni keep access: link a personal email while the campus email works, then sign in with it.
 * Against a real database (npm run test:db -w apps/api); each test rolled back.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Personal email for signing in after graduating (real database)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let studentDomain: string;
  const sent: Array<{ to: string; code: string }> = [];
  const mailer: Mailer = { async sendSignInCode(to, code) { sent.push({ to, code }); }, async check() { return { ok: true, detail: 'fake' }; }, async close() {} };
  let userId: string;
  let token: string;
  const ip = { n: 0 };

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    studentDomain = (await client.query<{ domain: string }>(
      `select d.domain from campus_email_domains d join campuses c on c.id = d.campus_id where c.status = 'active' and d.member_type = 'student' limit 1`)).rows[0]!.domain;
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! }), rollbackPool(client), { mailer });
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); });
  beforeEach(async () => {
    await client.query('begin');
    sent.length = 0;
    const campus = (await client.query<{ campus_id: string }>('select campus_id from campus_email_domains where domain = $1', [studentDomain])).rows[0]!.campus_id;
    userId = (await client.query<{ id: string }>(
      `insert into users (campus_id, email, member_type, verified, verified_method, name, course, year_of_study)
       values ($1, $2, 'continuing', true, 'email_code', 'Final Year', 'BSc Test', 4) returning id`,
      [campus, `final.year.pe@${studentDomain}`])).rows[0]!.id;
    token = await createSession(client, userId, { userAgent: 'test', ip: '10.20.0.1' });
  });
  afterEach(async () => { await client.query('rollback'); });

  const me = (method: 'GET' | 'POST' | 'DELETE', path: string, payload?: object) =>
    app.inject({ method, url: path, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  const ask = (email: string, personal?: boolean) =>
    app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email, ...(personal === undefined ? {} : { personal }) }, remoteAddress: `10.21.0.${++ip.n}` });
  const verify = (email: string, code: string) =>
    app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code }, remoteAddress: `10.22.0.${++ip.n}` });
  async function link(email: string) {
    expect((await me('POST', '/api/me/personal-email', { email })).statusCode).toBe(200);
    const code = sent.find((m) => m.to === email)!.code;
    return me('POST', '/api/me/personal-email/verify', { code });
  }

  it('links a personal email only after its code is entered; shown to the member only', async () => {
    expect((await me('GET', '/api/me')).json().personalEmail).toBeNull();
    expect((await me('POST', '/api/me/personal-email', { email: 'Final.Year@Example.org' })).statusCode).toBe(200);
    expect((await client.query('select personal_email from users where id = $1', [userId])).rows[0].personal_email).toBeNull();
    expect((await me('POST', '/api/me/personal-email/verify', { code: '000000' })).statusCode).toBe(400);
    const code = sent.find((m) => m.to === 'final.year@example.org')!.code;
    const ok = await me('POST', '/api/me/personal-email/verify', { code });
    expect([ok.statusCode, ok.json()]).toEqual([200, { personalEmail: 'final.year@example.org' }]);
    expect((await me('GET', '/api/me')).json().personalEmail).toBe('final.year@example.org');
  });

  it('refuses campus addresses and addresses linked to someone else', async () => {
    expect((await me('POST', '/api/me/personal-email', { email: `other@${studentDomain}` })).statusCode).toBe(400);
    await client.query(
      `insert into users (campus_id, email, member_type, verified, verified_method, personal_email)
       select campus_id, $2, 'alumni', true, 'email_code', 'taken@example.org' from users where id = $1`, [userId, `someone.else.pe@${studentDomain}`]);
    expect((await me('POST', '/api/me/personal-email', { email: 'taken@example.org' })).statusCode).toBe(409);
  });

  it('after graduating: signs in with the linked email (even once the campus email is gone)', async () => {
    await link('alum@example.org');
    await client.query(`update users set member_type = 'alumni', graduation_year = 2026, year_of_study = null where id = $1`, [userId]);
    const res = await ask('alum@example.org', true);
    expect([res.statusCode, res.json()]).toEqual([200, { resendAfterSeconds: 30 }]);
    const code = sent.filter((m) => m.to === 'alum@example.org').at(-1)!.code;
    const signedIn = await verify('alum@example.org', code);
    expect([signedIn.statusCode, signedIn.json()]).toEqual([200, { newUser: false }]);
    const cookie = signedIn.cookies.find((c) => c.name === 'hatua_session')!.value;
    const who = await app.inject({ method: 'GET', url: '/api/me', cookies: { hatua_session: cookie } });
    expect(who.json().id).toBe(userId);
  });

  it('an unlinked personal email gets the same answer but no email and no account', async () => {
    const res = await ask('stranger@example.org', true);
    expect([res.statusCode, res.json()]).toEqual([200, { resendAfterSeconds: 30 }]);
    expect(sent).toEqual([]);
    expect((await verify('stranger@example.org', '123456')).statusCode).toBe(400);
    expect((await client.query(`select count(*)::int as n from users where email = 'stranger@example.org' or personal_email = 'stranger@example.org'`)).rows[0].n).toBe(0);
  });

  it('without the personal flag, other domains are still refused (typos in the campus email)', async () => {
    await link('alum2@example.org');
    expect((await ask('alum2@example.org')).statusCode).toBe(400);
  });

  it('unlinking stops it working; deleting the account removes it', async () => {
    await link('gone@example.org');
    expect((await me('DELETE', '/api/me/personal-email')).statusCode).toBe(204);
    sent.length = 0;
    await ask('gone@example.org', true);
    expect(sent).toEqual([]);
    await link('again@example.org');
    expect((await me('DELETE', '/api/me', { confirm: 'DELETE' })).statusCode).toBe(204);
    expect((await client.query('select personal_email from users where id = $1', [userId])).rows[0].personal_email).toBeNull();
  });
});
