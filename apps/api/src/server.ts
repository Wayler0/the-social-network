import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';

const config = loadConfig();
const db = createDb(config);
const app = buildApp(config, db);

async function shutdown(signal: string) {
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
