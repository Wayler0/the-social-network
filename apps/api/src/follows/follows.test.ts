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
import { cleanupFollows } from './routes.js';

/** Follows against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const O = (key: string) => seedId(`office:${key}`);
const G = (key: string) => seedId(`group:${key}`);

describe.skipIf(!url)('Follows (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-follows-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'PUT' | 'DELETE', url: string) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.12.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token } });
  }
  const follow = (who: string, type: string, id: string) => as(who, 'PUT', `/api/follows/${type}/${id}`);

  it('follows a member, an office and a public club; idempotent; counts followers', async () => {
    const res = await follow('amina', 'user', U('cynthia'));
    expect([res.statusCode, res.json()]).toEqual([200, { following: true, followerCount: 1 }]);
    expect((await follow('amina', 'user', U('cynthia'))).json()).toEqual({ following: true, followerCount: 1 });
    expect((await follow('brian', 'user', U('cynthia'))).json().followerCount).toBe(2);
    expect((await follow('amina', 'office', O('library'))).statusCode).toBe(200);
    expect((await follow('amina', 'group', G('chess'))).json()).toEqual({ following: true, followerCount: 1 });

    const unfollow = await as('amina', 'DELETE', `/api/follows/user/${U('cynthia')}`);
    expect(unfollow.json()).toEqual({ following: false, followerCount: 1 });
    expect((await as('amina', 'DELETE', `/api/follows/user/${U('cynthia')}`)).statusCode).toBe(200);
  });

  it('404 for yourself, blocked members, deleted members, ordinary/private/student-only groups (for staff), made-up ids', async () => {
    await client.query(`update groups set kind = 'club' where id = $1`, [G('study')]);   // a student-only public club
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('esther'), U('cynthia')]);
    const cases: Array<[string, string, string]> = [
      ['amina', 'user', U('amina')],
      ['brian', 'user', U('ivy')],            // brian blocked ivy
      ['cynthia', 'user', U('esther')],       // esther blocked cynthia
      ['amina', 'user', U('gone')],
      ['amina', 'group', G('football')],      // ordinary group: join, don't follow
      ['amina', 'group', G('roommates')],     // private
      ['felix', 'group', G('study')],         // staff never see student-only groups
      ['amina', 'office', randomUUID()],
      ['amina', 'user', 'not-a-uuid'],
      ['amina', 'post', randomUUID()],
    ];
    for (const [who, type, id] of cases) {
      const res = await follow(who, type, id);
      expect([res.statusCode, res.json().error], `${who} ${type} ${id}`).toEqual([404, 'not_found']);
    }
    expect((await follow('amina', 'group', G('study'))).statusCode).toBe(200);   // students may
  });

  it('public profiles and groups show follow state and counts', async () => {
    await follow('amina', 'user', U('cynthia'));
    await follow('cynthia', 'user', U('amina'));
    await follow('cynthia', 'office', O('dean'));
    const profile = (await as('amina', 'GET', `/api/users/${U('cynthia')}`)).json();
    expect(profile).toMatchObject({ isFollowing: true, followsYou: true, followerCount: 1, followingCount: 2 });

    await follow('brian', 'group', G('chess'));
    expect((await as('brian', 'GET', `/api/groups/${G('chess')}`)).json())
      .toMatchObject({ canFollow: true, following: true, followerCount: 1 });
    expect((await as('brian', 'GET', `/api/groups/${G('football')}`)).json())
      .toMatchObject({ canFollow: false, following: false, followerCount: null });
  });

  it('my following (filter by type) and followers lists, newest first, paged', async () => {
    await follow('amina', 'user', U('cynthia'));
    await follow('amina', 'office', O('library'));
    await follow('amina', 'group', G('chess'));
    await follow('brian', 'user', U('amina'));
    await follow('amina', 'user', U('brian'));

    const all = (await as('amina', 'GET', '/api/me/following?limit=2')).json();
    expect(all.items).toHaveLength(2);
    const rest = (await as('amina', 'GET', `/api/me/following?limit=2&cursor=${all.nextCursor}`)).json();
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
    expect(new Set([...all.items, ...rest.items].map((i: { type: string }) => i.type))).toEqual(new Set(['user', 'office', 'group']));

    const offices = (await as('amina', 'GET', '/api/me/following?type=office')).json().items;
    expect(offices).toEqual([{ type: 'office', id: O('library'), name: 'Library (seed)', photoUrl: null, since: expect.any(String) }]);

    const followers = (await as('amina', 'GET', '/api/me/followers')).json();
    expect(followers).toEqual({ items: [{ id: U('brian'), name: expect.any(String), photoUrl: null, followsBack: true, since: expect.any(String) }], nextCursor: null });
    expect((await as('amina', 'GET', '/api/me/following?cursor=x')).json().error).toBe('invalid_input');
  });

  it('blocking ends follows both ways; deleting an account removes its follows', async () => {
    await follow('amina', 'user', U('cynthia'));
    await follow('cynthia', 'user', U('amina'));
    await as('amina', 'PUT', `/api/users/${U('cynthia')}/block`);
    expect((await client.query(`select 1 from follows where target_type = 'user' and (follower_id = $1 or target_id = $1)`, [U('amina')])).rows).toHaveLength(0);

    await follow('brian', 'user', U('david'));
    await follow('david', 'user', U('brian'));
    await follow('david', 'group', G('chess'));
    const del = await app.inject({ method: 'DELETE', url: '/api/me', payload: { confirm: 'DELETE' },
      cookies: { hatua_session: await createSession(client, U('david'), { userAgent: 'test', ip: '10.12.0.2' }) } });
    expect(del.statusCode).toBe(204);
    expect((await client.query(`select 1 from follows where follower_id = $1 or target_id = $1`, [U('david')])).rows).toHaveLength(0);
  });

  it('housekeeping removes follows that point at nothing', async () => {
    await follow('amina', 'group', G('chess'));
    await follow('amina', 'user', U('cynthia'));
    await client.query(`update groups set visibility = 'private' where id = $1`, [G('chess')]);   // no longer followable
    await client.query(`insert into follows (follower_id, target_type, target_id) values ($1, 'office', $2)`, [U('amina'), randomUUID()]);
    expect(await cleanupFollows(client)).toBe(2);
    expect((await client.query('select target_id from follows where follower_id = $1', [U('amina')])).rows).toEqual([{ target_id: U('cynthia') }]);
  });

  it('the data export lists whom I follow and who follows me', async () => {
    await follow('amina', 'office', O('dean'));
    await follow('brian', 'user', U('amina'));
    const data = (await as('amina', 'GET', '/api/me/export')).json();
    expect(data.following).toEqual([{ type: 'office', id: O('dean'), name: 'Dean of Students (seed)', since: expect.any(String) }]);
    expect(data.followers).toEqual([{ id: U('brian'), name: expect.any(String), since: expect.any(String) }]);
  });
});
