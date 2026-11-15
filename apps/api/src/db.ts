import pg from 'pg';
import type { Config } from './config.js';

export type Db = pg.Pool;

export function createDb(config: Config): Db {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Runs `work` in one transaction: commit if it finishes, roll back if it throws.
 * Use it whenever several statements must succeed or fail together.
 */
export async function inTransaction<T>(db: Db, work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const tx = await db.connect();
  try {
    await tx.query('begin');
    const result = await work(tx);
    await tx.query('commit');
    return result;
  } catch (err) {
    await tx.query('rollback').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}
