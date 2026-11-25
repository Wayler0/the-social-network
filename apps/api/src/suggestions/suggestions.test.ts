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

/** Who to follow, against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const G = (key: string) => seedId(`group:${key}`);

describe.skipIf(!url)('Suggestions (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-suggest-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => {
    await client.query('begin');
    // Only the seed's people and follows, so other data in the database can't change the answers.
    await client.query('delete from follows');
    await seed(client, { mediaDir });
    tokens.clear();
  });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: 'GET' | 'PUT', url: string) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.13.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token } });
  }
  const suggest = async (who: string) => (await as(who, 'GET', '/api/suggestions')).json() as {
    people: Array<{ id: string; reason: string; mutualCount: number; [k: string]: unknown }>;
    clubs: Array<{ id: string; [k: string]: unknown }>;
  };
  const seedOnly = (ids: string[]) => ids.filter((id) => Object.values(KEYS).includes(id));
  const KEYS = Object.fromEntries(['amina', 'brian', 'cynthia', 'david', 'esther', 'felix', 'grace', 'hassan', 'ivy', 'newbie', 'gone'].map((k) => [k, U(k)]));

  it('suggests course-mates first with a reason, never yourself, private fields, suspended, deleted or unfinished members', async () => {
    const res = await as('cynthia', 'GET', '/api/suggestions');
    expect(res.statusCode).toBe(200);
    const { people } = res.json() as { people: Array<Record<string, unknown>> };
    const ids = seedOnly(people.map((p) => p.id as string));
    // Same course (BSc Computer Science): hassan, esther. Staff felix too. Not amina (under 18, not her class).
    expect(ids.slice(0, 2).sort()).toEqual([U('hassan'), U('esther')].sort());
    expect(ids).toContain(U('felix'));
    for (const k of ['cynthia', 'amina', 'ivy', 'newbie', 'gone']) expect(ids, k).not.toContain(U(k));
    expect(people.find((p) => p.id === U('hassan'))).toMatchObject({ reason: 'Same course', name: expect.any(String) });
    expect(JSON.stringify(people)).not.toMatch(/@|memberNumber|email|isUnder18|hostel/i);
  });

  it('under-18 members are suggested only to their classmates; staff are never shown students', async () => {
    // A classmate for amina (under 18): another BSc Computer Science year-1 fresher.
    await client.query(`update users set course = 'bsc  computer science', year_of_study = 1, member_type = 'fresher' where id = $1`, [U('hassan')]);
    expect(seedOnly((await suggest('hassan')).people.map((p) => p.id))).toContain(U('amina'));
    expect((await suggest('hassan')).people.find((p) => p.id === U('amina'))?.reason).toBe('Same class');
    expect(seedOnly((await suggest('cynthia')).people.map((p) => p.id))).not.toContain(U('amina'));   // same course, other year
    const staffSees = seedOnly((await suggest('felix')).people.map((p) => p.id));
    for (const k of ['amina', 'brian', 'cynthia', 'david', 'grace', 'hassan']) expect(staffSees, k).not.toContain(U(k));
  });

  it('drops people you follow or have a block with; counts mutual follows', async () => {
    await as('cynthia', 'PUT', `/api/follows/user/${U('hassan')}`);
    await client.query(`insert into follows (follower_id, target_type, target_id) values ($1, 'user', $2)`, [U('hassan'), U('grace')]);
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('esther'), U('cynthia')]);
    const s = await suggest('cynthia');
    const ids = seedOnly(s.people.map((p) => p.id));
    expect(ids).not.toContain(U('hassan'));   // already followed
    expect(ids).not.toContain(U('esther'));   // blocked
    expect(s.people.find((p) => p.id === U('grace'))).toMatchObject({ mutualCount: 1, reason: '1 mutual' });   // other course, followed by hassan
  });

  it('suggests public clubs you are not in or following', async () => {
    const before = (await suggest('brian')).clubs.map((c) => c.id);
    expect(before).toContain(G('chess'));
    await as('brian', 'PUT', `/api/follows/group/${G('chess')}`);
    expect((await suggest('brian')).clubs.map((c) => c.id)).not.toContain(G('chess'));
  });
});
