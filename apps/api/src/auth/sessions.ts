import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { Queryable } from '../images/store.js';

/**
 * Sessions (docs/api-contract.md section 3). The cookie holds a random 32-byte token;
 * the database holds only sha256(token), so a copy of the database cannot sign anyone in.
 */
export const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

export const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();

/** Creates a session for the member and returns the token for the cookie. */
export async function createSession(
  tx: Queryable, userId: string, info: { userAgent: string | undefined; ip: string },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await tx.query(
    `insert into sessions (user_id, token_hash, user_agent, ip, expires_at)
     values ($1, $2, $3, $4, clock_timestamp() + make_interval(days => $5))`,
    [userId, tokenHash(token), info.userAgent?.slice(0, 400) ?? null, info.ip, SESSION_DAYS],
  );
  return token;
}

/** HttpOnly so page scripts cannot read it; Secure everywhere except local development. */
export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  reply.setCookie(config.SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  reply.clearCookie(config.SESSION_COOKIE, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
  });
}
