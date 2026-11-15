/**
 * Makes a member an admin from the server's command line. This is how a campus gets its first
 * admin (after that, admins grant roles in the app):
 *
 *   npm run admin:grant -w apps/api -- someone@campus-domain          (development)
 *   docker compose --profile server exec api node dist/admin/grant-admin.js someone@campus-domain
 *
 * The person must have signed in once already, so their account exists. Recorded in the admin log.
 */
import pg from 'pg';
import { loadConfig } from '../config.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length > 3) {
  console.error('Usage: admin:grant <email of a member who has already signed in>');
  process.exit(2);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

const db = new pg.Client({ connectionString: config.DATABASE_URL });
await db.connect();
try {
  await db.query('begin');
  const found = await db.query<{ id: string; campus_id: string; name: string | null; suspended_at: Date | null; already: boolean }>(
    `select u.id, u.campus_id, u.name, u.suspended_at,
            exists (select 1 from roles r where r.user_id = u.id and r.role = 'admin'
                     and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())) as already
       from users u where u.email = $1 and u.deleted_at is null`,
    [email],
  );
  const user = found.rows[0];
  if (!user) throw new Error(`No member with the email ${email}. They must sign in to the app once first.`);
  if (user.already) {
    console.log(`${user.name ?? email} is already an admin. Nothing changed.`);
  } else {
    await db.query(`insert into roles (user_id, role, title) values ($1, 'admin', 'Admin')`, [user.id]);
    await db.query(
      `insert into admin_log (campus_id, admin_user_id, action, target_type, target_id, details)
       values ($1, null, 'role.grant', 'user', $2, $3)`,
      [user.campus_id, user.id, JSON.stringify({ role: 'admin', via: 'server command line' })],
    );
    console.log(`${user.name ?? email} is now an admin.${user.suspended_at ? ' Note: this account is suspended, so the role has no effect until that is lifted.' : ''}`);
  }
  await db.query('commit');
} catch (err) {
  await db.query('rollback').catch(() => {});
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
