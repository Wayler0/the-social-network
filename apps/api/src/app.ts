import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';

/**
 * Builds the API. Routes live under /api (the web server forwards /api here).
 * Feature routes are registered below as they are built — see docs/api-contract.md.
 */
export function buildApp(config: Config, db: Db): FastifyInstance {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true, // we sit behind the server's existing web server
    bodyLimit: 1_048_576, // 1 MB JSON; image uploads get their own route and limit
  });

  app.get('/api/health', async (_req, reply) => {
    try {
      await db.query('select 1');
      return { ok: true, name: config.APP_NAME, db: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, name: config.APP_NAME, db: 'down' });
    }
  });

  /** The campus list the sign-up screen needs (replaces the hard-coded list in apps/web/src/config.ts). */
  app.get('/api/campuses', async () => {
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
  // app.register(authRoutes, { prefix: '/api/auth' });   // Kim — issues #17, #18, #19

  return app;
}
