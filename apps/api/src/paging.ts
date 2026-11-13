import { z } from 'zod';

/**
 * Cursor pagination (docs/api-contract.md section 1): `?limit=20&cursor=<opaque>`,
 * answering `{ items, nextCursor }`. The cursor holds the last item's (created_at, id).
 *
 * In SQL, select `created_at::text as cursor_at` next to `id`, fetch `limit + 1` rows, and filter with
 *   ($1::timestamptz is null or (created_at, id) < ($1::timestamptz, $2::uuid))     -- newest first
 * The text form keeps PostgreSQL's full microsecond precision, so no row is skipped or repeated.
 */
export const pageQuery = {
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(200).optional(),
};

export type Cursor = { at: string; id: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

/** Returns null for "start from the beginning", or throws CursorError for a cursor we did not issue. */
export function decodeCursor(cursor: string | undefined): Cursor {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
      && UUID.test(parsed[1]) && !Number.isNaN(Date.parse(parsed[0])) && parsed[0].length <= 40) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch { /* fall through */ }
  throw new CursorError();
}

export class CursorError extends Error {}

/** Turns `limit + 1` fetched rows into one page plus the cursor for the next. */
export function page<T extends { id: string; cursor_at: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return { rows: shown, nextCursor: rows.length > limit && last ? encodeCursor(last.cursor_at, last.id) : null };
}
