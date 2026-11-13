import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { attachImage, cleanupImages, deleteImage, imageUrls } from './store.js';

const USER = '00000000-0000-4000-c000-000000000001';
const signedIn: RequireUser = async () => ({ id: USER });

let mediaDir: string;
beforeAll(async () => { mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-media-')); });
afterAll(async () => { await rm(mediaDir, { recursive: true, force: true }); });

/** A stand-in database that remembers image rows and upload counts. */
function fakeDb(start: { uploadsThisHour?: number } = {}) {
  const images: Array<{ id: string; user_id: string; path: string; width: number; height: number; attached: boolean }> = [];
  let uploads = start.uploadsThisHour ?? 0;
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('from rate_limit_events')) return { rows: [{ n: uploads, oldest: new Date(Date.now() - 600_000) }] };
      if (sql.includes('insert into rate_limit_events')) { uploads++; return { rows: [] }; }
      if (sql.includes('insert into images')) {
        const row = { id: `00000000-0000-4000-7000-00000000000${images.length + 1}`, user_id: params[0] as string,
          path: params[1] as string, width: params[2] as number, height: params[3] as number, attached: false };
        images.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.includes('update images set attached_at')) {
        const row = images.find((i) => i.id === params[0] && i.user_id === params[1] && !i.attached);
        if (row) row.attached = true;
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('delete from images')) {
        const gone = images.filter((i) => !i.attached);
        return { rows: gone.map((i) => ({ id: i.id, path: i.path })) };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { db: db as unknown as Db, images };
}

function appWith(db: Db, requireUser: RequireUser | 'default' = signedIn, env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/test', MEDIA_DIR: mediaDir, ...env });
  return buildApp(config, db, requireUser === 'default' ? {} : { requireUser });
}

/** Builds a multipart/form-data body with one file. */
function form(file: Buffer, field = 'file', filename = 'photo.jpg', type = 'image/jpeg') {
  const boundary = '----hatuatest';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), file, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const picture = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 106, g: 61, b: 245 } } });

describe('POST /api/images', () => {
  it('answers 401 when nobody is signed in (the default until the session check exists)', async () => {
    const app = appWith(fakeDb().db, 'default');
    const res = await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(10, 10).jpeg().toBuffer()) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('not_signed_in');
  });

  it('shrinks a big photo to 1080 px WebP plus a 320 px thumbnail, and strips EXIF and location', async () => {
    const { db, images } = fakeDb();
    const photo = await picture(3000, 2000).jpeg()
      .withExif({ IFD0: { Copyright: 'secret owner' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '0/1 18/1 0/1' } })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined(); // the upload really carries EXIF

    const res = await appWith(db).inject({ method: 'POST', url: '/api/images', ...form(photo) });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toEqual({ imageId: images[0]!.id, url: `/media/${images[0]!.path}/1080.webp`, width: 1080, height: 720 });

    const full = await sharp(path.join(mediaDir, images[0]!.path, '1080.webp')).metadata();
    const thumb = await sharp(path.join(mediaDir, images[0]!.path, '320.webp')).metadata();
    expect([full.format, full.width, full.height]).toEqual(['webp', 1080, 720]);
    expect([thumb.format, thumb.width]).toEqual(['webp', 320]);
    expect(full.exif).toBeUndefined();
    expect(thumb.exif).toBeUndefined();
    expect(await readdir(path.join(mediaDir, 'tmp'))).toEqual([]); // no upload leftovers
  });

  it('never enlarges a small image, and accepts PNG and WebP', async () => {
    const { db } = fakeDb();
    const app = appWith(db);
    const png = await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(200, 100).png().toBuffer(), 'file', 'a.png', 'image/png') });
    expect(png.json()).toMatchObject({ width: 200, height: 100 });
    const webp = await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(64, 64).webp().toBuffer(), 'file', 'a.webp', 'image/webp') });
    expect(webp.statusCode).toBe(201);
  });

  it('turns a sideways phone photo the right way up', async () => {
    const { db } = fakeDb();
    const sideways = await picture(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const res = await appWith(db).inject({ method: 'POST', url: '/api/images', ...form(sideways) });
    expect(res.json()).toMatchObject({ width: 200, height: 400 });
  });

  it('goes by what the file is, not what it is called', async () => {
    const { db, images } = fakeDb();
    const app = appWith(db);
    const text = await app.inject({ method: 'POST', url: '/api/images', ...form(Buffer.from('<script>alert(1)</script>')) });
    expect([text.statusCode, text.json().error]).toEqual([400, 'invalid_image']);
    const gif = await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(10, 10).gif().toBuffer()) });
    expect([gif.statusCode, gif.json().error]).toEqual([400, 'invalid_image']);
    const svg = await app.inject({ method: 'POST', url: '/api/images', ...form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')) });
    expect(svg.statusCode).toBe(400);
    expect(images).toHaveLength(0);
    expect(await readdir(path.join(mediaDir, 'tmp'))).toEqual([]);
  });

  it('answers 413 above the size limit', async () => {
    const { db, images } = fakeDb();
    const app = appWith(db, signedIn, { IMAGE_MAX_BYTES: '2048' });
    const res = await app.inject({ method: 'POST', url: '/api/images', ...form(Buffer.alloc(5000, 1)) });
    expect([res.statusCode, res.json().error]).toEqual([413, 'too_large']);
    expect(images).toHaveLength(0);
  });

  it('accepts an upload larger than the 1 MB JSON limit', async () => {
    const { db } = fakeDb();
    const noise = await sharp(Buffer.from(Array.from({ length: 900 * 900 * 3 }, (_, i) => (i * 7919) % 251)),
      { raw: { width: 900, height: 900, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    expect(noise.length).toBeGreaterThan(1_048_576);
    const res = await appWith(db).inject({ method: 'POST', url: '/api/images', ...form(noise, 'file', 'big.png', 'image/png') });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a wrong field name, an empty file and a JSON body', async () => {
    const { db } = fakeDb();
    const app = appWith(db);
    const wrongField = await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(10, 10).jpeg().toBuffer(), 'photo') });
    expect(wrongField.statusCode).toBe(400);
    const empty = await app.inject({ method: 'POST', url: '/api/images', ...form(Buffer.alloc(0)) });
    expect(empty.statusCode).toBe(400);
    const json = await app.inject({ method: 'POST', url: '/api/images', payload: { file: 'x' } });
    expect([json.statusCode, json.json().error]).toEqual([400, 'invalid_input']);
  });

  it('answers 400, not "too large", when the form carries an extra field', async () => {
    const boundary = '----hatuatest';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      await picture(10, 10).jpeg().toBuffer(),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await appWith(fakeDb().db).inject({
      method: 'POST', url: '/api/images', payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([res.statusCode, res.json().error]).toEqual([400, 'invalid_input']);
  });

  it('counts rejected files towards the rate limit too', async () => {
    const app = appWith(fakeDb().db, signedIn, { IMAGE_UPLOADS_PER_HOUR: '1' });
    const notAnImage = await app.inject({ method: 'POST', url: '/api/images', ...form(Buffer.from('not an image')) });
    expect(notAnImage.statusCode).toBe(400);
    const next = await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(10, 10).jpeg().toBuffer()) });
    expect(next.statusCode).toBe(429);
  });

  it('rate-limits a member with 429 and Retry-After', async () => {
    const { db } = fakeDb({ uploadsThisHour: 30 });
    const res = await appWith(db).inject({ method: 'POST', url: '/api/images', ...form(await picture(10, 10).jpeg().toBuffer()) });
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json()).toMatchObject({ error: 'rate_limited', retryAfterSeconds: expect.any(Number) });
  });
});

describe('GET /media/*', () => {
  it('serves both sizes to members with long caching, and nothing else', async () => {
    const { db, images } = fakeDb();
    const app = appWith(db);
    await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(500, 500).jpeg().toBuffer()) });
    const { url, thumbUrl } = imageUrls(images[0]!.path);

    const full = await app.inject({ method: 'GET', url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('image/webp');
    expect(full.headers['cache-control']).toContain('immutable');
    expect((await sharp(full.rawPayload).metadata()).width).toBe(500);
    expect((await app.inject({ method: 'GET', url: thumbUrl })).statusCode).toBe(200);

    for (const bad of [
      `/media/${images[0]!.path}/999.webp`,
      `/media/${images[0]!.path}/../../../../etc/passwd`,
      '/media/..%2F..%2Fetc%2Fpasswd',
      '/media/tmp/x.upload',
      '/media/2026/11/00000000-0000-4000-8000-000000000000/1080.webp',
    ]) {
      expect((await app.inject({ method: 'GET', url: bad })).statusCode, bad).toBe(404);
    }
  });

  it('answers 401 to people who are not signed in', async () => {
    const res = await appWith(fakeDb().db, 'default').inject({ method: 'GET', url: '/media/2026/11/00000000-0000-4000-8000-000000000000/1080.webp' });
    expect(res.statusCode).toBe(401);
  });
});

describe('attachImage and cleanupImages', () => {
  it('treats an id that is not a UUID as "no such image" without touching the database', async () => {
    const noDb = { query: async () => { throw new Error('the database must not be asked'); } } as unknown as Db;
    expect(await attachImage(noDb, 'not-a-uuid', USER)).toBeNull();
    expect(await attachImage(noDb, "1' or '1'='1", USER)).toBeNull();
    await expect(deleteImage(noDb, mediaDir, 'not-a-uuid')).resolves.toBeUndefined();
  });

  it('attaches once, only for the uploader, and cleanup removes what was never attached', async () => {
    const { db, images } = fakeDb();
    const app = appWith(db);
    await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(50, 50).jpeg().toBuffer()) });
    await app.inject({ method: 'POST', url: '/api/images', ...form(await picture(60, 60).jpeg().toBuffer()) });
    const [kept, orphan] = images as [typeof images[0], typeof images[0]];

    expect(await attachImage(db, kept.id, 'someone-else')).toBeNull();
    expect(await attachImage(db, kept.id, USER)).toMatchObject({ id: kept.id, width: 50, url: `/media/${kept.path}/1080.webp` });
    expect(await attachImage(db, kept.id, USER)).toBeNull(); // already used

    const stale = path.join(mediaDir, 'tmp', 'old.upload');
    await writeFile(stale, 'x');
    await utimes(stale, new Date(Date.now() - 7_200_000), new Date(Date.now() - 7_200_000));

    expect(await cleanupImages(db, mediaDir)).toBe(1);
    expect(await stat(path.join(mediaDir, kept.path, '1080.webp')).then(() => true)).toBe(true);
    expect(await stat(path.join(mediaDir, orphan.path)).catch(() => null)).toBeNull();
    expect(await stat(stale).catch(() => null)).toBeNull();
  });
});
