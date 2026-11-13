import type { FastifyRequest } from 'fastify';

/** The signed-in member, as far as protected routes need to know. */
export type SessionUser = { id: string };

/**
 * Finds the signed-in member for a request, or null when there is no valid session.
 * Kim's session check (docs/api-contract.md section 3, issues #17–#19) is the real one:
 * pass it to buildApp as `requireUser`. It should also reject suspended members itself.
 */
export type RequireUser = (req: FastifyRequest) => Promise<SessionUser | null>;

/**
 * Used until the session check exists: nobody is signed in, so every protected route
 * answers 401. Safe by default — an upload endpoint must never be open to the public.
 */
export const nobodySignedIn: RequireUser = async () => null;
