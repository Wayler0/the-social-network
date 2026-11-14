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

/** Groups against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);
const G = (key: string) => seedId(`group:${key}`);
const CLASS_CS3 = seedId('group:class:BSc Computer Science|3');   // cynthia's class group

describe.skipIf(!url)('groups (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-groups-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.10.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const ids = (res: { json: () => { items: Array<{ id: string }> } }) => res.json().items.map((g) => g.id);
  const membership = async (group: string, who: string) =>
    (await client.query('select role, status from group_members where group_id = $1 and user_id = $2', [group, U(who)])).rows[0] ?? null;

  describe('listing and reading', () => {
    it('Discover lists groups newest first, without other people\'s class groups or groups hidden from the viewer', async () => {
      const found = ids(await as('felix', 'GET', '/api/groups?limit=50'));
      expect(found).toEqual(expect.arrayContaining([G('chess'), G('football'), G('roommates')]));
      expect(found).not.toContain(G('study'));                                  // students only
      expect(found).not.toContain(CLASS_CS3);
      expect(ids(await as('cynthia', 'GET', '/api/groups?limit=50'))).toEqual(expect.arrayContaining([G('study'), CLASS_CS3]));
    });

    it('"mine" lists every group I am in or asked to join, with my status', async () => {
      const items = (await as('brian', 'GET', '/api/groups?mine=true')).json().items as Array<{ id: string; myStatus: string; myRole: string | null }>;
      const byId = Object.fromEntries(items.map((g) => [g.id, g]));
      expect(byId[G('football')]).toMatchObject({ myStatus: 'active', myRole: 'admin' });
      expect(byId[G('roommates')]).toMatchObject({ myStatus: 'pending', myRole: null });
      expect(byId[G('chess')]).toBeUndefined();
    });

    it('pages with cursors', async () => {
      const first = (await as('cynthia', 'GET', '/api/groups?limit=2')).json();
      const second = (await as('cynthia', 'GET', `/api/groups?limit=2&cursor=${first.nextCursor}`)).json();
      expect(first.items).toHaveLength(2);
      expect(second.items.map((g: { id: string }) => g.id)).not.toContain(first.items[0].id);
      expect((await as('cynthia', 'GET', '/api/groups?cursor=bad')).json().error).toBe('invalid_input');
    });

    it('shows a group; a private group\'s member count only to members; 404 for hidden ones', async () => {
      expect((await as('amina', 'GET', `/api/groups/${G('chess')}`)).json()).toEqual({
        id: G('chess'), name: expect.any(String), description: expect.any(String), visibility: 'public', studentOnly: false,
        kind: 'club', clubVerified: true, posting: 'admins_only', isClassGroup: false, memberCount: 3, myStatus: 'active', myRole: 'member',
      });
      expect((await as('cynthia', 'GET', `/api/groups/${G('roommates')}`)).json()).toMatchObject({ memberCount: null, myStatus: 'none' });
      expect((await as('david', 'GET', `/api/groups/${G('roommates')}`)).json()).toMatchObject({ memberCount: 1, myRole: 'admin' });
      for (const id of [G('study'), randomUUID(), 'nope']) expect((await as('felix', 'GET', `/api/groups/${id}`)).statusCode, id).toBe(404);
    });
  });

  describe('creating', () => {
    it('makes the creator its admin', async () => {
      const res = await as('esther', 'POST', '/api/groups', { name: '  Alumni   Mentors ', description: 'Ask us about careers.', visibility: 'public' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'Alumni Mentors', studentOnly: false, kind: 'group', posting: 'everyone', memberCount: 1, myStatus: 'active', myRole: 'admin' });
    });

    it('students-only groups: only current students can make them, and staff never see them', async () => {
      const made = await as('amina', 'POST', '/api/groups', { name: 'Freshers chill', visibility: 'private', studentOnly: true });
      expect(made.statusCode).toBe(201);
      expect((await as('felix', 'GET', `/api/groups/${made.json().id}`)).statusCode).toBe(404);
      for (const who of ['felix', 'esther']) {
        expect((await as(who, 'POST', '/api/groups', { name: 'x', visibility: 'public', studentOnly: true })).json().error, who).toBe('forbidden');
      }
    });

    it('needs a finished profile, valid input, and allows 5 a day', async () => {
      expect((await as('newbie', 'POST', '/api/groups', { name: 'x', visibility: 'public' })).json().error).toBe('profile_incomplete');
      for (const body of [{ name: ' ', visibility: 'public' }, { name: 'x', visibility: 'secret' }, { name: 'x'.repeat(121), visibility: 'public' }, { name: 'x', visibility: 'public', kind: 'club' }]) {
        expect((await as('david', 'POST', '/api/groups', body)).json().error, JSON.stringify(body).slice(0, 30)).toBe('invalid_input');
      }
      for (let i = 0; i < 5; i++) expect((await as('david', 'POST', '/api/groups', { name: `G${i}`, visibility: 'public' })).statusCode).toBe(201);
      expect((await as('david', 'POST', '/api/groups', { name: 'G5', visibility: 'public' })).json().error).toBe('rate_limited');
    });
  });

  describe('joining and leaving', () => {
    it('joins a public group at once, and joining again changes nothing', async () => {
      expect((await as('cynthia', 'PUT', `/api/groups/${G('football')}/membership`)).json()).toEqual({ status: 'active' });
      expect((await as('cynthia', 'PUT', `/api/groups/${G('football')}/membership`)).json()).toEqual({ status: 'active' });
      expect(await membership(G('football'), 'cynthia')).toEqual({ role: 'member', status: 'active' });
    });

    it('asks to join a private group; admins approve or refuse', async () => {
      expect((await as('esther', 'PUT', `/api/groups/${G('roommates')}/membership`)).json()).toEqual({ status: 'pending' });
      const waiting = (await as('david', 'GET', `/api/groups/${G('roommates')}/requests`)).json().items.map((r: { id: string }) => r.id);
      expect([...waiting].sort()).toEqual([U('brian'), U('esther')].sort());
      expect((await as('brian', 'GET', `/api/groups/${G('roommates')}/requests`)).json().error).toBe('forbidden');

      expect((await as('david', 'POST', `/api/groups/${G('roommates')}/requests/${U('brian')}`, { approve: true })).json()).toEqual({ status: 'active' });
      expect((await as('david', 'POST', `/api/groups/${G('roommates')}/requests/${U('esther')}`, { approve: false })).json()).toEqual({ status: 'none' });
      expect(await membership(G('roommates'), 'brian')).toEqual({ role: 'member', status: 'active' });
      expect(await membership(G('roommates'), 'esther')).toBeNull();
      expect((await as('david', 'POST', `/api/groups/${G('roommates')}/requests/${U('esther')}`, { approve: true })).statusCode).toBe(404);
      expect((await as('brian', 'POST', `/api/groups/${G('roommates')}/requests/${U('esther')}`, { approve: true })).statusCode).toBe(403);
    });

    it('nobody joins or leaves a class group by hand, and staff cannot join student-only groups', async () => {
      expect((await as('cynthia', 'DELETE', `/api/groups/${CLASS_CS3}/membership`)).json().error).toBe('forbidden');
      expect((await as('esther', 'PUT', `/api/groups/${CLASS_CS3}/membership`)).json().error).toBe('forbidden');
      expect((await as('felix', 'PUT', `/api/groups/${G('study')}/membership`)).statusCode).toBe(404);
      expect((await as('newbie', 'PUT', `/api/groups/${G('football')}/membership`)).json().error).toBe('profile_incomplete');
    });

    it('leaving, or withdrawing a request', async () => {
      expect((await as('hassan', 'DELETE', `/api/groups/${G('football')}/membership`)).statusCode).toBe(204);
      expect(await membership(G('football'), 'hassan')).toBeNull();
      expect((await as('brian', 'DELETE', `/api/groups/${G('roommates')}/membership`)).statusCode).toBe(204);
      expect(await membership(G('roommates'), 'brian')).toBeNull();
    });

    it('when the last admin leaves, the longest-standing member takes over', async () => {
      await client.query(`update group_members set joined_at = joined_at - interval '1 day' where group_id = $1 and user_id = $2`, [G('football'), U('hassan')]);
      expect((await as('brian', 'DELETE', `/api/groups/${G('football')}/membership`)).statusCode).toBe(204);
      expect(await membership(G('football'), 'hassan')).toEqual({ role: 'admin', status: 'active' });
      expect(await membership(G('football'), 'david')).toEqual({ role: 'member', status: 'active' });
    });
  });

  describe('group posts', () => {
    it('members read them; others get 403, and 404 if they cannot see the group', async () => {
      const res = await as('david', 'GET', `/api/groups/${G('football')}/posts`);
      expect(res.statusCode).toBe(200);
      expect(res.json().items.map((p: { id: string }) => p.id)).toContain(P('photo2'));
      expect(res.json().items[0].group).toEqual({ id: G('football'), name: expect.any(String) });
      expect((await as('cynthia', 'GET', `/api/groups/${G('football')}/posts`)).json().error).toBe('forbidden');
      expect((await as('brian', 'GET', `/api/groups/${G('roommates')}/posts`)).json().error).toBe('forbidden');   // still pending
      expect((await as('felix', 'GET', `/api/groups/${G('study')}/posts`)).statusCode).toBe(404);
    });

    it('a new member sees the posts straight away', async () => {
      await as('cynthia', 'PUT', `/api/groups/${G('football')}/membership`);
      expect((await as('cynthia', 'GET', `/api/groups/${G('football')}/posts`)).json().items.map((p: { id: string }) => p.id)).toContain(P('photo2'));
    });
  });
});
