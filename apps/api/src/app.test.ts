import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import type { Db } from './db.js';

const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://u:p@localhost:5432/test' });

/** A stand-in database: answers each query with the rows given, or throws. */
function fakeDb(handler: (sql: string) => unknown[]): Db {
  return { query: async (sql: string) => ({ rows: handler(sql) }) } as unknown as Db;
}

describe('GET /api/health', () => {
  it('is ok when the database answers', async () => {
    const app = buildApp(config, fakeDb(() => [{ '?column?': 1 }]));
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, name: 'Hatua', db: 'up' });
  });
  it('is 503 when the database is down', async () => {
    const app = buildApp(config, fakeDb(() => { throw new Error('down'); }));
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, db: 'down' });
  });
});

describe('GET /api/campuses', () => {
  it('groups email domains by campus', async () => {
    const app = buildApp(config, fakeDb(() => [
      { slug: 'tharaka', name: 'Tharaka University', domain: 'student.tharaka.ac.ke', member_type: 'student' },
      { slug: 'tharaka', name: 'Tharaka University', domain: 'tharaka.ac.ke', member_type: 'staff' },
    ]));
    const res = await app.inject({ method: 'GET', url: '/api/campuses' });
    expect(res.json()).toEqual({
      campuses: [{
        slug: 'tharaka', name: 'Tharaka University',
        emailDomains: { 'student.tharaka.ac.ke': 'student', 'tharaka.ac.ke': 'staff' },
      }],
    });
  });
});

describe('config', () => {
  it('rejects a missing database url', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });
});
