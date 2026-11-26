import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findCampusDomain, hashCode, newCode, normaliseEmail, sameHash } from '../auth/codes.js';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { CODE_MINUTES, EmailError } from '../email/mailer.js';
import { fail, parse, useContractErrors } from '../http.js';

/**
 * Keep access after graduating (CLAUDE.md section 5): the student email closes right after
 * graduation, so a member links a personal email while their campus email still works.
 *   POST   /api/me/personal-email          { email }  -> { resendAfterSeconds }  (code sent to it)
 *   POST   /api/me/personal-email/verify   { code }   -> { personalEmail }
 *   DELETE /api/me/personal-email                     -> 204
 * Then POST /api/auth/request-code accepts that address for sign-in (never for joining).
 */
export const LINK_RESEND_SECONDS = 30;

export async function personalEmailRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);

  app.post('/api/me/personal-email', async (req, reply) => {
    const body = parse(z.object({ email: z.string().max(320) }).strict(), req.body, reply);
    if (!body) return;
    const parsed = normaliseEmail(body.email);
    if (!parsed) return fail(reply, 400, 'invalid_input', 'That doesn’t look like an email address.');
    if (await findCampusDomain(db, parsed.domain)) {
      return fail(reply, 400, 'invalid_input', 'Use a personal address (like Gmail), not a campus one: campus emails close after graduation.');
    }
    const { email } = parsed;
    const userId = req.auth!.userId;
    const taken = await db.query('select 1 from users where personal_email = $1 and id <> $2 and deleted_at is null', [email, userId]);
    if (taken.rows.length) return fail(reply, 409, 'email_taken', 'That email is already linked to another account.');

    const code = newCode();
    const outcome = await inTransaction(db, async (tx) => {
      const wait = await takeRateLimits(tx, [
        { bucket: 'link_email', key: email, max: 1, windowSeconds: LINK_RESEND_SECONDS },
        { bucket: 'link_user', key: userId, max: 5, windowSeconds: 3600 },
      ]);
      if (wait) return { ok: false as const, wait };
      await tx.query(`update auth_codes set consumed_at = clock_timestamp() where user_id = $1 and purpose = 'link_email' and consumed_at is null`, [userId]);
      const { rows } = await tx.query<{ id: string }>(
        `insert into auth_codes (email, code_hash, purpose, user_id, expires_at, request_ip)
         values ($1, $2, 'link_email', $3, clock_timestamp() + make_interval(mins => $4), $5) returning id`,
        [email, hashCode(config.CODE_PEPPER, email, code), userId, CODE_MINUTES, req.ip]);
      return { ok: true as const, id: rows[0]!.id };
    });
    if (!outcome.ok) {
      reply.header('Retry-After', String(outcome.wait));
      return fail(reply, 429, 'rate_limited', `Too many codes asked for. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
    }
    try {
      await app.mailer.sendSignInCode(email, code);
    } catch (err) {
      await db.query('delete from auth_codes where id = $1', [outcome.id]);
      if (err instanceof EmailError) return fail(reply, 503, 'email_unavailable', 'We couldn’t send the code. Please try again in a few minutes.');
      throw err;
    }
    return { resendAfterSeconds: LINK_RESEND_SECONDS };
  });

  app.post('/api/me/personal-email/verify', async (req, reply) => {
    const body = parse(z.object({ code: z.string().max(20) }).strict(), req.body, reply);
    if (!body) return;
    const userId = req.auth!.userId;
    const code = body.code.trim();
    const wrong = () => fail(reply, 400, 'code_wrong', 'That code is wrong or has expired.');
    if (!/^\d{6}$/.test(code)) return wrong();

    const result = await inTransaction(db, async (tx) => {
      const { rows } = await tx.query<{ id: string; email: string; code_hash: Buffer }>(
        `select id, email, code_hash from auth_codes
          where user_id = $1 and purpose = 'link_email' and consumed_at is null
            and expires_at > clock_timestamp() and attempts < 5
          order by created_at desc limit 1 for update`, [userId]);
      const row = rows[0];
      if (!row) return null;
      if (!sameHash(row.code_hash, hashCode(config.CODE_PEPPER, row.email, code))) {
        await tx.query('update auth_codes set attempts = attempts + 1 where id = $1', [row.id]);
        return null;
      }
      await tx.query('update auth_codes set consumed_at = clock_timestamp() where id = $1', [row.id]);
      const taken = await tx.query('select 1 from users where personal_email = $1 and id <> $2', [row.email, userId]);
      if (taken.rows.length) return 'taken' as const;
      await tx.query('update users set personal_email = $2, personal_email_linked_at = clock_timestamp() where id = $1', [userId, row.email]);
      return row.email;
    });
    if (result === 'taken') return fail(reply, 409, 'email_taken', 'That email is already linked to another account.');
    if (!result) return wrong();
    return { personalEmail: result };
  });

  app.delete('/api/me/personal-email', async (req, reply) => {
    await db.query('update users set personal_email = null, personal_email_linked_at = null where id = $1', [req.auth!.userId]);
    return reply.code(204).send();
  });
}
