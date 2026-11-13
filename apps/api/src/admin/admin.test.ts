import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';
import { decodeCursor, encodeCursor, page, CursorError } from '../paging.js';
import { seed, seedId } from '../seed.js';

describe('cursor pagination', () => {
  it('round-trips a cursor and rejects anything it did not issue', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(decodeCursor(encodeCursor('2026-11-14 00:31:02.123456+00', id))).toEqual({ at: '2026-11-14 00:31:02.123456+00', id });
    expect(decodeCursor(undefined)).toBeNull();
    for (const bad of ['nonsense', encodeCursor('not a date', id), encodeCursor('2026-11-14', "x' or 1=1"), Buffer.from('{"a":1}').toString('base64url')]) {
      expect(() => decodeCursor(bad), bad).toThrow(CursorError);
    }
  });
  it('gives a next cursor only when there is another page', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, cursor_at: `2026-11-1${n}` }));
    expect(page(rows, 2)).toMatchObject({ rows: rows.slice(0, 2), nextCursor: encodeCursor('2026-11-12', rows[1]!.id) });
    expect(page(rows, 3).nextCursor).toBeNull();
    expect(page([], 3)).toEqual({ rows: [], nextCursor: null });
  });
});

/**
 * Everything below runs against a real PostgreSQL with the migrations applied (TEST_DATABASE_URL),
 * on the development seed data. Each test runs inside one transaction that is rolled back, so the
 * database is left exactly as it was — including the API's own transactions, which become savepoints.
 */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);

describe.skipIf(!url)('admin API (real database)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  let signedInAs: string | null = null;
  const as = (key: string | null) => { signedInAs = key ? U(key) : null; };

  /** A stand-in pool that keeps every query on the test's single connection. */
  function rollbackPool(): Db {
    const tx = {
      query: (sql: string, params?: unknown[]) => {
        if (sql === 'begin') return client.query('savepoint api_tx');
        if (sql === 'commit') return client.query('release savepoint api_tx');
        if (sql === 'rollback') return client.query('rollback to savepoint api_tx');
        return client.query(sql, params);
      },
      release: () => {},
    };
    return { query: (sql: string, params?: unknown[]) => client.query(sql, params), connect: async () => tx } as unknown as Db;
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-admin-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url, MEDIA_DIR: mediaDir });
    app = buildApp(config, rollbackPool(), { requireUser: async () => (signedInAs ? { id: signedInAs } : null) });
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); as('hassan'); });
  afterEach(async () => { await client.query('rollback'); });

  const get = (path: string) => app.inject({ method: 'GET', url: path });
  const post = (path: string, payload?: object) => app.inject({ method: 'POST', url: path, ...(payload ? { payload } : {}) });
  const del = (path: string) => app.inject({ method: 'DELETE', url: path });
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0] as T;
  // Inside one test transaction the database clock stands still, so "started earlier" has to be
  // said explicitly before something can be ended. In production every request has its own clock.
  const anHourPasses = async (table: 'roles' | 'office_members') => { await client.query(`update ${table} set starts_at = starts_at - interval '1 hour'`); };
  const logged = async (action: string) => (await one<{ n: number }>('select count(*)::int as n from admin_log where action = $1 and admin_user_id = $2', [action, signedInAs])).n;

  describe('who may use it', () => {
    it('401 without a session, 403 for ordinary members', async () => {
      as(null);
      expect((await get('/api/admin/reports')).statusCode).toBe(401);
      as('cynthia');
      for (const res of [await get('/api/admin/reports'), await get('/api/admin/users?q=amina'), await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'x' })]) {
        expect([res.statusCode, res.json().error]).toEqual([403, 'forbidden']);
      }
    });

    it('moderators get the queue and hiding, and nothing else', async () => {
      as('grace');
      expect((await get('/api/admin/reports')).statusCode).toBe(200);
      expect((await post(`/api/admin/content/post/${P('feed:1')}/hide`)).statusCode).toBe(200);
      for (const res of [
        await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'x' }), await get('/api/admin/users?q=amina'),
        await post('/api/admin/offices', { name: 'X', type: 'office' }), await get('/api/admin/disputes'), await get('/api/admin/log'),
        await post(`/api/admin/users/${U('brian')}/roles`, { role: 'admin' }),
      ]) expect(res.statusCode).toBe(403);
    });

    it('a role that has ended, or a suspended or deleted account, has no access', async () => {
      await client.query(`update roles set ends_at = now() - interval '1 minute', starts_at = now() - interval '1 day' where user_id = $1 and role = 'admin'`, [U('hassan')]);
      expect((await get('/api/admin/reports')).statusCode).toBe(403);
      await client.query(`update roles set ends_at = null where user_id = $1 and role = 'admin'`, [U('hassan')]);
      expect((await get('/api/admin/reports')).statusCode).toBe(200);
      await client.query(`update users set suspended_at = now() where id = $1`, [U('hassan')]);
      expect((await get('/api/admin/reports')).statusCode).toBe(403);
      await client.query(`update users set suspended_at = now() - interval '2 days', suspended_until = now() - interval '1 day' where id = $1`, [U('hassan')]);
      expect((await get('/api/admin/reports')).statusCode).toBe(200); // the suspension has run out
    });

    it('rejects unknown fields, bad ids and unreadable bodies in the contract error shape', async () => {
      expect((await get('/api/admin/reports?nope=1')).json().error).toBe('invalid_input');
      expect((await post('/api/admin/reports/not-a-uuid/resolve', { action: 'hide' })).statusCode).toBe(400);
      expect((await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'x', extra: true })).statusCode).toBe(400);
      const broken = await app.inject({ method: 'POST', url: `/api/admin/users/${U('brian')}/suspend`, payload: '{not json', headers: { 'content-type': 'application/json' } });
      expect([broken.statusCode, broken.json().error]).toEqual([400, 'invalid_input']);
    });
  });

  describe('reports', () => {
    it('lists the open queue oldest first, with the reported item and how many reports it has', async () => {
      const res = await get('/api/admin/reports');
      expect(res.statusCode).toBe(200);
      const { items, nextCursor } = res.json();
      expect(nextCursor).toBeNull();
      expect(items.map((i: { targetType: string }) => i.targetType)).toEqual(['user', 'post', 'post', 'post']);
      const spam = items[1];
      expect(spam).toMatchObject({
        targetId: P('spam'), reason: 'spam', status: 'open', reportCount: 3, reporter: { id: U('amina') },
        target: { body: expect.stringContaining('Earn money'), author: { id: U('ivy'), deleted: false }, autoHidden: true },
      });
      expect(items[0].target).toMatchObject({ name: 'Ivy Chebet (seed)', suspended: true });
      expect(JSON.stringify(items)).not.toMatch(/@|SEED\//); // no emails or member numbers in the queue
    });

    it('pages through without repeating or skipping', async () => {
      const first = (await get('/api/admin/reports?limit=3')).json();
      expect(first.items).toHaveLength(3);
      const second = (await get(`/api/admin/reports?limit=3&cursor=${first.nextCursor}`)).json();
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((i: { id: string }) => i.id)).size).toBe(4);
      expect((await get('/api/admin/reports?cursor=garbage')).statusCode).toBe(400);
      expect((await get('/api/admin/reports?limit=51')).statusCode).toBe(400);
    });

    it('lists closed reports newest first with who closed them', async () => {
      const items = (await get('/api/admin/reports?status=hidden')).json().items;
      expect(items).toHaveLength(3);
      expect(items[0]).toMatchObject({ status: 'hidden', resolvedBy: { id: U('grace') } });
      expect(new Date(items[0].createdAt).getTime()).toBeGreaterThan(new Date(items[2].createdAt).getTime());
    });

    it('dismissing closes every open report on the item and lifts the automatic hide', async () => {
      const id = seedId('report:spam2');
      const res = await post(`/api/admin/reports/${id}/resolve`, { action: 'dismiss' });
      expect(res.json()).toEqual({ status: 'dismissed', resolved: 3 });
      expect(await one('select hidden_at from posts where id = $1', [P('spam')])).toEqual({ hidden_at: null });
      expect((await one<{ n: number }>(`select count(*)::int as n from reports where target_id = $1 and status = 'dismissed' and resolved_by = $2`, [P('spam'), U('hassan')])).n).toBe(3);
      expect(await logged('report.dismiss')).toBe(1);
      expect((await post(`/api/admin/reports/${id}/resolve`, { action: 'dismiss' })).statusCode).toBe(409);
    });

    it('dismissing does not unhide something a moderator hid on purpose', async () => {
      await client.query(`insert into reports (campus_id, reporter_id, target_type, target_id, reason) select campus_id, $2, 'post', id, 'other' from posts where id = $1`, [P('modhide'), U('amina')]);
      const report = await one<{ id: string }>(`select id from reports where target_id = $1 and status = 'open'`, [P('modhide')]);
      await post(`/api/admin/reports/${report.id}/resolve`, { action: 'dismiss' });
      expect((await one<{ hidden: boolean }>('select hidden_at is not null as hidden from posts where id = $1', [P('modhide')])).hidden).toBe(true);
    });

    it('hiding hides the item and records who did it; members and groups cannot be hidden', async () => {
      as('grace');
      const res = await post(`/api/admin/reports/${seedId('report:spam1')}/resolve`, { action: 'hide' });
      expect(res.json()).toEqual({ status: 'hidden', resolved: 3 });
      expect(await one('select hidden_at is not null as hidden, hidden_by from posts where id = $1', [P('spam')])).toEqual({ hidden: true, hidden_by: U('grace') });
      const onUser = await post(`/api/admin/reports/${seedId('report:user')}/resolve`, { action: 'hide' });
      expect(onUser.statusCode).toBe(400);
      expect((await post(`/api/admin/reports/${seedId('report:user')}/resolve`, { action: 'dismiss' })).statusCode).toBe(200);
      expect((await post('/api/admin/reports/00000000-0000-4000-8000-000000000000/resolve', { action: 'hide' })).statusCode).toBe(404);
    });
  });

  describe('hiding content directly', () => {
    it('hides and shows posts, comments, questions and answers, closing open reports', async () => {
      const targets: Array<[string, string, string]> = [
        ['post', 'posts', P('feed:2')], ['comment', 'comments', seedId('comment:1')],
        ['question', 'questions', seedId('question:hostel')], ['answer', 'answers', seedId('answer:hostel1')],
      ];
      for (const [type, table, id] of targets) {
        const hidden = await post(`/api/admin/content/${type}/${id}/hide`, { reason: 'test' });
        expect(hidden.json(), type).toEqual({ hidden: true, resolved: 0 });
        expect(await one(`select hidden_at is not null as hidden, hidden_by from ${table} where id = $1`, [id])).toEqual({ hidden: true, hidden_by: U('hassan') });
        expect((await post(`/api/admin/content/${type}/${id}/unhide`)).json()).toEqual({ hidden: false, resolved: 0 });
        expect(await one(`select hidden_at, hidden_by from ${table} where id = $1`, [id])).toEqual({ hidden_at: null, hidden_by: null });
      }
      expect(await logged('content.hide')).toBe(4);
      expect((await post(`/api/admin/content/post/${P('spam')}/hide`)).json()).toEqual({ hidden: true, resolved: 3 });
    });

    it('404 for things that do not exist, 400 for types that cannot be hidden', async () => {
      expect((await post('/api/admin/content/post/00000000-0000-4000-8000-000000000000/hide')).statusCode).toBe(404);
      expect((await post(`/api/admin/content/user/${U('ivy')}/hide`)).statusCode).toBe(400);
    });
  });

  describe('members', () => {
    it('finds members by name, email or member number, with private details for admins', async () => {
      expect((await get('/api/admin/users?q=amina')).json().items[0]).toMatchObject({
        id: U('amina'), email: expect.stringMatching(/^seed\.amina@/), memberNumber: 'SEED/0001/26', isUnder18: true, suspended: null, roles: [],
      });
      expect((await get(`/api/admin/users?q=${encodeURIComponent('seed / 0003-/26')}`)).json().items.map((u: { id: string }) => u.id)).toEqual([U('cynthia')]);
      expect((await get('/api/admin/users?q=seed.grace')).json().items[0].roles).toMatchObject([{ role: 'moderator' }]);
      expect((await get(`/api/admin/users?q=${encodeURIComponent('%%')}`)).json().items).toEqual([]); // wildcards are literal
      expect((await get('/api/admin/users?q=a')).statusCode).toBe(400);
    });

    it('suspends a member, signs them out everywhere, and lifts it again', async () => {
      await client.query(`insert into sessions (user_id, token_hash, expires_at) values ($1, decode(repeat('ab', 32), 'hex'), now() + interval '30 days')`, [U('brian')]);
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const suspendsBefore = await logged('user.suspend'); // the seed already holds one
      const res = await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'Spam in groups', until });
      expect(res.json()).toMatchObject({ id: U('brian'), suspended: { until, reason: 'Spam in groups' } });
      expect((await one<{ n: number }>('select count(*)::int as n from sessions where user_id = $1 and revoked_at is null', [U('brian')])).n).toBe(0);
      expect(await logged('user.suspend')).toBe(suspendsBefore + 1);

      const lifted = await post(`/api/admin/users/${U('brian')}/unsuspend`);
      expect(lifted.json().suspended).toBeNull();
      expect((await post(`/api/admin/users/${U('ivy')}/unsuspend`)).json().suspended).toBeNull();
    });

    it('suspends without an end date until an admin lifts it', async () => {
      const res = await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'Under review' });
      expect(res.json().suspended).toMatchObject({ until: null, reason: 'Under review' });
    });

    it('refuses to suspend yourself, a past date, no reason, or someone who does not exist', async () => {
      expect((await post(`/api/admin/users/${U('hassan')}/suspend`, { reason: 'x' })).statusCode).toBe(400);
      expect((await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'x', until: '2020-01-01T00:00:00Z' })).statusCode).toBe(400);
      expect((await post(`/api/admin/users/${U('brian')}/suspend`, { until: new Date(Date.now() + 1e6).toISOString() })).statusCode).toBe(400);
      expect((await post(`/api/admin/users/${U('gone')}/suspend`, { reason: 'x' })).statusCode).toBe(404);
      expect((await post('/api/admin/users/00000000-0000-4000-8000-000000000000/suspend', { reason: 'x' })).statusCode).toBe(404);
    });
  });

  describe('roles', () => {
    it('grants a role, which then works, and ends it again', async () => {
      const granted = await post(`/api/admin/users/${U('david')}/roles`, { role: 'moderator', title: 'Moderator' });
      expect(granted.statusCode).toBe(201);
      const role = granted.json().roles.find((r: { role: string }) => r.role === 'moderator');
      as('david');
      expect((await get('/api/admin/reports')).statusCode).toBe(200);
      as('hassan');
      expect((await post(`/api/admin/users/${U('david')}/roles`, { role: 'moderator', title: 'Moderator' })).statusCode).toBe(409);
      await anHourPasses('roles');
      expect((await del(`/api/admin/roles/${role.id}`)).statusCode).toBe(204);
      expect((await del(`/api/admin/roles/${role.id}`)).statusCode).toBe(404);
      as('david');
      expect((await get('/api/admin/reports')).statusCode).toBe(403);
    });

    it('gives the Staff badge only to staff accounts, and never lets an admin remove their own admin role', async () => {
      expect((await post(`/api/admin/users/${U('brian')}/roles`, { role: 'staff' })).statusCode).toBe(400);
      expect((await post(`/api/admin/users/${U('brian')}/roles`, { role: 'student_leader', endsAt: '2020-01-01T00:00:00Z' })).statusCode).toBe(400);
      const own = await del(`/api/admin/roles/${seedId('role:hassan')}`);
      expect(own.statusCode).toBe(400);
      expect((await get('/api/admin/log')).statusCode).toBe(200); // still an admin
    });
  });

  describe('offices', () => {
    it('creates an official office, adds and removes people, and keeps names unique', async () => {
      const made = await post('/api/admin/offices', { name: '  Registrar  ', type: 'office' });
      expect(made.statusCode).toBe(201);
      const office = made.json();
      expect(office).toMatchObject({ name: 'Registrar', verified: true, members: [] });
      expect((await post('/api/admin/offices', { name: 'REGISTRAR', type: 'office' })).json().error).toBe('office_name_taken');
      expect((await post('/api/admin/offices', { name: 'X', type: 'cafe' })).statusCode).toBe(400);

      expect((await post(`/api/admin/offices/${office.id}/members`, { userId: U('felix'), role: 'owner' })).statusCode).toBe(204);
      expect((await post(`/api/admin/offices/${office.id}/members`, { userId: U('felix'), role: 'editor' })).statusCode).toBe(204); // change of role
      const listed = (await get('/api/admin/offices')).json().items.find((o: { id: string }) => o.id === office.id);
      expect(listed.members).toMatchObject([{ id: U('felix'), role: 'editor' }]);

      await anHourPasses('office_members');
      expect((await del(`/api/admin/offices/${office.id}/members/${U('felix')}`)).statusCode).toBe(204);
      expect((await del(`/api/admin/offices/${office.id}/members/${U('felix')}`)).statusCode).toBe(404);
      expect((await get('/api/admin/offices')).json().items.find((o: { id: string }) => o.id === office.id).members).toEqual([]);
      expect((await post(`/api/admin/offices/${office.id}/members`, { userId: U('felix'), role: 'owner' })).statusCode).toBe(204); // back again
      expect((await one<{ active: boolean }>('select ends_at is null as active from office_members where office_id = $1', [office.id])).active).toBe(true);

      expect((await post(`/api/admin/offices/${office.id}/members`, { userId: U('gone'), role: 'editor' })).statusCode).toBe(404);
      expect((await post('/api/admin/offices/00000000-0000-4000-8000-000000000000/members', { userId: U('felix'), role: 'editor' })).statusCode).toBe(404);
    });
  });

  describe('clubs', () => {
    it('gives and removes the CLUB badge, but never on a class group', async () => {
      const football = seedId('group:football');
      expect((await post(`/api/admin/groups/${football}/verify-club`)).json()).toEqual({ clubVerified: true });
      expect(await one('select kind, club_verified_by from groups where id = $1', [football])).toEqual({ kind: 'club', club_verified_by: U('hassan') });
      expect((await post(`/api/admin/groups/${football}/unverify-club`)).json()).toEqual({ clubVerified: false });
      const classGroup = await one<{ id: string }>(`select id from groups where auto_type = 'course_year' limit 1`);
      expect((await post(`/api/admin/groups/${classGroup.id}/verify-club`)).statusCode).toBe(400);
      expect((await post('/api/admin/groups/00000000-0000-4000-8000-000000000000/verify-club')).statusCode).toBe(404);
    });
  });

  describe('member-number disputes', () => {
    it('shows who holds the number, and releasing it frees it for its owner', async () => {
      await client.query(
        `insert into member_number_disputes (campus_id, member_number_normalised, reporter_user_id, details)
         select campus_id, 'SEED/0003/26', id, 'That is my number' from users where id = $1`, [U('brian')]);
      const items = (await get('/api/admin/disputes')).json().items;
      expect(items).toMatchObject([{ memberNumber: 'SEED/0003/26', reporter: { id: U('brian') }, holder: { id: U('cynthia'), email: expect.stringContaining('seed.cynthia@') } }]);

      const res = await post(`/api/admin/disputes/${items[0].id}/resolve`, { releaseNumber: true });
      expect(res.json()).toEqual({ status: 'resolved', numberReleased: true });
      expect(await one('select member_number, member_number_normalised, member_number_status from users where id = $1', [U('cynthia')]))
        .toEqual({ member_number: null, member_number_normalised: null, member_number_status: 'unverified' });
      expect((await post(`/api/admin/disputes/${items[0].id}/resolve`, { releaseNumber: true })).statusCode).toBe(409);
      expect((await get('/api/admin/disputes')).json().items).toEqual([]);
      expect((await get('/api/admin/disputes?status=resolved')).json().items).toHaveLength(1);
    });

    it('keeping the number changes nothing but closes the dispute', async () => {
      await client.query(
        `insert into member_number_disputes (campus_id, member_number_normalised, reporter_user_id)
         select campus_id, 'SEED/0003/26', id from users where id = $1`, [U('brian')]);
      const id = (await get('/api/admin/disputes')).json().items[0].id;
      expect((await post(`/api/admin/disputes/${id}/resolve`, { releaseNumber: false })).json()).toEqual({ status: 'resolved', numberReleased: false });
      expect((await one<{ member_number: string }>('select member_number from users where id = $1', [U('cynthia')])).member_number).toBe('SEED/0003/26');
    });
  });

  describe('the log and campus isolation', () => {
    it('records every action and pages through it newest first', async () => {
      await post(`/api/admin/content/post/${P('feed:3')}/hide`);
      await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'x' });
      const first = (await get('/api/admin/log?limit=2')).json();
      expect(first.items.map((i: { action: string }) => i.action)).toEqual(['user.suspend', 'content.hide']);
      expect(first.items[0]).toMatchObject({ targetType: 'user', targetId: U('brian'), by: { id: U('hassan') }, details: { reason: 'x' } });
      const second = (await get(`/api/admin/log?limit=2&cursor=${first.nextCursor}`)).json();
      expect(second.items).toHaveLength(2);
      expect(second.items.map((i: { id: string }) => i.id)).not.toContain(first.items[1].id);
    });

    it('an admin of another campus sees and touches nothing here', async () => {
      const other = await one<{ id: string }>(`insert into campuses (slug, name) values ('admin-test', 'Other Campus') returning id`);
      const outsider = await one<{ id: string }>(`insert into users (campus_id, email, member_type, name) values ($1, 'outsider@example.org', 'staff', 'Outsider') returning id`, [other.id]);
      await client.query(`insert into roles (user_id, role) values ($1, 'admin')`, [outsider.id]);
      signedInAs = outsider.id;
      expect((await get('/api/admin/reports')).json().items).toEqual([]);
      expect((await get('/api/admin/users?q=seed')).json().items).toEqual([]);
      expect((await get('/api/admin/offices')).json().items).toEqual([]);
      expect((await get('/api/admin/log')).json().items).toEqual([]);
      for (const res of [
        await post(`/api/admin/reports/${seedId('report:spam1')}/resolve`, { action: 'hide' }),
        await post(`/api/admin/content/post/${P('feed:1')}/hide`), await post(`/api/admin/content/comment/${seedId('comment:1')}/hide`),
        await post(`/api/admin/content/answer/${seedId('answer:id1')}/hide`),
        await post(`/api/admin/users/${U('brian')}/suspend`, { reason: 'x' }), await post(`/api/admin/users/${U('brian')}/roles`, { role: 'admin' }),
        await del(`/api/admin/roles/${seedId('role:grace')}`), await post(`/api/admin/offices/${seedId('office:library')}/members`, { userId: outsider.id, role: 'owner' }),
        await post(`/api/admin/groups/${seedId('group:football')}/verify-club`),
      ]) expect(res.statusCode).toBe(404);
      expect((await one<{ hidden: boolean }>('select hidden_at is not null as hidden from posts where id = $1', [P('feed:1')])).hidden).toBe(false);
    });
  });
});
