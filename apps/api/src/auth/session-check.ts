import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { fail } from '../http.js';
import { setSessionCookie, SESSION_DAYS, tokenHash } from './sessions.js';

/** The signed-in member on a request that passed the session check. */
export type Auth = { sessionId: string; userId: string; campusId: string };

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the session check; null on public routes. */
    auth: Auth | null;
  }
  interface FastifyContextConfig {
    /** Reachable without signing in (health, campuses, request-code, verify-code). */
    public?: boolean;
    /** Reachable by a suspended member (logout), so they can still sign out. */
    allowSuspended?: boolean;
  }
}

/** What a cookie we issued looks like: 32 random bytes, base64url. Anything else is not looked up. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The session check (docs/api-contract.md section 3). Runs before every route not marked
 * `config: { public: true }`:
 *   no cookie, unknown, revoked or expired session, deleted account -> 401 not_signed_in
 *   suspended member                                                  -> 403 suspended
 *   otherwise req.auth is set.
 * Keeps writes low: the expiry slides forward at most once a day (and the cookie is re-sent
 * with it), last_seen_at is updated at most every 5 minutes.
 */
export function installSessionCheck(app: FastifyInstance, config: Config, db: Db): RequireUser {
  app.decorateRequest('auth', null);

  app.addHook('preHandler', async (req, reply) => {
    const route = req.routeOptions.config;
    if (route.public) return;

    const token = req.cookies[config.SESSION_COOKIE];
    if (!token || !TOKEN.test(token)) return fail(reply, 401, 'not_signed_in', 'Please sign in.');

    const { rows } = await db.query<{
      session_id: string; user_id: string; campus_id: string; suspended: boolean; extend: boolean; touch: boolean;
    }>(
      `select s.id as session_id, s.user_id, u.campus_id,
              (u.suspended_at is not null and (u.suspended_until is null or u.suspended_until > clock_timestamp())) as suspended,
              s.expires_at < clock_timestamp() + make_interval(days => $2 - 1) as extend,
              s.last_seen_at < clock_timestamp() - interval '5 minutes' as touch
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.revoked_at is null and s.expires_at > clock_timestamp()
          and u.deleted_at is null`,
      [tokenHash(token), SESSION_DAYS],
    );
    const s = rows[0];
    if (!s) return fail(reply, 401, 'not_signed_in', 'Please sign in.');
    if (s.suspended && !route.allowSuspended) {
      return fail(reply, 403, 'suspended', 'This account is suspended. Contact the moderators if you think this is a mistake.');
    }

    if (s.extend || s.touch) {
      await db.query(
        `update sessions set
            last_seen_at = clock_timestamp(),
            expires_at = case when $2 then clock_timestamp() + make_interval(days => $3) else expires_at end
          where id = $1`,
        [s.session_id, s.extend, SESSION_DAYS],
      );
      if (s.extend) setSessionCookie(reply, config, token);
    }
    req.auth = { sessionId: s.session_id, userId: s.user_id, campusId: s.campus_id };
  });

  return async (req: FastifyRequest) => (req.auth ? { id: req.auth.userId } : null);
}
