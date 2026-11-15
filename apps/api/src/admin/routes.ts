import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { managementRoutes } from './management.js';
import { moderationRoutes } from './moderation.js';
import { useContractErrors } from '../http.js';

/**
 * The admin API (docs/api-contract.md section 11, issue #37).
 * Moderators: report queue and hiding content. Admins: everything.
 * The first admin of a campus is made on the server: `npm run admin:grant -w apps/api -- <email>`.
 */
export async function adminRoutes(app: FastifyInstance, opts: { db: Db; requireUser: RequireUser }) {
  useContractErrors(app); // errors in the contract's shape; details go to the log, never to the browser
  await app.register(moderationRoutes, opts);
  await app.register(managementRoutes, opts);
}
