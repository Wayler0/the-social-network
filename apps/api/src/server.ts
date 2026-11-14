import { buildApp } from './app.js';
import { cleanupAnnouncements } from './announcements/routes.js';
import { cleanupAuth } from './auth/routes.js';
import { cleanupGroups } from './groups/routes.js';
import { cleanupPosts } from './posts/routes.js';
import { cleanupQuestions } from './questions/routes.js';
import { cleanupSafety } from './safety/routes.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { cleanupImages } from './images/store.js';

const config = loadConfig();
const db = createDb(config);
const app = buildApp(config, db);

// Housekeeping: remove images nobody attached within 24 h (docs/api-contract.md section 6),
// and sign-in codes and their rate-limit counts after a day (section 3).
const HOUR = 60 * 60 * 1000;
const housekeeping = setInterval(() => {
  cleanupImages(db, config.MEDIA_DIR)
    .then((removed) => removed && app.log.info({ removed }, 'unattached images removed'))
    .catch((err) => app.log.error(err, 'image cleanup failed'));
  cleanupAuth(db)
    .then((removed) => removed && app.log.info({ removed }, 'old sign-in codes removed'))
    .catch((err) => app.log.error(err, 'sign-in cleanup failed'));
  cleanupPosts(db).catch((err) => app.log.error(err, 'post rate-limit cleanup failed'));
  cleanupSafety(db).catch((err) => app.log.error(err, 'report rate-limit cleanup failed'));
  cleanupGroups(db).catch((err) => app.log.error(err, 'group rate-limit cleanup failed'));
  cleanupAnnouncements(db).catch((err) => app.log.error(err, 'announcement rate-limit cleanup failed'));
  cleanupQuestions(db).catch((err) => app.log.error(err, 'question rate-limit cleanup failed'));
}, HOUR);
housekeeping.unref();

async function shutdown(signal: string) {
  clearInterval(housekeeping);
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

app
  .listen({ host: config.HOST, port: config.PORT })
  .then(async () => {
    // Say at start-up whether sign-in emails can go out, instead of finding out from the first member.
    const mail = await app.mailer.check();
    if (mail.ok) app.log.info({ mail: mail.detail }, 'email ready');
    else app.log.error({ mail: mail.detail }, 'EMAIL IS NOT WORKING: nobody can sign in until this is fixed (docs/email.md)');
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
