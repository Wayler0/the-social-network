import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import multipart from '@fastify/multipart';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { FULL_WIDTH, ImageError, processImage, THUMB_WIDTH } from './process.js';
import { IMAGE_PATH, imageUrls, newImagePath } from './store.js';

type Options = { config: Config; db: Db; requireUser: RequireUser };

const fail = (reply: FastifyReply, status: number, error: string, message: string, extra: object = {}) =>
  reply.code(status).send({ error, message, ...extra });

/** Only this many images are converted at once; the rest wait their turn (memory is tight). */
const MAX_AT_ONCE = 2;
let running = 0;
const waiting: Array<() => void> = [];
async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * Image upload and delivery (docs/api-contract.md section 6, issue #32).
 *   POST /api/images            upload one image -> { imageId, url, width, height }
 *   GET  /media/<path>/<size>.webp   the stored files, members only
 */
export async function imageRoutes(app: FastifyInstance, { config, db, requireUser }: Options) {
  const mediaDir = path.resolve(config.MEDIA_DIR);
  const tmpDir = path.join(mediaDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });

  await app.register(multipart, {
    limits: { fileSize: config.IMAGE_MAX_BYTES, files: 1, fields: 0, parts: 1, headerPairs: 50 },
  });

  const tooLarge = (reply: FastifyReply) =>
    fail(reply, 413, 'too_large', `That image is too big. The limit is ${Math.round(config.IMAGE_MAX_BYTES / 1_048_576)} MB.`);

  // Upload errors in the contract's shape; never leak details.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) return tooLarge(reply);
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return fail(reply, 400, 'invalid_input', 'Send one image in a form field called "file".');
    }
    req.log.error(err);
    return fail(reply, 500, 'internal', 'Something went wrong. Please try again.');
  });

  app.post('/api/images', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return fail(reply, 401, 'not_signed_in', 'Please sign in.');

    if (!req.isMultipart()) return fail(reply, 400, 'invalid_input', 'Send one image in a form field called "file".');

    // Rate limit: count this member's uploads in the last hour (no Redis in v0.1).
    const recent = await db.query<{ n: number; oldest: Date | null }>(
      `select count(*)::int as n, min(created_at) as oldest from rate_limit_events
        where bucket = 'image_upload' and key = $1 and created_at > now() - interval '1 hour'`,
      [user.id],
    );
    const used = recent.rows[0]?.n ?? 0;
    if (used >= config.IMAGE_UPLOADS_PER_HOUR) {
      const oldest = recent.rows[0]?.oldest?.getTime() ?? Date.now();
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 3_600_000 - Date.now()) / 1000));
      reply.header('Retry-After', String(retryAfterSeconds));
      return fail(reply, 429, 'rate_limited', 'You have uploaded a lot of images. Please try again later.', { retryAfterSeconds });
    }

    const part = await req.file();
    if (!part || part.fieldname !== 'file') {
      part?.file.resume();
      return fail(reply, 400, 'invalid_input', 'Send one image in a form field called "file".');
    }

    // Stream to disk (never hold the upload in memory), stopping at the size limit.
    const tmpFile = path.join(tmpDir, `${randomUUID()}.upload`);
    const imagePath = newImagePath();
    const outDir = path.join(mediaDir, imagePath);
    // Work out the answer first and send it only after the temporary file is gone.
    let answer: (r: FastifyReply) => FastifyReply;
    try {
      await pipeline(part.file, createWriteStream(tmpFile, { mode: 0o600 }));
      if (part.file.truncated) {
        answer = tooLarge;
      } else if ((await stat(tmpFile)).size === 0) {
        answer = (r) => fail(r, 400, 'invalid_input', 'That file is empty.');
      } else {
        const image = await oneAtATime(() => processImage(tmpFile, outDir));
        try {
          const saved = await db.query<{ id: string }>(
            'insert into images (user_id, path, width, height, bytes) values ($1, $2, $3, $4, $5) returning id',
            [user.id, imagePath, image.width, image.height, image.bytes],
          );
          await db.query(`insert into rate_limit_events (bucket, key) values ('image_upload', $1)`, [user.id]);
          const body = { imageId: saved.rows[0]!.id, url: imageUrls(imagePath).url, width: image.width, height: image.height };
          answer = (r) => r.code(201).send(body);
        } catch (err) {
          await rm(outDir, { recursive: true, force: true }); // no row, so no files
          throw err;
        }
      }
    } catch (err) {
      if (!(err instanceof ImageError)) throw err;
      const code = err.code === 'heic_not_supported' ? 'heic_not_supported' : 'invalid_image';
      const message = err.message;
      answer = (r) => fail(r, 400, code, message);
    } finally {
      await rm(tmpFile, { force: true });
    }
    return answer(reply);
  });

  // Members only, like everything else. The address is fixed forever, so browsers may keep it.
  app.get<{ Params: { '*': string } }>('/media/*', async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return fail(reply, 401, 'not_signed_in', 'Please sign in.');

    const wanted = req.params['*'];
    const slash = wanted.lastIndexOf('/');
    const imagePath = wanted.slice(0, slash);
    const fileName = wanted.slice(slash + 1);
    // Only yyyy/mm/<uuid>/<1080|320>.webp is ever served — no other path can reach the disk.
    if (!IMAGE_PATH.test(imagePath) || (fileName !== `${FULL_WIDTH}.webp` && fileName !== `${THUMB_WIDTH}.webp`)) {
      return fail(reply, 404, 'not_found', 'Not found.');
    }
    const file = path.join(mediaDir, imagePath, fileName);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return fail(reply, 404, 'not_found', 'Not found.');

    return reply
      .header('Content-Type', 'image/webp')
      .header('Content-Length', info.size)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(file));
  });
}
