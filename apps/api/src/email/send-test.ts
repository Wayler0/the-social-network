/**
 * Sends one real sign-in email with the current settings, to prove delivery works:
 *
 *   npm run email:test -w apps/api -- you@your-campus-domain
 *
 * Use it after setting EMAIL_MODE=smtp, and for the deliverability test in docs/email.md
 * (does the email arrive, how fast, inbox or spam?). The code it sends is not a real sign-in code.
 */
import { loadConfig } from '../config.js';
import { createMailer, maskEmail } from './mailer.js';

const to = process.argv[2];
if (!to || process.argv.length > 3) {
  console.error('Usage: npm run email:test -w apps/api -- someone@example.org');
  process.exit(2);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}
const print = (level: string) => (details: object, message: string) => console.log(`[${level}] ${message}`, JSON.stringify(details));
const mailer = createMailer(config, { info: print('info'), warn: print('warn'), error: print('error') });

const started = Date.now();
try {
  const health = await mailer.check();
  console.log(`Mail server: ${health.ok ? 'OK' : 'PROBLEM'} — ${health.detail}`);
  if (!health.ok && config.EMAIL_MODE === 'smtp') process.exitCode = 1;
  else {
    await mailer.sendSignInCode(to.trim().toLowerCase(), '000000');
    console.log(`Done in ${Date.now() - started} ms. ${config.EMAIL_MODE === 'smtp' ? `Now check the inbox (and spam folder) of ${maskEmail(to)}.` : 'EMAIL_MODE=log, so nothing was really sent.'}`);
  }
} catch (err) {
  console.error(`Failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await mailer.close();
}
