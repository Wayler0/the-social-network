import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig, DEV_CODE_PEPPER } from '../config.js';
import type { Db } from '../db.js';
import { EmailError, type Mailer } from '../email/mailer.js';
import { hashCode, newCode, normaliseEmail } from './codes.js';
import { waitText } from './rate-limit.js';

describe('codes and emails', () => {
  it('makes 6-digit codes, zero-padded', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
  it('hashes with the pepper, email and code, so none of them can be swapped', () => {
    const h = hashCode('p'.repeat(32), 'a@x.example', '123456');
    expect(h).toHaveLength(32);
    expect(h.equals(hashCode('p'.repeat(32), 'a@x.example', '123456'))).toBe(true);
    expect(h.equals(hashCode('q'.repeat(32), 'a@x.example', '123456'))).toBe(false);
    expect(h.equals(hashCode('p'.repeat(32), 'b@x.example', '123456'))).toBe(false);
    expect(h.equals(hashCode('p'.repeat(32), 'a@x.example', '123457'))).toBe(false);
  });
  it('trims, lower-cases and splits emails; refuses anything unusual', () => {
    expect(normaliseEmail('  Abc.123@Student.Example.AC.KE ')).toEqual({ email: 'abc.123@student.example.ac.ke', domain: 'student.example.ac.ke' });
    for (const bad of ['', 'x', '@a.example', 'a@', 'a@b@c.example', 'a b@c.example', 'a@c', 'a@-.', '"a"@c.example', `${'a'.repeat(65)}@c.example`]) {
      expect(normaliseEmail(bad), bad).toBeNull();
    }
  });
  it('says waits in words', () => {
    expect([waitText(1), waitText(25), waitText(60), waitText(61), waitText(3599)]).toEqual(['1 second', '25 seconds', '1 minute', '2 minutes', '60 minutes']);
  });
});

describe('CODE_PEPPER config', () => {
  const DB = 'postgres://u:p@localhost:5432/test';
  it('has a development default, refused in production', () => {
    expect(loadConfig({ NODE_ENV: 'development', DATABASE_URL: DB }).CODE_PEPPER).toBe(DEV_CODE_PEPPER);
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB })).toThrow(/CODE_PEPPER/);
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB, CODE_PEPPER: '' })).toThrow(/CODE_PEPPER/);
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB, CODE_PEPPER: 'short' })).toThrow(/32/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB, CODE_PEPPER: 'x'.repeat(32) }).CODE_PEPPER).toBe('x'.repeat(32));
  });
  it('checks the cookie name', () => {
    expect(loadConfig({ DATABASE_URL: DB }).SESSION_COOKIE).toBe('hatua_session');
    expect(() => loadConfig({ DATABASE_URL: DB, SESSION_COOKIE: 'a b;c' })).toThrow(/SESSION_COOKIE/);
  });
});

/** Records sent codes instead of emailing them; can be told to fail. */
function fakeMailer() {
  const sent: Array<{ to: string; code: string }> = [];
  let failWith: Error | null = null;
  const mailer: Mailer = {
    async sendSignInCode(to, code) {
      if (failWith) throw failWith;
      sent.push({ to, code });
    },
    async check() { return { ok: true, detail: 'fake' }; },
    async close() {},
  };
  return { mailer, sent, failNext: (err: Error | null) => { failWith = err; } };
}

/** Keeps every query on one test connection; the API's own transactions become savepoints. */
function rollbackPool(client: pg.Client): Db {
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

/**
 * Against a real PostgreSQL with the migrations applied (npm run test:db -w apps/api).
 * Each test runs in one transaction that is rolled back.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('POST /api/auth/request-code (real database)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mail: ReturnType<typeof fakeMailer>;
  let studentDomain: string;
  let staffDomain: string;
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url ?? 'postgres://x@y/z' });

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const domains = (await client.query<{ domain: string; member_type: string }>(
      `select d.domain, d.member_type from campus_email_domains d join campuses c on c.id = d.campus_id
        where c.status = 'active' order by c.created_at`)).rows;
    studentDomain = domains.find((d) => d.member_type === 'student')!.domain;
    staffDomain = domains.find((d) => d.member_type === 'staff')!.domain;
    mail = fakeMailer();
    app = buildApp(config, rollbackPool(client), { mailer: mail.mailer });
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); });
  beforeEach(async () => { await client.query('begin'); mail.sent.length = 0; mail.failNext(null); });
  afterEach(async () => { await client.query('rollback'); });

  const ask = (email: unknown, ip = '10.0.0.1', extra: object = {}) =>
    app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email, ...extra }, remoteAddress: ip });
  const codesFor = async (email: string) => (await client.query<{ code_hash: Buffer; consumed_at: Date | null; minutes: number; request_ip: string }>(
    `select code_hash, consumed_at, request_ip, round(extract(epoch from expires_at - created_at) / 60)::int as minutes
       from auth_codes where email = $1 order by created_at, consumed_at nulls last`, [email])).rows;
  /** Moves this key's rate-limit events back in time, as if that many seconds had passed. */
  const passes = async (seconds: number, key: string) =>
    client.query(`update rate_limit_events set created_at = created_at - make_interval(secs => $1) where key = $2`, [seconds, key]);

  it('sends a code to a student or staff campus email and stores only its hash', async () => {
    for (const email of [`amina.test@${studentDomain}`, `dr.test@${staffDomain}`]) {
      const res = await ask(email);
      expect([res.statusCode, res.json()]).toEqual([200, { resendAfterSeconds: 30 }]);
      const sent = mail.sent.find((m) => m.to === email)!;
      expect(sent.code).toMatch(/^\d{6}$/);
      const [row] = await codesFor(email);
      expect(row!.code_hash.equals(hashCode(config.CODE_PEPPER, email, sent.code))).toBe(true);
      expect(row!.code_hash.toString('utf8')).not.toContain(sent.code);
      expect(row!.minutes).toBe(10);
      expect(row!.request_ip).toBe('10.0.0.1');
    }
  });

  it('trims and lower-cases the email', async () => {
    const res = await ask(`  Mixed.Case@${studentDomain.toUpperCase()} `);
    expect(res.statusCode).toBe(200);
    expect(mail.sent[0]!.to).toBe(`mixed.case@${studentDomain}`);
  });

  it('refuses other domains and look-alikes, sending nothing', async () => {
    for (const email of ['me@gmail.com', `me@${studentDomain}.evil.com`, `me@fake${staffDomain}`, `me@x${studentDomain}`]) {
      const res = await ask(email);
      expect([res.statusCode, res.json().error], email).toEqual([400, 'email_not_allowed']);
    }
    expect((await ask(`me@${staffDomain}.`)).json().error).toBe('invalid_input');   // trailing dot: not a plain address
    expect((await ask('me@gmail.com')).json()).toEqual({ error: 'email_not_allowed', message: 'Use your campus email address.' });
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses domains of a campus that is not open yet', async () => {
    await client.query(`with c as (insert into campuses (slug, name, status) values ('soon-test', 'Soon', 'coming_soon') returning id)
                        insert into campus_email_domains (campus_id, domain, member_type) select id, 'soon.example', 'student' from c`);
    expect((await ask('a@soon.example')).json().error).toBe('email_not_allowed');
  });

  it('rejects bad input in the contract\'s shape', async () => {
    for (const res of [await ask(42), await ask('not-an-email'), await ask(`a@${studentDomain}`, '10.0.0.1', { admin: true }),
      await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: 'nonsense', headers: { 'content-type': 'application/json' } })]) {
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'invalid_input', message: expect.any(String) });
    }
  });

  it('answers a member and a stranger exactly the same way', async () => {
    const member = (await client.query<{ email: string }>(`select email from users where email like $1 and deleted_at is null limit 1`, [`%@${studentDomain}`])).rows[0];
    const existing = member?.email ?? `seedless@${studentDomain}`;
    const a = await ask(existing, '10.0.0.2');
    const b = await ask(`nobody.here@${studentDomain}`, '10.0.0.3');
    expect([a.statusCode, a.body]).toEqual([b.statusCode, b.body]);
  });

  it('allows one code per email per 30 seconds, says how long to wait, and keeps the first code', async () => {
    const email = `wait.test@${studentDomain}`;
    expect((await ask(email)).statusCode).toBe(200);
    const again = await ask(email, '10.0.0.9');
    expect(again.statusCode).toBe(429);
    const body = again.json();
    expect(body.error).toBe('rate_limited');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(again.headers['retry-after']).toBe(String(body.retryAfterSeconds));
    expect(mail.sent).toHaveLength(1);
    expect((await codesFor(email)).filter((c) => !c.consumed_at)).toHaveLength(1);
  });

  it('a new code replaces the old one', async () => {
    const email = `replace.test@${studentDomain}`;
    await ask(email);
    await passes(31, email);
    expect((await ask(email)).statusCode).toBe(200);
    const rows = await codesFor(email);
    expect(rows).toHaveLength(2);
    expect(rows.filter((c) => !c.consumed_at)).toHaveLength(1);
    const live = rows.find((c) => !c.consumed_at)!;
    expect(live.code_hash.equals(hashCode(config.CODE_PEPPER, email, mail.sent[1]!.code))).toBe(true);
  });

  it('allows 5 codes per email per hour', async () => {
    const email = `hour.test@${studentDomain}`;
    for (let i = 0; i < 5; i++) {
      expect((await ask(email)).statusCode, `code ${i + 1}`).toBe(200);
      await passes(31, email);
    }
    const sixth = await ask(email);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().retryAfterSeconds).toBeGreaterThan(30 * 60);   // the first of the five leaves the window in ~57 minutes
    expect(sixth.json().message).toMatch(/minutes/);
    await passes(3600, email);
    expect((await ask(email)).statusCode).toBe(200);
  });

  it('allows 20 codes per IP address per hour, whatever the emails', async () => {
    for (let i = 0; i < 20; i++) expect((await ask(`ip${i}@${studentDomain}`, '10.9.9.9')).statusCode).toBe(200);
    expect((await ask(`ip20@${studentDomain}`, '10.9.9.9')).statusCode).toBe(429);
    expect((await ask(`ip20@${studentDomain}`, '10.9.9.8')).statusCode).toBe(200);    // another address is not affected
  });

  it('a refused request does not count against the limits', async () => {
    const email = `refused.test@${studentDomain}`;
    await ask(email);
    for (let i = 0; i < 10; i++) await ask(email);                                  // all 429
    await passes(31, email);
    expect((await ask(email)).statusCode).toBe(200);
  });

  it('when the email cannot be sent: 503, and the code is removed so it can never be used', async () => {
    const email = `mailfail.test@${studentDomain}`;
    mail.failNext(new EmailError('The mail server is not responding.', true));
    const res = await ask(email);
    expect([res.statusCode, res.json().error]).toEqual([503, 'email_unavailable']);
    expect(await codesFor(email)).toHaveLength(0);
  });

  it('an unexpected failure is a plain 500 with no details', async () => {
    mail.failNext(new Error('secret internal detail'));
    const res = await ask(`boom.test@${studentDomain}`);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal', message: 'Something went wrong. Please try again.' });
  });
});

describe.skipIf(!url)('request-code at the same moment (real database)', () => {
  it('five requests for one email at once send exactly one code', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 6 });
    const mail = fakeMailer();
    const app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! }), pool, { mailer: mail.mailer });
    const domain = (await pool.query<{ domain: string }>(
      `select d.domain from campus_email_domains d join campuses c on c.id = d.campus_id where c.status = 'active' limit 1`)).rows[0]!.domain;
    const email = `race.${process.pid}@${domain}`;
    try {
      await app.ready();
      await Promise.all(Array.from({ length: 6 }, () => pool.query('select pg_sleep(0.05)')));   // open the connections first
      const answers = await Promise.all(Array.from({ length: 5 }, (_, i) =>
        app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email }, remoteAddress: `10.1.1.${i}` })));
      expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 429, 429, 429, 429]);
      expect(mail.sent).toHaveLength(1);
    } finally {
      await pool.query('delete from auth_codes where email = $1', [email]);
      await pool.query('delete from rate_limit_events where key = $1 or key like $2', [email, '10.1.1.%']);
      await app.close();
      await pool.end();
    }
  });
});

describe.skipIf(!url)('POST /api/auth/verify-code (real database)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let devApp: FastifyInstance;
  let mail: ReturnType<typeof fakeMailer>;
  let studentDomain: string;
  let staffDomain: string;
  let campusId: string;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const domains = (await client.query<{ domain: string; member_type: string; campus_id: string }>(
      `select d.domain, d.member_type, d.campus_id from campus_email_domains d join campuses c on c.id = d.campus_id
        where c.status = 'active' order by c.created_at`)).rows;
    studentDomain = domains.find((d) => d.member_type === 'student')!.domain;
    staffDomain = domains.find((d) => d.member_type === 'staff')!.domain;
    campusId = domains[0]!.campus_id;
    mail = fakeMailer();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! }), rollbackPool(client), { mailer: mail.mailer });
    devApp = buildApp(loadConfig({ NODE_ENV: 'development', DATABASE_URL: url! }), rollbackPool(client), { mailer: mail.mailer });
    await Promise.all([app.ready(), devApp.ready()]);
  });
  afterAll(async () => { await app.close(); await devApp.close(); await client.end(); });
  beforeEach(async () => { await client.query('begin'); mail.sent.length = 0; mail.failNext(null); });
  afterEach(async () => { await client.query('rollback'); });

  /** Asks for a code and returns it, as if read from the email. */
  async function codeFor(email: string): Promise<string> {
    await client.query('delete from rate_limit_events where key = $1', [email]);   // let tests ask again at once
    const res = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email }, remoteAddress: '10.2.0.1' });
    expect(res.statusCode).toBe(200);
    return mail.sent.at(-1)!.code;
  }
  const verify = (email: string, code: string, ip = '10.3.0.1', on = app) =>
    on.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code }, remoteAddress: ip, headers: { 'user-agent': 'TestPhone/1.0' } });
  const wrongCode = (code: string) => (code === '000000' ? '000001' : '000000');
  const user = async (email: string) => (await client.query(
    'select id, campus_id, member_type, verified, verified_method from users where email = $1', [email])).rows[0];
  const sessionsOf = async (userId: string) => (await client.query<{ token_hash: Buffer; user_agent: string; ip: string; days: number }>(
    `select token_hash, user_agent, ip, round(extract(epoch from expires_at - created_at) / 86400)::int as days
       from sessions where user_id = $1`, [userId])).rows;
  const expectCodeWrong = (res: Awaited<ReturnType<typeof verify>>) => {
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'code_wrong', message: 'That code is wrong or has expired.' });
    expect(res.cookies).toHaveLength(0);
  };

  it('signs up a new student: creates the account and a session, sets a safe cookie', async () => {
    const email = `new.student@${studentDomain}`;
    const res = await verify(email, await codeFor(email));
    expect([res.statusCode, res.json()]).toEqual([200, { newUser: true }]);

    const u = await user(email);
    expect(u).toMatchObject({ campus_id: campusId, member_type: 'continuing', verified: true, verified_method: 'email_code' });

    const cookie = res.cookies.find((c) => c.name === 'hatua_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 2_592_000 });
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);                       // 32 random bytes

    const [s] = await sessionsOf(u.id);
    expect(s!.token_hash.equals(createHash('sha256').update(cookie.value).digest())).toBe(true);
    expect(s!.token_hash.toString('base64url')).not.toBe(cookie.value);      // the token itself is never stored
    expect(s).toMatchObject({ user_agent: 'TestPhone/1.0', ip: '10.3.0.1', days: 30 });
  });

  it('staff emails make staff accounts', async () => {
    const email = `new.lecturer@${staffDomain}`;
    expect((await verify(email, await codeFor(email))).json()).toEqual({ newUser: true });
    expect((await user(email)).member_type).toBe('staff');
  });

  it('signs in an existing member: no second account, a second session', async () => {
    const email = `twice@${studentDomain}`;
    await verify(email, await codeFor(email));
    const res = await verify(email, await codeFor(email));
    expect([res.statusCode, res.json()]).toEqual([200, { newUser: false }]);
    expect((await client.query('select count(*)::int as n from users where email = $1', [email])).rows[0].n).toBe(1);
    expect(await sessionsOf((await user(email)).id)).toHaveLength(2);
  });

  it('accepts the email in any case and with spaces, like request-code', async () => {
    const email = `case.test@${studentDomain}`;
    const code = await codeFor(email);
    expect((await verify(`  CASE.Test@${studentDomain.toUpperCase()} `, ` ${code} `)).statusCode).toBe(200);
  });

  it('a wrong code counts an attempt; the right code still works before the fifth', async () => {
    const email = `typo@${studentDomain}`;
    const code = await codeFor(email);
    for (let i = 0; i < 4; i++) expectCodeWrong(await verify(email, wrongCode(code)));
    expect((await client.query('select attempts from auth_codes where email = $1 and consumed_at is null', [email])).rows[0].attempts).toBe(4);
    expect((await verify(email, code)).statusCode).toBe(200);
  });

  it('after 5 wrong tries the code is dead, even the right one', async () => {
    const email = `guesser@${studentDomain}`;
    const code = await codeFor(email);
    for (let i = 0; i < 5; i++) expectCodeWrong(await verify(email, wrongCode(code)));
    expectCodeWrong(await verify(email, code));
    expect(await user(email)).toBeUndefined();
  });

  it('a code works once', async () => {
    const email = `once@${studentDomain}`;
    const code = await codeFor(email);
    expect((await verify(email, code)).statusCode).toBe(200);
    expectCodeWrong(await verify(email, code));
  });

  it('an expired code fails', async () => {
    const email = `late@${studentDomain}`;
    const code = await codeFor(email);
    await client.query(`update auth_codes set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes' where email = $1`, [email]);
    expectCodeWrong(await verify(email, code));
  });

  it('only the newest code works', async () => {
    const email = `newest@${studentDomain}`;
    const first = await codeFor(email);
    const second = await codeFor(email);
    if (first !== second) expectCodeWrong(await verify(email, first));
    expect((await verify(email, second)).statusCode).toBe(200);
  });

  it('a code only works for the email it was sent to', async () => {
    const code = await codeFor(`owner@${studentDomain}`);
    expectCodeWrong(await verify(`thief@${studentDomain}`, code));
  });

  it('nonsense and non-campus emails get the same code_wrong answer; malformed bodies get invalid_input', async () => {
    for (const [email, code] of [[`x@${studentDomain}`, '12345'], [`x@${studentDomain}`, 'abcdef'], ['x@gmail.com', '123456'], ['nope', '123456']]) {
      expectCodeWrong(await verify(email!, code!));
    }
    const bad = await app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email: 'a@b.example', code: '123456', newUser: true } });
    expect([bad.statusCode, bad.json().error]).toEqual([400, 'invalid_input']);
  });

  it('a deleted account\'s email signs up as a new member; the old account stays deleted', async () => {
    const email = `returning@${studentDomain}`;
    await verify(email, await codeFor(email));
    const old = (await user(email)).id;
    await client.query(`update users set email = null, deleted_at = now() where id = $1`, [old]);
    const res = await verify(email, await codeFor(email));
    expect(res.json()).toEqual({ newUser: true });
    expect((await user(email)).id).not.toBe(old);
    expect((await client.query('select deleted_at from users where id = $1', [old])).rows[0].deleted_at).not.toBeNull();
  });

  it('a suspended member gets 403 suspended and no session; it ends when the suspension does', async () => {
    const email = `suspended@${studentDomain}`;
    await verify(email, await codeFor(email));
    const id = (await user(email)).id;
    await client.query('delete from sessions where user_id = $1', [id]);
    await client.query(`update users set suspended_at = now(), suspended_until = now() + interval '7 days' where id = $1`, [id]);
    const res = await verify(email, await codeFor(email));
    expect([res.statusCode, res.json().error]).toEqual([403, 'suspended']);
    expect(res.cookies).toHaveLength(0);
    expect(await sessionsOf(id)).toHaveLength(0);

    await client.query(`update users set suspended_until = now() - interval '1 second' where id = $1`, [id]);
    expect((await verify(email, await codeFor(email))).statusCode).toBe(200);
  });

  it('allows 10 tries per IP address per 10 minutes', async () => {
    const email = `ip.limit@${studentDomain}`;
    const code = await codeFor(email);
    for (let i = 0; i < 10; i++) await verify(`someone${i}@${studentDomain}`, '123456', '10.4.0.1');
    const blocked = await verify(email, code, '10.4.0.1');
    expect([blocked.statusCode, blocked.json().error]).toEqual([429, 'rate_limited']);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await verify(email, code, '10.4.0.2')).statusCode).toBe(200);    // the code was not used up
  });

  it('the cookie is not Secure only in local development (http://localhost)', async () => {
    const email = `dev.cookie@${studentDomain}`;
    const res = await verify(email, await codeFor(email), '10.3.0.1', devApp);
    const cookie = res.cookies.find((c) => c.name === 'hatua_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBeFalsy();
  });
});

describe.skipIf(!url)('verify-code at the same moment (real database)', () => {
  it('the same right code sent twice at once signs in once', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 4 });
    const mail = fakeMailer();
    const app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url! }), pool, { mailer: mail.mailer });
    const domain = (await pool.query<{ domain: string }>(
      `select d.domain from campus_email_domains d join campuses c on c.id = d.campus_id where c.status = 'active' and d.member_type = 'student' limit 1`)).rows[0]!.domain;
    const email = `verify.race.${process.pid}@${domain}`;
    try {
      await app.ready();
      await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { email }, remoteAddress: '10.5.0.1' });
      const code = mail.sent[0]!.code;
      await Promise.all(Array.from({ length: 4 }, () => pool.query('select pg_sleep(0.05)')));
      const answers = await Promise.all([1, 2].map((i) =>
        app.inject({ method: 'POST', url: '/api/auth/verify-code', payload: { email, code }, remoteAddress: `10.5.1.${i}` })));
      expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 400]);
      expect((await pool.query('select count(*)::int as n from users where email = $1', [email])).rows[0].n).toBe(1);
    } finally {
      await pool.query('delete from users where email = $1', [email]);       // sessions go with it
      await pool.query('delete from auth_codes where email = $1', [email]);
      await pool.query(`delete from rate_limit_events where key = $1 or key like '10.5.%'`, [email]);
      await app.close();
      await pool.end();
    }
  });
});
