import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

/**
 * Small helpers every route uses, so all answers follow docs/api-contract.md section 1.
 */

/** Sends an error in the contract's shape: `{ error, message }` (plus any extra fields, e.g. retryAfterSeconds). */
export const fail = (reply: FastifyReply, status: number, error: string, message: string, extra: object = {}) =>
  reply.code(status).send({ error, message, ...extra });

/** Validates input the contract's way: unknown fields are rejected, and the first problem is reported. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, reply: FastifyReply): z.infer<S> | null {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  fail(reply, 400, 'invalid_input', `${where}${issue?.message ?? 'Invalid input.'}`);
  return null;
}

export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });

/** Times go out as ISO 8601 UTC strings. */
export const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * Errors in the contract's shape for every route in a plugin: client mistakes (bad JSON, wrong
 * content type) become 400 invalid_input; anything else is logged and answered 500 internal,
 * never with a stack trace or database message.
 */
export function useContractErrors(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return fail(reply, 400, 'invalid_input', 'The request could not be read.');
    }
    req.log.error(err);
    return fail(reply, 500, 'internal', 'Something went wrong. Please try again.');
  });
}
