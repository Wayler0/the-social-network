import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { CODE_MINUTES, EmailError } from '../email/mailer.js';
import { fail, parse, useContractErrors } from '../http.js';
import type { Queryable } from '../images/store.js';
import { findCampusDomain, hashCode, newCode, normaliseEmail, sameHash } from './codes.js';
import { takeRateLimits, waitText } from './rate-limit.js';
import { clearSessionCookie, createSession, setSessionCookie } from './sessions.js';

/** Seconds before the web app offers "Resend code"; the same as the per-email limit below. */
export const RESEND_SECONDS = 30;

/**
 * Sign-in and sign-up, one flow (docs/api-contract.md section 3, issues #17–#19):
 *   POST /api/auth/request-code   { email }         -> { resendAfterSeconds }
 *   POST /api/auth/verify-code    { email, code }   -> { newUser } + session cookie
 *   POST /api/auth/logout                             -> 204, this session ends
 *   POST /api/auth/logout-all                         -> 204, every session of this member ends
 */
export async function authRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);

  app.post('/api/auth/request-code', { config: { public: true } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().max(320) }).strict(), req.body, reply);
    if (!body) return;
    const parsed = normaliseEmail(body.email);
    if (!parsed) return fail(reply, 400, 'invalid_input', 'That doesn’t look like an email address.');
    const campus = await findCampusDomain(db, parsed.domain);
    if (!campus) return fail(reply, 400, 'email_not_allowed', 'Use your campus email address.');
    const { email } = parsed;

    // The same answer whether or not this email has an account: nothing here reveals who is a member.
    const code = newCode();
    const outcome = await inTransaction(db, async (tx) => {
      const wait = await takeRateLimits(tx, [
        { bucket: 'code_email', key: email, max: 1, windowSeconds: RESEND_SECONDS },
        { bucket: 'code_email', key: email, max: 5, windowSeconds: 3600 },
        { bucket: 'code_ip', key: req.ip, max: 20, windowSeconds: 3600 },
      ]);
      if (wait) return { ok: false as const, wait };
      // A new code replaces any older unused one.
      await tx.query(
        `update auth_codes set consumed_at = clock_timestamp()
          where email = $1 and purpose = 'sign_in' and consumed_at is null`,
        [email],
      );
      const { rows } = await tx.query<{ id: string }>(
        `insert into auth_codes (email, code_hash, purpose, expires_at, request_ip)
         values ($1, $2, 'sign_in', clock_timestamp() + make_interval(mins => $3), $4) returning id`,
        [email, hashCode(config.CODE_PEPPER, email, code), CODE_MINUTES, req.ip],
      );
      return { ok: true as const, id: rows[0]!.id };
    });

    if (!outcome.ok) {
      reply.header('Retry-After', String(outcome.wait));
      return fail(reply, 429, 'rate_limited', `Too many codes asked for. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
    }

    try {
      await app.mailer.sendSignInCode(email, code);
    } catch (err) {
      // A code that never arrived must not be usable.
      await db.query('delete from auth_codes where id = $1', [outcome.id]);
      if (err instanceof EmailError) {
        return fail(reply, 503, 'email_unavailable', 'We couldn’t send your code. Please try again in a few minutes.');
      }
      throw err;
    }
    return { resendAfterSeconds: RESEND_SECONDS };
  });

  app.post('/api/auth/verify-code', { config: { public: true } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().max(320), code: z.string().max(20) }).strict(), req.body, reply);
    if (!body) return;

    // Every attempt counts, right or wrong, before anything else is looked at.
    const wait = await inTransaction(db, (tx) =>
      takeRateLimits(tx, [{ bucket: 'verify_ip', key: req.ip, max: 10, windowSeconds: 600 }]));
    if (wait) {
      reply.header('Retry-After', String(wait));
      return fail(reply, 429, 'rate_limited', `Too many tries. Try again in ${waitText(wait)}.`, { retryAfterSeconds: wait });
    }

    // One message for every way a code can fail (wrong, expired, used, too many tries): no help for guessing.
    const codeWrong = () => fail(reply, 400, 'code_wrong', 'That code is wrong or has expired.');
    const parsed = normaliseEmail(body.email);
    const code = body.code.trim();
    if (!parsed || !/^\d{6}$/.test(code)) return codeWrong();
    const campus = await findCampusDomain(db, parsed.domain);
    if (!campus) return codeWrong();
    const { email } = parsed;

    const outcome = await inTransaction(db, async (tx) => {
      // Locked, so the same code tried twice at once cannot be used twice.
      const found = await tx.query<{ id: string; code_hash: Buffer; attempts: number }>(
        `select id, code_hash, attempts from auth_codes
          where email = $1 and purpose = 'sign_in' and consumed_at is null
            and expires_at > clock_timestamp() and attempts < 5
          order by created_at desc limit 1
          for update`,
        [email],
      );
      const row = found.rows[0];
      if (!row) return { result: 'wrong' as const };
      if (!sameHash(row.code_hash, hashCode(config.CODE_PEPPER, email, code))) {
        await tx.query('update auth_codes set attempts = attempts + 1 where id = $1', [row.id]);  // dead at 5
        return { result: 'wrong' as const };
      }
      await tx.query('update auth_codes set consumed_at = clock_timestamp() where id = $1', [row.id]);

      // A deleted account has no email, so its old address signs up as a new member.
      const existing = await tx.query<{ id: string; suspended: boolean }>(
        `select id, (suspended_at is not null and (suspended_until is null or suspended_until > clock_timestamp())) as suspended
           from users where email = $1 and deleted_at is null`,
        [email],
      );
      let user = existing.rows[0];
      let newUser = false;
      if (!user) {
        const made = await tx.query<{ id: string }>(
          `insert into users (campus_id, email, member_type, verified, verified_method)
           values ($1, $2, $3, true, 'email_code') returning id`,
          // Students choose fresher, continuing or alumni during onboarding (PATCH /api/me).
          [campus.campusId, email, campus.memberType === 'staff' ? 'staff' : 'continuing'],
        );
        user = { id: made.rows[0]!.id, suspended: false };
        newUser = true;
      }
      if (user.suspended) return { result: 'suspended' as const };

      const token = await createSession(tx, user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
      return { result: 'ok' as const, token, newUser };
    });

    if (outcome.result === 'wrong') return codeWrong();
    if (outcome.result === 'suspended') return fail(reply, 403, 'suspended', 'This account is suspended. Contact the moderators if you think this is a mistake.');
    setSessionCookie(reply, config, outcome.token);
    return { newUser: outcome.newUser };
  });

  // Suspended members may still sign out.
  app.post('/api/auth/logout', { config: { allowSuspended: true } }, async (req, reply) => {
    await db.query('update sessions set revoked_at = clock_timestamp() where id = $1 and revoked_at is null', [req.auth!.sessionId]);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  app.post('/api/auth/logout-all', { config: { allowSuspended: true } }, async (req, reply) => {
    await db.query('update sessions set revoked_at = clock_timestamp() where user_id = $1 and revoked_at is null', [req.auth!.userId]);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });
}

/** Housekeeping (hourly): old sign-in codes, their rate-limit counts, and sessions ended over 30 days ago. Returns rows removed. */
export async function cleanupAuth(db: Queryable): Promise<number> {
  const codes = await db.query(`delete from auth_codes where created_at < now() - interval '24 hours'`);
  const counts = await db.query(
    `delete from rate_limit_events where bucket in ('code_email', 'code_ip', 'verify_ip') and created_at < now() - interval '1 day'`,
  );
  const sessions = await db.query(
    `delete from sessions where coalesce(revoked_at, expires_at) < now() - interval '30 days'`,
  );
  return (codes.rowCount ?? 0) + (counts.rowCount ?? 0) + (sessions.rowCount ?? 0);
}
