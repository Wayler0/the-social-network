import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { adminRoutes } from './admin/routes.js';
import { authRoutes } from './auth/routes.js';
import { meRoutes } from './me/routes.js';
import { postRoutes } from './posts/routes.js';
import { safetyRoutes } from './safety/routes.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { createMailer, type Mailer } from './email/mailer.js';
import { installSessionCheck } from './auth/session-check.js';
import type { RequireUser } from './guard.js';
import { imageRoutes } from './images/routes.js';

/**
 * Pieces tests can swap: `requireUser` replaces the session check (no cookie needed),
 * `mailer` replaces the real email sender.
 */
export type AppDeps = { requireUser?: RequireUser; mailer?: Mailer };

declare module 'fastify' {
  interface FastifyInstance {
    /** Sends email (sign-in codes). Use `app.mailer.sendSignInCode(email, code)` — see docs/email.md. */
    mailer: Mailer;
  }
}

/**
 * Builds the API. Routes live under /api (the web server forwards /api here).
 * Feature routes are registered below as they are built. Shapes, rules and owners: docs/api-contract.md.
 */
export function buildApp(config: Config, db: Db, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true, // we sit behind the server's existing web server
    bodyLimit: 1_048_576, // 1 MB JSON; image uploads get their own route and limit
  });

  const mailer = deps.mailer ?? createMailer(config, {
    info: (details, message) => app.log.info(details, message),
    warn: (details, message) => app.log.warn(details, message),
    error: (details, message) => app.log.error(details, message),
  });
  app.decorate('mailer', mailer);
  app.register(cookie); // reads the session cookie (docs/api-contract.md section 3)
  // Every route not marked `config: { public: true }` needs a session (src/auth/session-check.ts).
  const requireUser = deps.requireUser ?? installSessionCheck(app, config, db);
  app.addHook('onClose', () => mailer.close());

  app.get('/api/health', { config: { public: true } }, async (_req, reply) => {
    try {
      await db.query('select 1');
      return { ok: true, name: config.APP_NAME, db: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, name: config.APP_NAME, db: 'down' });
    }
  });

  /** The campus list the sign-up screen needs (replaces the hard-coded list in apps/web/src/config.ts). */
  app.get('/api/campuses', { config: { public: true } }, async () => {
    const { rows } = await db.query<{ slug: string; name: string; domain: string; member_type: string }>(
      `select c.slug, c.name, d.domain, d.member_type
         from campuses c join campus_email_domains d on d.campus_id = c.id
        where c.status = 'active'
        order by c.name, d.domain`,
    );
    const bySlug = new Map<string, { slug: string; name: string; emailDomains: Record<string, string> }>();
    for (const r of rows) {
      const campus = bySlug.get(r.slug) ?? { slug: r.slug, name: r.name, emailDomains: {} };
      campus.emailDomains[r.domain] = r.member_type;
      bySlug.set(r.slug, campus);
    }
    return { campuses: [...bySlug.values()] };
  });

  // --- Feature routes go here (owners in docs/api-contract.md) ---
  app.register(authRoutes, { config, db });              // Kim — issues #17, #18, #19
  app.register(meRoutes, { config, db });                // Kim — issues #20, #21
  app.register(postRoutes, { config, db });              // Kim — issues #22, #24
  app.register(safetyRoutes, { db });                    // Kim — issue #23
  app.register(imageRoutes, { config, db, requireUser }); // Peter — issue #32
  app.register(adminRoutes, { db, requireUser });         // Peter — issue #37

  return app;
}
