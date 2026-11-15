import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Queryable } from '../images/store.js';

/**
 * Sign-in codes and campus emails (docs/api-contract.md section 3; CLAUDE.md section 5).
 * Codes are never stored or logged: only HMAC-SHA256(CODE_PEPPER, email:code) is kept.
 */

/** A fresh 6-digit code from the operating system's secure random source (never Math.random). */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashCode(pepper: string, email: string, code: string): Buffer {
  return createHmac('sha256', pepper).update(`${email}:${code}`).digest();
}

/** Compares two hashes in constant time, so response timing reveals nothing about how close a guess was. */
export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Same rule as the web app (apps/web/src/lib/email.ts): plain local parts only. */
const LOCAL_PART = /^[a-z0-9._%+-]{1,64}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Trims and lower-cases an email and splits off its domain; null if it is not a plain address. */
export function normaliseEmail(input: string): { email: string; domain: string } | null {
  const email = input.trim().toLowerCase();
  if (email.length > 254) return null;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!LOCAL_PART.test(local) || !DOMAIN.test(domain)) return null;
  return { email, domain };
}

export type CampusDomain = { campusId: string; memberType: 'student' | 'staff' };

/**
 * The campus and member type an email domain belongs to, or null if it is not a campus domain.
 * Exact match on the whole domain (never endsWith), so look-alikes such as
 * `<campus domain>.evil.com` or `fake<campus domain>` are refused. Only active campuses count.
 */
export async function findCampusDomain(db: Queryable, domain: string): Promise<CampusDomain | null> {
  const { rows } = await db.query<{ campus_id: string; member_type: 'student' | 'staff' }>(
    `select d.campus_id, d.member_type
       from campus_email_domains d join campuses c on c.id = d.campus_id
      where d.domain = $1 and c.status = 'active'`,
    [domain],
  );
  const row = rows[0];
  return row ? { campusId: row.campus_id, memberType: row.member_type } : null;
}
