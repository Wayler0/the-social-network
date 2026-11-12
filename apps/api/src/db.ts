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
