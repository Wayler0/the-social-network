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

/** Events against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const O = (key: string) => seedId(`office:${key}`);
const G = (key: string) => seedId(`group:${key}`);
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe.skipIf(!url)('Events (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-events-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.14.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const create = async (who: string, payload: object = {}) => {
    const res = await as(who, 'POST', '/api/events', { title: 'Hackathon', startsAt: inHours(48), ...payload });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const upcomingIds = async (who: string, query = '') =>
    ((await as(who, 'GET', `/api/events${query}`)).json().items as Array<{ id: string }>).map((e) => e.id);

  it('creates a campus event everyone sees, with the host able to manage it', async () => {
    const e = await create('brian', { title: '  Career   fair ', description: ' Bring CVs. ', location: 'Main hall', endsAt: inHours(52) });
    expect(e).toMatchObject({
      title: 'Career fair', description: 'Bring CVs.', location: 'Main hall', cancelled: false, office: null, group: null,
      createdBy: { id: U('brian') }, goingCount: 0, interestedCount: 0, myRsvp: null, canManage: true,
    });
    expect(await upcomingIds('felix')).toContain(e.id);
    expect((await as('felix', 'GET', `/api/events/${e.id}`)).json().canManage).toBe(false);
  });

  it('validates times, hosts and profiles', async () => {
    for (const payload of [{ startsAt: inHours(-5) }, { startsAt: inHours(24 * 400) }, { startsAt: inHours(5), endsAt: inHours(4) },
      { startsAt: 'tomorrow' }, { title: '' }, { officeId: O('dean'), groupId: G('chess') }]) {
      const res = await as('brian', 'POST', '/api/events', { title: 'x', startsAt: inHours(5), ...payload });
      expect(res.json().error, JSON.stringify(payload)).toBe('invalid_input');
    }
    expect((await as('brian', 'POST', '/api/events', { title: 'x', startsAt: inHours(5), officeId: O('dean') })).statusCode).toBe(403);
    expect((await as('amina', 'POST', '/api/events', { title: 'x', startsAt: inHours(5), groupId: G('chess') })).statusCode).toBe(403);   // club: admins
    expect((await as('cynthia', 'POST', '/api/events', { title: 'x', startsAt: inHours(5), groupId: G('football') })).statusCode).toBe(403); // not a member
    expect((await as('felix', 'POST', '/api/events', { title: 'x', startsAt: inHours(5), groupId: G('study') })).statusCode).toBe(404);
    expect((await as('newbie', 'POST', '/api/events', { title: 'x', startsAt: inHours(5) })).json().error).toBe('profile_incomplete');
    const office = await create('felix', { officeId: O('dean') });
    expect(office.office).toMatchObject({ id: O('dean'), verified: true });
  });

  it('group events for members; a public club\'s events for everyone who may see the club', async () => {
    const football = await create('david', { groupId: G('football') });
    const chess = await create('cynthia', { groupId: G('chess') });
    expect(await upcomingIds('hassan')).toEqual(expect.arrayContaining([football.id, chess.id]));   // football member; chess is a public club
    expect(await upcomingIds('cynthia')).not.toContain(football.id);
    expect((await as('cynthia', 'GET', `/api/events/${football.id}`)).statusCode).toBe(404);
    expect(await upcomingIds('felix', `?groupId=${G('chess')}`)).toEqual([chess.id]);
    const study = await create('grace', { groupId: G('study') });
    expect(await upcomingIds('felix')).not.toContain(study.id);                                     // staff never see student-only groups
  });

  it('upcoming soonest first and past latest first, paged; blocks hide events', async () => {
    const later = await create('brian', { startsAt: inHours(72) });
    const soon = await create('brian', { startsAt: inHours(2) });
    const mid = await create('david', { startsAt: inHours(24) });
    const first = (await as('esther', 'GET', '/api/events?limit=2')).json();
    expect(first.items.map((e: { id: string }) => e.id)).toEqual([soon.id, mid.id]);
    const second = (await as('esther', 'GET', `/api/events?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items.map((e: { id: string }) => e.id)).toEqual([later.id]);

    await client.query(`update events set starts_at = now() - interval '3 days' where id = $1`, [mid.id]);
    await client.query(`update events set starts_at = now() - interval '2 days' where id = $1`, [soon.id]);
    expect(await upcomingIds('esther', '?when=past')).toEqual([soon.id, mid.id]);
    expect(await upcomingIds('esther')).toEqual([later.id]);

    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('esther'), U('brian')]);
    expect(await upcomingIds('esther')).toEqual([]);
  });

  it('going / interested: one answer each, counts, my events, attendees', async () => {
    const e = await create('brian');
    expect((await as('amina', 'PUT', `/api/events/${e.id}/rsvp`, { status: 'going' })).json()).toEqual({ myRsvp: 'going', goingCount: 1, interestedCount: 0 });
    expect((await as('esther', 'PUT', `/api/events/${e.id}/rsvp`, { status: 'interested' })).json()).toEqual({ myRsvp: 'interested', goingCount: 1, interestedCount: 1 });
    expect((await as('amina', 'PUT', `/api/events/${e.id}/rsvp`, { status: 'interested' })).json()).toEqual({ myRsvp: 'interested', goingCount: 0, interestedCount: 2 });
    expect((await as('amina', 'GET', '/api/me/events')).json().items.map((x: { id: string }) => x.id)).toEqual([e.id]);
    expect((await as('brian', 'GET', `/api/events/${e.id}/attendees?status=interested`)).json().items.map((x: { id: string }) => x.id).sort())
      .toEqual([U('esther'), U('amina')].sort());   // same now() in one test transaction: order not fixed
    expect((await as('amina', 'DELETE', `/api/events/${e.id}/rsvp`)).json()).toEqual({ myRsvp: null, goingCount: 0, interestedCount: 1 });
    expect((await as('amina', 'GET', '/api/me/events')).json().items).toEqual([]);
    expect((await as('amina', 'PUT', `/api/events/${e.id}/rsvp`, { status: 'maybe' })).json().error).toBe('invalid_input');
    expect((await as('amina', 'PUT', `/api/events/${randomUUID()}/rsvp`, { status: 'going' })).statusCode).toBe(404);
  });

  it('the host edits or cancels; nobody can answer a cancelled or finished event', async () => {
    const e = await create('brian', { location: 'Room 4' });
    expect((await as('david', 'PATCH', `/api/events/${e.id}`, { title: 'Mine now' })).statusCode).toBe(403);
    const edited = (await as('brian', 'PATCH', `/api/events/${e.id}`, { location: null, title: 'Moved online' })).json();
    expect(edited).toMatchObject({ title: 'Moved online', location: null });
    expect((await as('brian', 'PATCH', `/api/events/${e.id}`, { endsAt: inHours(1) })).json().error).toBe('invalid_input');
    expect((await as('brian', 'PATCH', `/api/events/${e.id}`, { cancelled: true })).json().cancelled).toBe(true);
    expect((await as('amina', 'PUT', `/api/events/${e.id}/rsvp`, { status: 'going' })).json().error).toBe('event_cancelled');
    expect(await upcomingIds('amina')).toContain(e.id);   // still listed, marked cancelled

    const over = await create('brian');
    await client.query(`update events set starts_at = now() - interval '2 hours' where id = $1`, [over.id]);
    expect((await as('amina', 'PUT', `/api/events/${over.id}/rsvp`, { status: 'going' })).json().error).toBe('event_over');
  });

  it('a club\'s admins manage its events; delete by host or admin', async () => {
    const e = await create('cynthia', { groupId: G('chess') });
    await client.query(`insert into group_members (group_id, user_id, role) values ($1, $2, 'admin')`, [G('chess'), U('david')]);
    expect((await as('david', 'GET', `/api/events/${e.id}`)).json().canManage).toBe(true);
    expect((await as('amina', 'DELETE', `/api/events/${e.id}`)).statusCode).toBe(403);
    expect((await as('david', 'DELETE', `/api/events/${e.id}`)).statusCode).toBe(204);
    expect((await as('amina', 'GET', `/api/events/${e.id}`)).statusCode).toBe(404);
    const other = await create('brian');
    expect((await as('hassan', 'DELETE', `/api/events/${other.id}`)).statusCode).toBe(204);   // hassan is an admin
  });

  it('reports: three hide an event; moderators see title and description', async () => {
    const e = await create('brian', { title: 'Free money', description: 'Send 500 to join.' });
    for (const who of ['amina', 'cynthia', 'david']) {
      expect((await as(who, 'POST', '/api/reports', { targetType: 'event', targetId: e.id, reason: 'spam' })).statusCode).toBe(202);
    }
    expect((await as('esther', 'GET', `/api/events/${e.id}`)).statusCode).toBe(404);
    const item = (await as('grace', 'GET', '/api/admin/reports')).json().items.find((r: { targetId: string }) => r.targetId === e.id);
    expect(item.target).toMatchObject({ body: 'Free money\nSend 500 to join.', autoHidden: true });
  });

  it('account deletion removes RSVPs; the export lists events and answers', async () => {
    const e = await create('brian');
    await as('amina', 'PUT', `/api/events/${e.id}/rsvp`, { status: 'going' });
    const data = (await as('brian', 'GET', '/api/me/export')).json();
    expect(data.events).toEqual([expect.objectContaining({ id: e.id, title: 'Hackathon' })]);
    expect((await as('amina', 'GET', '/api/me/export')).json().eventRsvps).toEqual([{ eventId: e.id, title: 'Hackathon', status: 'going', since: expect.any(String) }]);
    expect((await as('amina', 'DELETE', '/api/me', { confirm: 'DELETE' })).statusCode).toBe(204);
    expect((await as('brian', 'GET', `/api/events/${e.id}`)).json().goingCount).toBe(0);
  });
});
