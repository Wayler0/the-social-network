import type { FastifyRequest } from 'fastify';

/** The signed-in member, as far as protected routes need to know. */
export type SessionUser = { id: string };

/**
 * Finds the signed-in member for a request, or null when there is none.
 * The real one is the session check (src/auth/session-check.ts): by the time a protected route
 * runs, it has already answered 401 or 403 for anyone without a valid session, so routes may
 * still call this for the member's id. Tests pass their own to buildApp to skip cookies.
 */
export type RequireUser = (req: FastifyRequest) => Promise<SessionUser | null>;
