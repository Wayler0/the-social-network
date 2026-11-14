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

  /** Keeps every query on the test's connection; the API's transactions become savepoints. */
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
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const domains = (await client.query<{ domain: string; member_type: string }>(
      `select d.domain, d.member_type from campus_email_domains d join campuses c on c.id = d.campus_id
        where c.status = 'active' order by c.created_at`)).rows;
    studentDomain = domains.find((d) => d.member_type === 'student')!.domain;
    staffDomain = domains.find((d) => d.member_type === 'staff')!.domain;
    mail = fakeMailer();
    app = buildApp(config, rollbackPool(), { mailer: mail.mailer });
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
