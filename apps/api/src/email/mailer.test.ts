import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { createMailer, EmailError, maskEmail, signInCodeMessage, type MailLog } from './mailer.js';

const DB = 'postgres://u:p@localhost:5432/test';
/** Production config refuses the built-in development pepper. */
const PEPPER = 'test-pepper-0123456789abcdef0123456789';

function recordingLog() {
  const lines: Array<{ level: string; details: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (details: object, message: string) => { lines.push({ level, details: details as Record<string, unknown>, message }); };
  const log: MailLog = { info: at('info'), warn: at('warn'), error: at('error') };
  return { log, lines, text: () => JSON.stringify(lines) };
}

/** A real SMTP server on a free local port, so the tests exercise the actual wire protocol. */
type Received = { from: string; to: string[]; raw: string };
let server: SMTPServer | undefined;
afterEach(async () => { await new Promise<void>((done) => (server ? server.close(() => done()) : done())); server = undefined; });

async function smtp(opts: { rejectRcpt?: number; failFirst?: number; auth?: { user: string; pass: string } } = {}) {
  const received: Received[] = [];
  let attempts = 0;
  server = new SMTPServer({
    secure: false,
    disabledCommands: opts.auth ? ['STARTTLS'] : ['STARTTLS', 'AUTH'],
    allowInsecureAuth: true,
    onAuth(auth, _session, done) {
      const ok = opts.auth && auth.username === opts.auth.user && auth.password === opts.auth.pass;
      return ok ? done(null, { user: auth.username }) : done(new Error('Invalid username or password'));
    },
    onRcptTo(_address, _session, done) {
      if (opts.rejectRcpt) return done(Object.assign(new Error('No such user here'), { responseCode: opts.rejectRcpt }));
      done();
    },
    onData(stream, session, done) {
      let raw = '';
      stream.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
      stream.on('end', () => {
        attempts++;
        if (opts.failFirst && attempts === 1) return done(Object.assign(new Error('Try again later'), { responseCode: opts.failFirst }));
        received.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '', to: session.envelope.rcptTo.map((r) => r.address), raw });
        done();
      });
    },
  });
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready));
  const port = (server.server.address() as AddressInfo).port;
  const env = {
    NODE_ENV: 'test', DATABASE_URL: DB, EMAIL_MODE: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port),
    SMTP_REQUIRE_TLS: 'false', EMAIL_FROM: 'Hatua <no-reply@example.org>',
    ...(opts.auth ? { SMTP_USER: opts.auth.user, SMTP_PASS: opts.auth.pass } : {}),
  };
  return { received, env, attempts: () => attempts };
}

describe('the sign-in email', () => {
  it('carries the code, the expiry and the warning, and nothing clickable', () => {
    const m = signInCodeMessage('Hatua', '048213');
    expect(m.subject).toBe('048213 is your Hatua sign-in code');
    expect(m.text).toContain('048213');
    expect(m.text).toContain('expires in 10 minutes');
    expect(m.text).toContain('Never share this code');
    expect(m.html).toContain('048 213');
    expect(m.html + m.text).not.toMatch(/https?:|href=|<img|<script/i);
  });

  it('escapes the app name in HTML', () => {
    expect(signInCodeMessage('A<b>&"Co', '123456').html).toContain('A&lt;b&gt;&amp;&quot;Co');
  });

  it('masks addresses for logs', () => {
    expect(maskEmail('amina.w@student.example.ac.ke')).toBe('a***@student.example.ac.ke');
    expect(maskEmail('nonsense')).toBe('***');
  });
});

describe('log mode (development)', () => {
  it('prints the code instead of sending', async () => {
    const { log, lines } = recordingLog();
    const mailer = createMailer(loadConfig({ NODE_ENV: 'development', DATABASE_URL: DB }), log);
    await mailer.sendSignInCode('amina@student.example.ac.ke', '482913');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.details).toEqual({ to: 'amina@student.example.ac.ke', code: '482913' });
    expect((await mailer.check()).ok).toBe(true);
  });

  it('in production: refuses, reports itself broken, and never writes the code to the log', async () => {
    const { log, text } = recordingLog();
    const mailer = createMailer(loadConfig({ NODE_ENV: 'production', DATABASE_URL: DB, CODE_PEPPER: PEPPER }), log);
    await expect(mailer.sendSignInCode('amina@student.example.ac.ke', '482913')).rejects.toMatchObject({ temporary: true });
    expect(text()).not.toContain('482913');
    expect(text()).not.toContain('amina@');
    expect((await mailer.check()).ok).toBe(false);
  });
});

describe('smtp mode', () => {
  it('delivers a correct message to a real SMTP server', async () => {
    const { received, env } = await smtp();
    const { log, text } = recordingLog();
    const mailer = createMailer(loadConfig(env), log);
    expect(await mailer.check()).toMatchObject({ ok: true });
    await mailer.sendSignInCode('amina@student.example.ac.ke', '482913');
    await mailer.close();

    expect(received).toHaveLength(1);
    const mail = received[0]!;
    expect(mail.from).toBe('no-reply@example.org');
    expect(mail.to).toEqual(['amina@student.example.ac.ke']);
    expect(mail.raw).toMatch(/^From: Hatua <no-reply@example\.org>\r?$/m);
    expect(mail.raw).toMatch(/^To: amina@student\.example\.ac\.ke\r?$/m);
    expect(mail.raw).toMatch(/^Subject: 482913 is your Hatua sign-in code\r?$/m);
    expect(mail.raw).toMatch(/^Auto-Submitted: auto-generated\r?$/m);
    expect(mail.raw).toMatch(/^Message-ID: <[^>]+@example\.org>\r?$/m);
    expect(mail.raw).toMatch(/^Date: /m);
    expect(mail.raw).toContain('multipart/alternative');
    expect(mail.raw).toContain('    482913');
    // The log records that it was sent, but neither the code nor the full address.
    expect(text()).not.toContain('482913');
    expect(text()).not.toContain('amina@');
    expect(text()).toContain('a***@student.example.ac.ke');
  });

  it('logs in when a username and password are set, and reports a wrong password clearly', async () => {
    const good = await smtp({ auth: { user: 'hatua', pass: 'right' } });
    const mailer = createMailer(loadConfig(good.env), recordingLog().log);
    await mailer.sendSignInCode('amina@student.example.ac.ke', '111111');
    await mailer.close();
    expect(good.received).toHaveLength(1);

    const wrong = createMailer(loadConfig({ ...good.env, SMTP_PASS: 'wrong' }), recordingLog().log, { retryDelayMs: 1 });
    expect(await wrong.check()).toMatchObject({ ok: false });
    await expect(wrong.sendSignInCode('amina@student.example.ac.ke', '111111')).rejects.toMatchObject({ temporary: false });
    await wrong.close();
  });

  it('tries once more after a temporary failure, and then succeeds', async () => {
    const { received, env, attempts } = await smtp({ failFirst: 451 });
    const { log, lines } = recordingLog();
    const mailer = createMailer(loadConfig(env), log, { retryDelayMs: 1 });
    await mailer.sendSignInCode('amina@student.example.ac.ke', '222222');
    await mailer.close();
    expect(attempts()).toBe(2);
    expect(received).toHaveLength(1);
    expect(lines.map((l) => l.level)).toEqual(['warn', 'info']);
  });

  it('does not retry a final refusal, and says it is not temporary', async () => {
    const { received, env } = await smtp({ rejectRcpt: 550 });
    const mailer = createMailer(loadConfig(env), recordingLog().log, { retryDelayMs: 1 });
    const err = await mailer.sendSignInCode('nobody@student.example.ac.ke', '333333').catch((e) => e);
    await mailer.close();
    expect(err).toBeInstanceOf(EmailError);
    expect(err.temporary).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('reports an unreachable mail server as temporary, after two attempts', async () => {
    const { env } = await smtp();
    await new Promise<void>((done) => server!.close(() => done())); server = undefined; // nothing is listening now
    const { log, lines } = recordingLog();
    const mailer = createMailer(loadConfig(env), log, { retryDelayMs: 1 });
    await expect(mailer.sendSignInCode('amina@student.example.ac.ke', '444444')).rejects.toMatchObject({ temporary: true });
    expect(await mailer.check()).toMatchObject({ ok: false });
    await mailer.close();
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('refuses to send over an unencrypted connection unless that is switched off', async () => {
    const { received, env } = await smtp(); // this test server offers no TLS
    const mailer = createMailer(loadConfig({ ...env, SMTP_REQUIRE_TLS: 'true' }), recordingLog().log, { retryDelayMs: 1 });
    await expect(mailer.sendSignInCode('amina@student.example.ac.ke', '555555')).rejects.toBeInstanceOf(EmailError);
    await mailer.close();
    expect(received).toHaveLength(0);
  });

  it('rejects anything that is not one plain address and a six-digit code, before touching the network', async () => {
    const { received, env } = await smtp();
    const mailer = createMailer(loadConfig(env), recordingLog().log);
    for (const bad of [
      'a@x.org, b@y.org', 'a@x.org\r\nBcc: spy@evil.org', 'Name <a@x.org>', 'a@x.org b@y.org', 'not-an-address', '', `${'a'.repeat(250)}@x.org`,
    ]) {
      await expect(mailer.sendSignInCode(bad, '123456'), bad).rejects.toMatchObject({ temporary: false });
    }
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) {
      await expect(mailer.sendSignInCode('a@x.org', bad), bad).rejects.toMatchObject({ temporary: false });
    }
    await mailer.close();
    expect(received).toHaveLength(0);
  });
});

/** A stand-in for Resend's HTTPS API on a free local port. `answers` are replied in order (the last repeats). */
type ResendCall = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> };
let resendServer: Server | undefined;
afterEach(async () => { await new Promise<void>((done) => (resendServer ? resendServer.close(() => done()) : done())); resendServer = undefined; });

async function fakeResend(answers: Array<{ status: number; body: object }>) {
  const calls: ResendCall[] = [];
  resendServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      calls.push({ method: req.method!, path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : {} });
      const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
      res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((ready) => resendServer!.listen(0, '127.0.0.1', ready));
  const url = `http://127.0.0.1:${(resendServer.address() as AddressInfo).port}`;
  const env = { NODE_ENV: 'test', DATABASE_URL: DB, EMAIL_MODE: 'resend', RESEND_API_KEY: 're_test_0123456789', EMAIL_FROM: 'Hatua <no-reply@example.org>' };
  return { calls, url, env };
}

describe('resend mode (HTTPS API)', () => {
  it('sends a correct message with the key, and logs neither the code nor the address', async () => {
    const { calls, url, env } = await fakeResend([{ status: 200, body: { id: 'msg_1' } }]);
    const { log, text } = recordingLog();
    const mailer = createMailer(loadConfig(env), log, { resendApiUrl: url });
    await mailer.sendSignInCode('amina@student.example.ac.ke', '482913');

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call).toMatchObject({ method: 'POST', path: '/emails' });
    expect(call.headers.authorization).toBe('Bearer re_test_0123456789');
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.body).toMatchObject({
      from: 'Hatua <no-reply@example.org>',
      to: ['amina@student.example.ac.ke'],
      subject: '482913 is your Hatua sign-in code',
      headers: { 'Auto-Submitted': 'auto-generated' },
    });
    expect(call.body.text).toContain('    482913');
    expect(call.body.html).toContain('482 913');
    expect(text()).not.toContain('482913');
    expect(text()).not.toContain('amina@');
    expect(text()).toContain('msg_1');
  });

  it('retries once after 429 or 5xx with the same idempotency key', async () => {
    const { calls, url, env } = await fakeResend([{ status: 503, body: { name: 'internal_server_error' } }, { status: 200, body: { id: 'msg_2' } }]);
    const { log, lines } = recordingLog();
    const mailer = createMailer(loadConfig(env), log, { resendApiUrl: url, retryDelayMs: 1 });
    await mailer.sendSignInCode('amina@student.example.ac.ke', '222222');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(lines.map((l) => l.level)).toEqual(['warn', 'info']);
  });

  it('does not retry a refusal (bad key, unverified domain), and says it is not temporary', async () => {
    const { calls, url, env } = await fakeResend([{ status: 403, body: { name: 'validation_error', message: 'The example.org domain is not verified' } }]);
    const { log, text } = recordingLog();
    const mailer = createMailer(loadConfig(env), log, { resendApiUrl: url, retryDelayMs: 1 });
    await expect(mailer.sendSignInCode('amina@student.example.ac.ke', '333333')).rejects.toMatchObject({ temporary: false });
    expect(calls).toHaveLength(1);
    expect(text()).toContain('domain is not verified');
  });

  it('reports an unreachable API as temporary, after two attempts', async () => {
    const { url, env } = await fakeResend([{ status: 200, body: {} }]);
    await new Promise<void>((done) => resendServer!.close(() => done())); resendServer = undefined;
    const { log, lines } = recordingLog();
    const mailer = createMailer(loadConfig(env), log, { resendApiUrl: url, retryDelayMs: 1 });
    await expect(mailer.sendSignInCode('amina@student.example.ac.ke', '444444')).rejects.toMatchObject({ temporary: true });
    expect(await mailer.check()).toMatchObject({ ok: false });
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });

  it('check(): a sending-only key counts as working; an invalid key does not', async () => {
    const restricted = await fakeResend([{ status: 401, body: { name: 'restricted_api_key', message: 'This API key is restricted to only send emails' } }]);
    expect(await createMailer(loadConfig(restricted.env), recordingLog().log, { resendApiUrl: restricted.url }).check()).toMatchObject({ ok: true });
    expect(restricted.calls[0]).toMatchObject({ method: 'GET', path: '/domains' });
    await new Promise<void>((done) => resendServer!.close(() => done())); resendServer = undefined;

    const invalid = await fakeResend([{ status: 400, body: { name: 'validation_error', message: 'API key is invalid' } }]);
    const result = await createMailer(loadConfig(invalid.env), recordingLog().log, { resendApiUrl: invalid.url }).check();
    expect(result).toMatchObject({ ok: false });
    expect(result.detail).toContain('API key is invalid');
  });

  it('rejects bad input before touching the network', async () => {
    const { calls, url, env } = await fakeResend([{ status: 200, body: {} }]);
    const mailer = createMailer(loadConfig(env), recordingLog().log, { resendApiUrl: url });
    await expect(mailer.sendSignInCode('a@x.org\r\nBcc: spy@evil.org', '123456')).rejects.toMatchObject({ temporary: false });
    await expect(mailer.sendSignInCode('a@x.org', '12345')).rejects.toMatchObject({ temporary: false });
    expect(calls).toHaveLength(0);
  });
});

describe('email settings', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: DB, CODE_PEPPER: PEPPER };
  it('defaults to log mode, and treats empty values (as Docker Compose passes them) as not set', () => {
    const c = loadConfig({ ...base, EMAIL_MODE: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', EMAIL_FROM: '', SMTP_SECURE: '', SMTP_REQUIRE_TLS: '' });
    expect(c).toMatchObject({ EMAIL_MODE: 'log', SMTP_PORT: 587, SMTP_SECURE: false, SMTP_REQUIRE_TLS: true });
    expect(c.SMTP_HOST).toBeUndefined();
  });
  it('fails fast on an incomplete or wrong smtp setup', () => {
    expect(() => loadConfig({ ...base, EMAIL_MODE: 'smtp' })).toThrow(/SMTP_HOST.*EMAIL_FROM/);
    expect(() => loadConfig({ ...base, EMAIL_MODE: 'smtp', SMTP_HOST: 'mail.example.org', EMAIL_FROM: 'Hatua' })).toThrow(/EMAIL_FROM/);
    expect(() => loadConfig({ ...base, EMAIL_MODE: 'smtp', SMTP_HOST: 'mail.example.org', EMAIL_FROM: 'a@x.org', SMTP_USER: 'u' })).toThrow(/SMTP_PASS/);
    expect(() => loadConfig({ ...base, SMTP_SECURE: 'yes' })).toThrow(/SMTP_SECURE/);
  });
  it('accepts a complete smtp setup', () => {
    const c = loadConfig({ ...base, EMAIL_MODE: 'smtp', SMTP_HOST: 'mail.example.org', SMTP_PORT: '465', SMTP_SECURE: 'true', EMAIL_FROM: 'Hatua <no-reply@example.org>', SMTP_USER: 'u', SMTP_PASS: 'p' });
    expect(c).toMatchObject({ EMAIL_MODE: 'smtp', SMTP_PORT: 465, SMTP_SECURE: true });
  });
  it('needs a Resend key and a sender for resend mode', () => {
    expect(() => loadConfig({ ...base, EMAIL_MODE: 'resend' })).toThrow(/RESEND_API_KEY.*EMAIL_FROM/);
    expect(() => loadConfig({ ...base, EMAIL_MODE: 'resend', EMAIL_FROM: 'a@x.org', RESEND_API_KEY: 'not-a-key' })).toThrow(/RESEND_API_KEY/);
    expect(loadConfig({ ...base, EMAIL_MODE: 'resend', EMAIL_FROM: 'a@x.org', RESEND_API_KEY: 're_abc123def456' })).toMatchObject({ EMAIL_MODE: 'resend' });
  });
});
