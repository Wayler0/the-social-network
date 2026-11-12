/**
 * Tiny migration runner: applies migrations/*.sql in name order, each in its own transaction,
 * and records them in schema_migrations. Never edit a migration that has been applied —
 * add a new file (002_..., 003_...).
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { loadConfig } from './config.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main() {
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    // One runner at a time, even if two containers start together.
    await client.query('select pg_advisory_lock(727274)');
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        console.log(`applied ${file}`);
        applied++;
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
    console.log(applied ? `done: ${applied} migration(s) applied` : 'done: database is up to date');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
