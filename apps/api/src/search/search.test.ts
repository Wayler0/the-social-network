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
import { likePattern } from './routes.js';

/** Search, against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const G = (key: string) => seedId(`group:${key}`);

type Result = { people: Array<Record<string, unknown>>; groups: Array<{ id: string }>; posts: Array<{ id: string; body: string }>; questions: Array<Record<string, unknown>> };

it('escapes LIKE wildcards', () => {
  expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
});

describe.skipIf(!url)('Search (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-search-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await client.query('delete from follows'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function get(who: string, q: string, type = 'all') {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.14.0.1' }); tokens.set(who, token); }
    return app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}&type=${type}`, cookies: { hatua_session: token } });
  }
  const search = async (who: string, q: string, type = 'all') => (await get(who, q, type)).json() as Result;
  const ids = (r: Array<{ id?: unknown }>) => r.map((x) => x.id);

  it('needs a signed-in member and at least 2 characters', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/search?q=cynthia' })).statusCode).toBe(401);
    expect((await get('cynthia', 'a')).statusCode).toBe(400);
  });

  it('finds people by name, never by email or registration number, without private fields', async () => {
    const r = await search('cynthia', 'kiprop');
    expect(ids(r.people)).toContain(U('david'));
    const david = r.people.find((p) => p.id === U('david'))!;
    expect(Object.keys(david)).not.toEqual(expect.arrayContaining(['email']));
    expect(JSON.stringify(r)).not.toMatch(/@|memberNumber|member_number/);
    expect((await search('cynthia', 'seed.david')).people).toEqual([]);
  });

  it('shows an under-18 member only to classmates or people they follow back', async () => {
    expect(ids((await search('david', 'amina')).people)).not.toContain(U('amina'));   // not her class
    expect(ids((await search('felix', 'amina')).people)).not.toContain(U('amina'));   // staff
    await client.query(`update users set course = 'BSc Computer Science', year_of_study = 1 where id = $1`, [U('david')]);
    expect(ids((await search('david', 'amina')).people)).toContain(U('amina'));       // now a classmate
    await client.query(`insert into follows (follower_id, target_type, target_id) values ($1, 'user', $2)`, [U('amina'), U('felix')]);
    expect(ids((await search('felix', 'amina')).people)).toContain(U('amina'));       // she follows him
  });

  it('leaves out blocked and deleted members', async () => {
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('david'), U('cynthia')]);
    expect(ids((await search('cynthia', 'kiprop')).people)).not.toContain(U('david'));
    expect((await search('cynthia', 'gone')).people.filter((p) => p.id === U('gone'))).toEqual([]);
  });

  it('never shows student-only groups to staff', async () => {
    expect(ids((await search('cynthia', 'study buddies')).groups)).toContain(G('study'));
    expect(ids((await search('felix', 'study buddies')).groups)).not.toContain(G('study'));
  });

  it('finds visible posts only, and hidden ones never', async () => {
    const { rows } = await client.query<{ id: string; body: string }>(
      `select id, body from posts where group_id is null and hidden_at is null and deleted_at is null and author_user_id <> $1 and length(body) > 10 limit 1`, [U('cynthia')]);
    const word = rows[0]!.body.split(/\s+/).find((w) => w.length > 4)!;
    expect(ids((await search('cynthia', word, 'posts')).posts)).toContain(rows[0]!.id);
    await client.query('update posts set hidden_at = now() where id = $1', [rows[0]!.id]);
    expect(ids((await search('cynthia', word, 'posts')).posts)).not.toContain(rows[0]!.id);
  });

  it('finds questions without saying who asked', async () => {
    const { rows } = await client.query<{ body: string }>('select body from questions where hidden_at is null and deleted_at is null limit 1');
    if (!rows[0]) return;
    const word = rows[0].body.split(/\s+/).find((w) => w.length > 4)!;
    const r = await search('brian', word, 'questions');
    expect(r.questions.length).toBeGreaterThan(0);
    expect(Object.keys(r.questions[0]!).sort()).toEqual(['answerCount', 'body', 'createdAt', 'id']);
  });
});
