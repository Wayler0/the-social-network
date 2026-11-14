import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { CODE_MINUTES, EmailError } from '../email/mailer.js';
import { fail, parse, useContractErrors } from '../http.js';
import type { Queryable } from '../images/store.js';
import { findCampusDomain, hashCode, newCode, normaliseEmail } from './codes.js';
import { takeRateLimits, waitText } from './rate-limit.js';

/** Seconds before the web app offers "Resend code"; the same as the per-email limit below. */
export const RESEND_SECONDS = 30;

/**
 * Sign-in and sign-up, one flow (docs/api-contract.md section 3, issues #17–#19):
 *   POST /api/auth/request-code   { email }         -> { resendAfterSeconds }
 *   POST /api/auth/verify-code    { email, code }   -> { newUser } + session cookie   (next step)
 */
export async function authRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);

  app.post('/api/auth/request-code', async (req, reply) => {
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
}

/** Housekeeping (hourly): old sign-in codes and sign-in rate-limit counts. Returns rows removed. */
export async function cleanupAuth(db: Queryable): Promise<number> {
  const codes = await db.query(`delete from auth_codes where created_at < now() - interval '24 hours'`);
  const counts = await db.query(
    `delete from rate_limit_events where bucket in ('code_email', 'code_ip') and created_at < now() - interval '1 day'`,
  );
  return (codes.rowCount ?? 0) + (counts.rowCount ?? 0);
}
