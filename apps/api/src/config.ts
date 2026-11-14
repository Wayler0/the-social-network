import { z } from 'zod';

/** An on/off setting written as 'true' or 'false'. Empty means the default. */
const flag = (fallback: boolean) =>
  z.enum(['true', 'false', '']).optional().transform((v) => (v === undefined || v === '' ? fallback : v === 'true'));

/** Docker Compose passes unset variables as empty text; treat that the same as "not set". */
const blankIsUnset = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (v === '' ? undefined : v), inner);

/** The bare address inside "Name <address@domain>" (or the whole value), or null if it is not an address. */
export function senderAddress(from: string): string | null {
  const address = (/<([^<>]+)>\s*$/.exec(from)?.[1] ?? from).trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address) ? address : null;
}

/** Used only in development and tests. Production refuses to start with it (see CODE_PEPPER). */
export const DEV_CODE_PEPPER = 'dev-only-pepper-never-use-in-production-0000';

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
  // ---- Sign-in (docs/api-contract.md section 3)
  /**
   * Secret key for hashing sign-in codes: code_hash = HMAC-SHA256(CODE_PEPPER, email:code).
   * A leaked database alone then cannot be used to test the million possible codes.
   * Generate with: openssl rand -base64 48. Changing it invalidates codes in flight (10 minutes' worth), nothing else.
   */
  CODE_PEPPER: blankIsUnset(z.string().min(32, 'must be at least 32 characters').default(DEV_CODE_PEPPER)),
  /** Name of the session cookie. Lower-case letters, digits and _ only. */
  SESSION_COOKIE: blankIsUnset(z.string().regex(/^[a-z0-9_]{1,40}$/, 'use a-z, 0-9 and _ only').default('hatua_session')),
  /** Small on purpose: the server is shared and short on memory. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  /** Folder where uploaded images are kept (docs/api-contract.md section 6). Must be writable and backed up. */
  MEDIA_DIR: z.string().min(1).default('media'),
  /** Largest upload accepted, in bytes (8 MB). */
  IMAGE_MAX_BYTES: z.coerce.number().int().min(1024).max(26_214_400).default(8_388_608),
  /** Uploads one member may make per hour. */
  IMAGE_UPLOADS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(30),

  // ---- Email (sign-in codes). See docs/email.md.
  /** 'log' prints emails to the console (development only). 'smtp' sends them through SMTP_HOST. */
  EMAIL_MODE: blankIsUnset(z.enum(['log', 'smtp']).default('log')),
  /** Sender shown to members, e.g. "Hatua <no-reply@example.org>". Required for smtp. */
  EMAIL_FROM: blankIsUnset(z.string().trim().max(200).regex(/^[^\r\n]*$/, 'must be one line').optional()),
  SMTP_HOST: blankIsUnset(z.string().trim().min(1).optional()),
  SMTP_PORT: blankIsUnset(z.coerce.number().int().min(1).max(65535).default(587)),
  /** 'true' for port 465 (TLS from the first byte). Port 587 and 25 upgrade with STARTTLS instead. */
  SMTP_SECURE: flag(false),
  /** Refuse to send unless the connection is encrypted. Turn off only for a relay on the same private network. */
  SMTP_REQUIRE_TLS: flag(true),
  /** Leave both empty for a relay that trusts our server's address. */
  SMTP_USER: blankIsUnset(z.string().min(1).optional()),
  SMTP_PASS: blankIsUnset(z.string().min(1).optional()),
}).superRefine((c, ctx) => {
  const problem = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (c.NODE_ENV === 'production' && c.CODE_PEPPER === DEV_CODE_PEPPER) {
    problem('CODE_PEPPER', 'must be set to your own secret in production (openssl rand -base64 48)');
  }
  if (c.EMAIL_MODE === 'smtp') {
    if (!c.SMTP_HOST) problem('SMTP_HOST', 'is required when EMAIL_MODE=smtp');
    if (!c.EMAIL_FROM) problem('EMAIL_FROM', 'is required when EMAIL_MODE=smtp');
  }
  if (c.EMAIL_FROM && !senderAddress(c.EMAIL_FROM)) problem('EMAIL_FROM', 'must look like "Name <address@domain>" or address@domain');
  if (Boolean(c.SMTP_USER) !== Boolean(c.SMTP_PASS)) problem('SMTP_USER', 'set SMTP_USER and SMTP_PASS together, or neither');
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
