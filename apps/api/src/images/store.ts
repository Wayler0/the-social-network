import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { FULL_WIDTH, THUMB_WIDTH } from './process.js';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

/** Where an image's files live under the media folder: yyyy/mm/<uuid>. Matches images.path. */
export const IMAGE_PATH = /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newImagePath(now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${randomUUID()}`;
}

/** Public addresses of an image's two sizes. Use this to build `Post.image` and `photoUrl`. */
export function imageUrls(imagePath: string): { url: string; thumbUrl: string } {
  return { url: `/media/${imagePath}/${FULL_WIDTH}.webp`, thumbUrl: `/media/${imagePath}/${THUMB_WIDTH}.webp` };
}

export type AttachedImage = { id: string; url: string; thumbUrl: string; width: number; height: number };

/** Ids come from request bodies: anything that is not a UUID would make Postgres throw (and abort a transaction). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Marks an uploaded image as used, so the cleanup job keeps it. Call it inside the same
 * transaction that saves the post (or the profile photo). Returns null when the image does
 * not exist, belongs to someone else, or is already used — answer 400 invalid_input then.
 */
export async function attachImage(db: Queryable, imageId: string, userId: string): Promise<AttachedImage | null> {
  if (!UUID.test(imageId)) return null;
  const { rows } = await db.query<{ id: string; path: string; width: number; height: number }>(
    `update images set attached_at = now()
      where id = $1 and user_id = $2 and attached_at is null
      returning id, path, width, height`,
    [imageId, userId],
  );
  const row = rows[0];
  return row ? { id: row.id, width: row.width, height: row.height, ...imageUrls(row.path) } : null;
}

/** Removes an image's files and its row (post deleted, account deleted). Missing files are fine. */
export async function deleteImage(db: Queryable, mediaDir: string, imageId: string): Promise<void> {
  if (!UUID.test(imageId)) return;
  const { rows } = await db.query<{ path: string }>('delete from images where id = $1 returning path', [imageId]);
  const row = rows[0];
  if (row && IMAGE_PATH.test(row.path)) {
    await rm(path.join(mediaDir, row.path), { recursive: true, force: true });
  }
}

const UNATTACHED_AFTER_HOURS = 24;
const STALE_UPLOAD_MS = 60 * 60 * 1000;

/**
 * Housekeeping (run hourly): deletes images nobody attached within 24 h, and upload
 * leftovers in <mediaDir>/tmp older than an hour. Returns how many images were removed.
 */
export async function cleanupImages(db: Queryable, mediaDir: string): Promise<number> {
  const { rows } = await db.query<{ id: string; path: string }>(
    `delete from images
      where id in (select id from images
                    where attached_at is null and created_at < now() - make_interval(hours => $1)
                    order by created_at limit 200)
      returning id, path`,
    [UNATTACHED_AFTER_HOURS],
  );
  for (const row of rows) {
    if (IMAGE_PATH.test(row.path)) await rm(path.join(mediaDir, row.path), { recursive: true, force: true });
  }

  const tmpDir = path.join(mediaDir, 'tmp');
  for (const name of await readdir(tmpDir).catch(() => [] as string[])) {
    const file = path.join(tmpDir, name);
    const info = await stat(file).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STALE_UPLOAD_MS) await rm(file, { force: true });
  }
  return rows.length;
}
