import { z } from 'zod';

/** All settings come from environment variables (see .env.example). Fails fast on bad config. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  /** Placeholder name: shown in emails and API info. Change here, not in code. */
  APP_NAME: z.string().min(1).default('Hatua'),
  /** Public address of the web app, e.g. https://hatua.nextup.co.ke */
  APP_URL: z.string().url().default('http://localhost:5180'),
  /** Small on purpose: the server is shared and short on memory. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration — ${problems}`);
  }
  return parsed.data;
}
