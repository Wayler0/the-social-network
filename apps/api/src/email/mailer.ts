import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import { senderAddress, type Config } from '../config.js';

/** How long a sign-in code stays valid (docs/api-contract.md section 3). Shown in the email. */
export const CODE_MINUTES = 10;

/**
 * Sends email. Today that is one message: the sign-in code (issue #35).
 * Auth routes get it as `app.mailer` (see docs/email.md).
 */
export interface Mailer {
  /** Sends a 6-digit sign-in code. Throws EmailError if it could not be handed to the mail server. */
  sendSignInCode(to: string, code: string): Promise<void>;
  /** Checks the mail server is reachable and accepts our login. Never throws. */
  check(): Promise<{ ok: boolean; detail: string }>;
  close(): Promise<void>;
}

export class EmailError extends Error {
  /**
   * @param temporary true when trying again later may work (mail server down, busy or timing out):
   *                  answer 503. false means this address or message was refused.
   */
  constructor(message: string, readonly temporary: boolean) {
    super(message);
  }
}

/** The little the mailer needs from a logger (Fastify's logger fits). */
export type MailLog = {
  info: (details: object, message: string) => void;
  warn: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
};

const ONE_ADDRESS = /^[^\s@<>",;:\\()[\]]+@[^\s@<>",;:\\()[\]]+\.[^\s@<>",;:\\()[\]]+$/;
const SIX_DIGITS = /^\d{6}$/;

/** Hides most of an address for logs: email is personal data. "amina.w@x.ac.ke" -> "a***@x.ac.ke". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type Message = { subject: string; text: string; html: string };

/**
 * The sign-in email. Deliberately plain: no links, images or tracking, which is what keeps a
 * one-time-code email out of spam folders and gives members nothing to be phished with.
 */
export function signInCodeMessage(appName: string, code: string): Message {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = [
    `Your ${appName} sign-in code is:`,
    '',
    `    ${code}`,
    '',
    `It works once and expires in ${CODE_MINUTES} minutes.`,
    '',
    `Never share this code. Nobody from ${appName} will ever ask you for it.`,
    'If you did not ask for a code, you can ignore this email.',
    '',
  ].join('\n');
  const name = escapeHtml(appName);
  const html = [
    '<!doctype html>',
    '<html lang="en"><body style="margin:0;padding:24px;background:#f6f5fb;font-family:Arial,Helvetica,sans-serif;color:#111018;">',
    '<div style="max-width:420px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">',
    `<p style="margin:0 0 16px;font-size:16px;">Your ${name} sign-in code is:</p>`,
    `<p style="margin:0 0 16px;font-size:34px;font-weight:bold;letter-spacing:4px;color:#6A3DF5;">${spaced}</p>`,
    `<p style="margin:0 0 16px;font-size:14px;">It works once and expires in ${CODE_MINUTES} minutes.</p>`,
    `<p style="margin:0;font-size:13px;color:#5b5a66;">Never share this code. Nobody from ${name} will ever ask you for it.`,
    ' If you did not ask for a code, you can ignore this email.</p>',
    '</div></body></html>',
  ].join('\n');
  return { subject: `${code} is your ${appName} sign-in code`, text, html };
}

function checkInput(to: string, code: string) {
  // Also blocks header injection: no spaces, line breaks, commas or second address can get through.
  if (to.length > 254 || !ONE_ADDRESS.test(to)) throw new EmailError('That is not a single valid email address.', false);
  if (!SIX_DIGITS.test(code)) throw new EmailError('The sign-in code must be six digits.', false);
}

/** Development: prints the email (and the code) to the console instead of sending it. */
function logMailer(config: Config, log: MailLog): Mailer {
  const production = config.NODE_ENV === 'production';
  return {
    async sendSignInCode(to, code) {
      checkInput(to, code);
      if (production) {
        // A code in a production log is a code anyone with log access can use. Refuse instead.
        log.error({ to: maskEmail(to) }, 'email is not set up: set EMAIL_MODE=smtp (docs/email.md). Nothing was sent.');
        throw new EmailError('Email is not set up on this server.', true);
      }
      log.info({ to, code }, `DEV EMAIL (not sent): ${signInCodeMessage(config.APP_NAME, code).subject}`);
    },
    async check() {
      return production
        ? { ok: false, detail: 'EMAIL_MODE=log in production: no email can be sent' }
        : { ok: true, detail: 'emails are printed to the console (development)' };
    },
    async close() {},
  };
}

/** Headers that stop "out of office" and other automatic replies to the code email. */
const NO_AUTO_REPLIES = { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** SMTP reply codes 4xx and network failures are worth one more try; 5xx is a final "no". */
function isTemporary(err: unknown): boolean {
  const e = err as { responseCode?: number; code?: string };
  if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  return e.code !== 'EENVELOPE' && e.code !== 'EAUTH';
}

function smtpMailer(config: Config, log: MailLog, retryDelayMs: number): Mailer {
  const from = config.EMAIL_FROM!;
  const transport: Transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    requireTLS: config.SMTP_REQUIRE_TLS && !config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    tls: { minVersion: 'TLSv1.2' },
    pool: true,
    maxConnections: 2,
    // A member is waiting on the sign-up screen: fail fast rather than hang.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    async sendSignInCode(to, code) {
      checkInput(to, code);
      const message = signInCodeMessage(config.APP_NAME, code);
      const mail = {
        from,
        to,
        ...message,
        headers: NO_AUTO_REPLIES,
      };
      for (let attempt = 1; ; attempt++) {
        try {
          const sent = await transport.sendMail(mail);
          if ((sent.rejected ?? []).length > 0) throw Object.assign(new Error('recipient rejected'), { responseCode: 550 });
          log.info({ to: maskEmail(to), messageId: sent.messageId, attempt }, 'sign-in email handed to the mail server');
          return;
        } catch (err) {
          const temporary = isTemporary(err);
          const reason = (err as Error).message;
          if (temporary && attempt === 1) {
            log.warn({ to: maskEmail(to), reason }, 'sign-in email failed, trying once more');
            await delay(retryDelayMs);
            continue;
          }
          log.error({ to: maskEmail(to), reason, temporary, attempt }, 'sign-in email was not sent');
          throw new EmailError(temporary ? 'The mail server is not responding.' : 'The mail server refused this email.', temporary);
        }
      }
    },
    async check() {
      try {
        await transport.verify();
        return { ok: true, detail: `connected to ${config.SMTP_HOST}:${config.SMTP_PORT} as ${senderAddress(from)}` };
      } catch (err) {
        return { ok: false, detail: `${config.SMTP_HOST}:${config.SMTP_PORT} — ${(err as Error).message}` };
      }
    },
    async close() {
      transport.close();
    },
  };
}

export const RESEND_API_URL = 'https://api.resend.com';

/** Resend's error body: { statusCode, name, message }. */
type ResendError = { statusCode?: number; name?: string; message?: string };

/**
 * Sends through Resend's HTTPS API instead of SMTP. KENET blocks every outgoing mail port
 * (25, 465, 587, 2465, 2587; checked 24 Nov 2026) but not HTTPS, so this is what the server uses.
 * Same rules as smtpMailer: one retry for temporary failures, codes never logged.
 */
function resendMailer(config: Config, log: MailLog, retryDelayMs: number, apiUrl: string): Mailer {
  const from = config.EMAIL_FROM!;
  const auth = { Authorization: `Bearer ${config.RESEND_API_KEY!}` };
  // A member is waiting on the sign-up screen: fail fast rather than hang.
  const timeout = () => AbortSignal.timeout(15_000);

  return {
    async sendSignInCode(to, code) {
      checkInput(to, code);
      const body = JSON.stringify({ from, to: [to], ...signInCodeMessage(config.APP_NAME, code), headers: NO_AUTO_REPLIES });
      // Same key on the retry, so Resend sends at most one email even if the first answer was lost.
      const idempotencyKey = randomUUID();
      for (let attempt = 1; ; attempt++) {
        let temporary: boolean;
        let reason: string;
        try {
          const res = await fetch(`${apiUrl}/emails`, {
            method: 'POST',
            headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
            body,
            signal: timeout(),
          });
          const answer = (await res.json().catch(() => ({}))) as ResendError & { id?: string };
          if (res.ok) {
            log.info({ to: maskEmail(to), messageId: answer.id, attempt }, 'sign-in email handed to the mail server');
            return;
          }
          // 429 = too many requests, 5xx = their side: worth another try. Other 4xx (bad key,
          // unverified sender domain, refused address) will fail the same way again.
          temporary = res.status === 429 || res.status >= 500;
          reason = `${res.status} ${answer.name ?? ''} ${answer.message ?? ''}`.trim();
        } catch (err) {
          temporary = true; // network failure or timeout
          reason = (err as Error).message;
        }
        if (temporary && attempt === 1) {
          log.warn({ to: maskEmail(to), reason }, 'sign-in email failed, trying once more');
          await delay(retryDelayMs);
          continue;
        }
        log.error({ to: maskEmail(to), reason, temporary, attempt }, 'sign-in email was not sent');
        throw new EmailError(temporary ? 'The mail server is not responding.' : 'The mail server refused this email.', temporary);
      }
    },
    async check() {
      // Checks the API is reachable and the key is real without sending anything. A "Sending access"
      // key (the kind we use) may not list domains, and Resend says so with restricted_api_key.
      try {
        const res = await fetch(`${apiUrl}/domains`, { headers: auth, signal: timeout() });
        const answer = (await res.json().catch(() => ({}))) as ResendError;
        if (res.ok || answer.name === 'restricted_api_key') {
          return { ok: true, detail: `connected to ${new URL(apiUrl).host} as ${senderAddress(from)}` };
        }
        return { ok: false, detail: `${new URL(apiUrl).host} — ${res.status} ${answer.name ?? ''} ${answer.message ?? ''}`.trim() };
      } catch (err) {
        return { ok: false, detail: `${new URL(apiUrl).host} — ${(err as Error).message}` };
      }
    },
    async close() {},
  };
}

export function createMailer(config: Config, log: MailLog, opts: { retryDelayMs?: number; resendApiUrl?: string } = {}): Mailer {
  const retryDelayMs = opts.retryDelayMs ?? 1500;
  if (config.EMAIL_MODE === 'smtp') return smtpMailer(config, log, retryDelayMs);
  if (config.EMAIL_MODE === 'resend') return resendMailer(config, log, retryDelayMs, opts.resendApiUrl ?? RESEND_API_URL);
  return logMailer(config, log);
}
