import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import { seed, seedId } from '../seed.js';
import { rollbackPool } from '../testing/rollback-pool.js';

/** Today board against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const O = (key: string) => seedId(`office:${key}`);
const A = (key: string) => seedId(`ann:${key}`);
const DAY = 86_400_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

describe.skipIf(!url)('Today board (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-today-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.11.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const announce = (who: string, payload: object) =>
    as(who, 'POST', '/api/announcements', { officeId: O('library'), title: 'Notice', body: 'Details.', urgency: 'normal', ...payload });

  describe('GET /api/announcements', () => {
    it('shows current pins first (urgent first), then the rest newest first; everyone sees the same board', async () => {
      for (const who of ['amina', 'felix', 'esther']) {
        const items = (await as(who, 'GET', '/api/announcements')).json().items as Array<{ id: string; pinned: boolean }>;
        expect(items.map((a) => a.id), who).toEqual([A('water'), A('library'), A('council'), A('old')]);
        expect(items.map((a) => a.pinned)).toEqual([true, true, false, false]);   // the clean-up pin has expired
      }
    });

    it('describes each announcement with its office', async () => {
      const water = (await as('amina', 'GET', '/api/announcements')).json().items[0];
      expect(water).toEqual({
        id: A('water'), office: { id: O('dean'), name: expect.any(String), photoUrl: null, verified: true },
        title: expect.any(String), body: expect.any(String), urgency: 'urgent', pinned: true,
        pinnedUntil: expect.stringMatching(/Z$/), createdAt: expect.stringMatching(/Z$/),
      });
      expect(JSON.stringify(water)).not.toContain(U('felix'));                 // who typed it stays private
    });

    it('later pages hold only unpinned announcements', async () => {
      const first = (await as('amina', 'GET', '/api/announcements?limit=1')).json();
      expect(first.items.map((a: { id: string }) => a.id)).toEqual([A('water'), A('library'), A('council')]);
      const second = (await as('amina', 'GET', `/api/announcements?limit=1&cursor=${first.nextCursor}`)).json();
      expect(second).toEqual({ items: [expect.objectContaining({ id: A('old') })], nextCursor: null });
    });

    it('rejects bad paging', async () => {
      expect((await as('amina', 'GET', '/api/announcements?cursor=x')).json().error).toBe('invalid_input');
    });
  });

  describe('POST /api/announcements', () => {
    it('current owners and editors of a verified office can post', async () => {
      const res = await announce('felix', { title: '  Quiet   hours ', body: ' From 10 pm. ', pinnedUntil: inDays(1) });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ title: 'Quiet hours', body: 'From 10 pm.', urgency: 'normal', pinned: true, office: { id: O('library') } });
      expect((await announce('david', { officeId: O('council') })).statusCode).toBe(201);      // editor
    });

    it('others cannot, nor members of an unverified office or a past one', async () => {
      expect((await announce('cynthia', {})).json().error).toBe('forbidden');
      await client.query('update office_accounts set verified = false where id = $1', [O('library')]);
      expect((await announce('felix', {})).json().message).toMatch(/verified/);
      await client.query(`update office_members set ends_at = clock_timestamp() where user_id = $1 and office_id = $2`, [U('felix'), O('dean')]);
      expect((await announce('felix', { officeId: O('dean') })).json().error).toBe('forbidden');
      expect((await announce('felix', { officeId: randomUUID() })).json().error).toBe('forbidden');
    });

    it('rejects bad input and pins in the past or more than 14 days ahead', async () => {
      for (const extra of [{ title: ' ' }, { body: '' }, { urgency: 'panic' }, { pinnedUntil: 'tomorrow' },
        { pinnedUntil: inDays(-1) }, { pinnedUntil: inDays(15) }, { createdBy: U('hassan') }]) {
        expect((await announce('felix', extra)).json().error, JSON.stringify(extra)).toBe('invalid_input');
      }
      expect((await announce('felix', { pinnedUntil: inDays(13.9) })).statusCode).toBe(201);
    });

    it('at most 5 normal pins at once; urgent ones and unpinned ones still go through', async () => {
      // The seed has 1 normal pin (library) and 1 urgent pin (water).
      for (let i = 0; i < 4; i++) expect((await announce('felix', { title: `Pin ${i}`, pinnedUntil: inDays(2) })).statusCode, `pin ${i}`).toBe(201);
      const full = await announce('felix', { title: 'One too many', pinnedUntil: inDays(2) });
      expect([full.statusCode, full.json().error]).toEqual([409, 'pin_limit']);
      expect((await announce('felix', { officeId: O('dean'), urgency: 'urgent', title: 'Fire drill now', pinnedUntil: inDays(1) })).statusCode).toBe(201);
      expect((await announce('felix', { title: 'Not pinned' })).statusCode).toBe(201);

      await client.query(`update announcements set pinned_until = clock_timestamp() - interval '1 second' where id = $1`, [A('library')]);
      expect((await announce('felix', { title: 'A pin freed up', pinnedUntil: inDays(2) })).statusCode).toBe(201);
    });

    it('allows 10 announcements per office per day', async () => {
      await client.query(`insert into rate_limit_events (bucket, key) select 'announce_office', $1 from generate_series(1, 10)`, [O('library')]);
      expect((await announce('felix', {})).json().error).toBe('rate_limited');
      expect((await announce('felix', { officeId: O('dean') })).statusCode).toBe(201);
    });
  });

  describe('DELETE /api/announcements/:id', () => {
    it('the office owner or an admin removes it; editors, moderators and others cannot', async () => {
      expect((await as('david', 'DELETE', `/api/announcements/${A('council')}`)).statusCode).toBe(403);   // editor
      expect((await as('grace', 'DELETE', `/api/announcements/${A('council')}`)).statusCode).toBe(403);   // moderator
      expect((await as('felix', 'DELETE', `/api/announcements/${A('council')}`)).statusCode).toBe(403);   // another office's owner
      expect((await as('hassan', 'DELETE', `/api/announcements/${A('council')}`)).statusCode).toBe(204);  // owner
      expect((await as('hassan', 'DELETE', `/api/announcements/${A('library')}`)).statusCode).toBe(204);  // admin
      expect((await as('hassan', 'DELETE', `/api/announcements/${A('library')}`)).statusCode).toBe(404);
      expect((await as('hassan', 'DELETE', '/api/announcements/nope')).statusCode).toBe(404);
    });
  });

  describe('GET /api/me/offices', () => {
    it('lists the offices a member can post for', async () => {
      expect((await as('felix', 'GET', '/api/me/offices')).json().items.map((o: { id: string; role: string }) => [o.id, o.role]))
        .toEqual(expect.arrayContaining([[O('dean'), 'owner'], [O('library'), 'owner']]));
      expect((await as('david', 'GET', '/api/me/offices')).json().items).toEqual([expect.objectContaining({ id: O('council'), role: 'editor', verified: true })]);
      expect((await as('cynthia', 'GET', '/api/me/offices')).json()).toEqual({ items: [] });
    });
  });
});
