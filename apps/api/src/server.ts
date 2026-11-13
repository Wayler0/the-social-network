import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { cleanupImages } from './images/store.js';

const config = loadConfig();
const db = createDb(config);
const app = buildApp(config, db);

// Housekeeping: remove images nobody attached within 24 h (docs/api-contract.md section 6).
const HOUR = 60 * 60 * 1000;
const housekeeping = setInterval(() => {
  cleanupImages(db, config.MEDIA_DIR)
    .then((removed) => removed && app.log.info({ removed }, 'unattached images removed'))
    .catch((err) => app.log.error(err, 'image cleanup failed'));
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

app.listen({ host: config.HOST, port: config.PORT }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
