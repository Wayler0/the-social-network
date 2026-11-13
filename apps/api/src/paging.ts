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

/** PostgreSQL's text form of a timestamptz, e.g. "2026-11-14 00:31:02.123456+00": the only time a cursor of ours holds. */
const PG_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?(?::\d{2})?$/;

/** True only for a time PostgreSQL will accept, so a made-up cursor is answered with 400, never a database error. */
function isPgTime(text: string): boolean {
  const m = PG_TIME.exec(text);
  if (!m) return false;
  const [year, month, day, hour, minute, second, offsetHours, offsetMinutes] = m.slice(1).map((n) => Number(n ?? 0)) as [number, number, number, number, number, number, number, number];
  const daysInMonth = new Date(Date.UTC(2000 + (year % 400), month, 0)).getUTCDate(); // same calendar every 400 years
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59 && offsetHours <= 15 && offsetMinutes <= 59;
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

/** Returns null for "start from the beginning", or throws CursorError for a cursor we did not issue. */
export function decodeCursor(cursor: string | undefined): Cursor {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
      && UUID.test(parsed[1]) && isPgTime(parsed[0])) {
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
