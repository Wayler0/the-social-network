import type pg from 'pg';
import type { Db } from '../db.js';

/**
 * For database tests: a stand-in pool that keeps every query on the test's one connection, so the
 * whole test can be rolled back. The API's own transactions become savepoints inside it.
 * Not used by the app itself.
 */
export function rollbackPool(client: pg.Client): Db {
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
