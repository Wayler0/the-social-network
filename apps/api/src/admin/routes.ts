import type { FastifyError, FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { managementRoutes } from './management.js';
import { moderationRoutes } from './moderation.js';
import { fail } from './shared.js';

/**
 * The admin API (docs/api-contract.md section 11, issue #37).
 * Moderators: report queue and hiding content. Admins: everything.
 * The first admin of a campus is made on the server: `npm run admin:grant -w apps/api -- <email>`.
 */
export async function adminRoutes(app: FastifyInstance, opts: { db: Db; requireUser: RequireUser }) {
  // Errors in the contract's shape; details go to the log, never to the browser.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return fail(reply, 400, 'invalid_input', 'The request could not be read.');
    }
    req.log.error(err);
    return fail(reply, 500, 'internal', 'Something went wrong. Please try again.');
  });
  await app.register(moderationRoutes, opts);
  await app.register(managementRoutes, opts);
}
