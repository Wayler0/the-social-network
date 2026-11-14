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

/** Ask a Senior against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const Q = (key: string) => seedId(`question:${key}`);
const A = (key: string) => seedId(`answer:${key}`);

describe.skipIf(!url)('Ask a Senior (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-ask-'));
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
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.12.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const list = async (who: string, query = '') => (await as(who, 'GET', `/api/questions${query}`)).json();
  const one = async (who: string, id: string) => (await as(who, 'GET', `/api/questions/${id}`)).json();

  describe('hidden names', () => {
    it('are hidden from other students, staff and alumni', async () => {
      for (const who of ['cynthia', 'felix', 'esther']) {
        const q = await one(who, Q('id'));
        expect([q.author, q.nameHidden, q.isMine], who).toEqual([null, true, false]);
        expect(JSON.stringify(q), who).not.toContain(U('amina'));
      }
    });

    it('are shown to the asker, moderators and admins', async () => {
      expect((await one('amina', Q('id'))).author).toMatchObject({ id: U('amina') });
      expect((await one('amina', Q('id'))).isMine).toBe(true);
      for (const who of ['grace', 'hassan']) expect((await one(who, Q('id'))).author, who).toMatchObject({ id: U('amina') });
    });

    it('stay hidden in lists and search too', async () => {
      const item = (await list('cynthia', '?limit=50')).items.find((q: { id: string }) => q.id === Q('id'));
      expect(item.author).toBeNull();
      expect(JSON.stringify(await list('cynthia', '?q=student%20ID'))).not.toContain(U('amina'));
    });

    it('an anonymous asker answering their own question does not give themselves away', async () => {
      await as('brian', 'POST', `/api/questions/${Q('open')}/answers`, { body: 'Update: it got better after week three.' });
      const answer = (await one('cynthia', Q('open'))).answers[0];
      expect(answer).toMatchObject({ author: null, byAsker: true });
      expect((await one('brian', Q('open'))).answers[0]).toMatchObject({ author: { id: U('brian') }, byAsker: true, isMine: true });
    });

    it('a visible name is shown to everyone', async () => {
      expect((await one('felix', Q('hostel'))).author).toMatchObject({ id: U('brian'), name: expect.any(String) });
    });
  });

  describe('listing and search', () => {
    it('lists visible questions newest first with answer counts', async () => {
      const { items } = await list('cynthia');
      expect(items.map((q: { id: string }) => q.id)).toEqual([Q('open'), Q('id'), Q('hostel'), Q('units')]);   // not the hidden one
      expect(items.find((q: { id: string }) => q.id === Q('units')).answerCount).toBe(2);
    });

    it('searches questions and their answers', async () => {
      const ids = async (q: string) => (await list('cynthia', `?q=${encodeURIComponent(q)}`)).items.map((x: { id: string }) => x.id);
      expect(await ids('hostels library')).toEqual([Q('hostel')]);              // in the question
      expect(await ids('dining hall')).toEqual([Q('hostel')]);                  // only in an answer
      expect(await ids('registering units')).toEqual([Q('units')]);             // stemmed: "register" matches
      expect(await ids('moderator')).toEqual([]);                               // the hidden question is never found
      expect((await list('cynthia', '?q=a')).error).toBe('invalid_input');
    });

    it('pages with cursors', async () => {
      const first = await list('cynthia', '?limit=2');
      const second = await list('cynthia', `?limit=2&cursor=${first.nextCursor}`);
      expect([...first.items, ...second.items].map((q: { id: string }) => q.id)).toEqual([Q('open'), Q('id'), Q('hostel'), Q('units')]);
    });

    it('hides questions and answers between members who blocked each other', async () => {
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('cynthia'), U('felix')]);
      expect((await one('cynthia', Q('units'))).answers.map((a: { id: string }) => a.id)).toEqual([A('units1')]);
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('brian'), U('cynthia')]);
      expect((await as('cynthia', 'GET', `/api/questions/${Q('hostel')}`)).statusCode).toBe(404);
    });
  });

  describe('asking', () => {
    it('asks, optionally hiding the name', async () => {
      const res = await as('amina', 'POST', '/api/questions', { body: '  Where is the health centre?  ', hideName: true });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ body: 'Where is the health centre?', nameHidden: true, isMine: true, answerCount: 0, author: { id: U('amina') } });
      expect((await one('cynthia', res.json().id)).author).toBeNull();
    });

    it('needs a finished profile and valid input; 10 an hour', async () => {
      expect((await as('newbie', 'POST', '/api/questions', { body: 'hi' })).json().error).toBe('profile_incomplete');
      for (const body of [{ body: ' ' }, { body: 'x'.repeat(2001) }, { body: 'hi', hideName: 'yes' }, { body: 'hi', userId: U('hassan') }]) {
        expect((await as('amina', 'POST', '/api/questions', body)).json().error).toBe('invalid_input');
      }
      await client.query(`insert into rate_limit_events (bucket, key) select 'question_user', $1 from generate_series(1, 10)`, [U('amina')]);
      expect((await as('amina', 'POST', '/api/questions', { body: 'one more' })).json().error).toBe('rate_limited');
    });
  });

  describe('answers and helpful', () => {
    it('lists answers most helpful first, then oldest', async () => {
      // id1 has 2 helpful votes, id2 has 1.
      const q = await one('cynthia', Q('id'));
      expect(q.answers.map((a: { id: string; helpfulCount: number }) => [a.id, a.helpfulCount])).toEqual([[A('id1'), 2], [A('id2'), 1]]);
      expect(q.answers[0]).toMatchObject({ author: { id: U('cynthia') }, isMine: true, helpfulByMe: false, byAsker: false });
    });

    it('answers a question', async () => {
      const res = await as('esther', 'POST', `/api/questions/${Q('open')}/answers`, { body: 'Yes. Find a study group in your class.' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ body: 'Yes. Find a study group in your class.', author: { id: U('esther') }, helpfulCount: 0, isMine: true });
      expect((await one('amina', Q('open'))).answerCount).toBe(1);
      expect((await as('esther', 'POST', `/api/questions/${Q('hidden')}/answers`, { body: 'x' })).statusCode).toBe(404);
      expect((await as('esther', 'POST', `/api/questions/${randomUUID()}/answers`, { body: 'x' })).statusCode).toBe(404);
      expect((await as('newbie', 'POST', `/api/questions/${Q('open')}/answers`, { body: 'x' })).json().error).toBe('profile_incomplete');
    });

    it('helpful is idempotent, can be undone, and is not for your own answer', async () => {
      expect((await as('felix', 'PUT', `/api/answers/${A('id2')}/helpful`)).json()).toEqual({ helpful: true, helpfulCount: 2 });
      expect((await as('felix', 'PUT', `/api/answers/${A('id2')}/helpful`)).json()).toEqual({ helpful: true, helpfulCount: 2 });
      expect((await one('felix', Q('id'))).answers.find((a: { id: string }) => a.id === A('id2')).helpfulByMe).toBe(true);
      expect((await as('felix', 'DELETE', `/api/answers/${A('id2')}/helpful`)).json()).toEqual({ helpful: false, helpfulCount: 1 });
      expect((await as('esther', 'PUT', `/api/answers/${A('id2')}/helpful`)).json().error).toBe('invalid_input');   // esther wrote it
      expect((await as('felix', 'PUT', `/api/answers/${randomUUID()}/helpful`)).statusCode).toBe(404);
    });
  });
});
