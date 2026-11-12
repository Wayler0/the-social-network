/**
 * Campus email rules (CLAUDE.md §5). Which domains are allowed comes from the campus list
 * (src/config.ts now, the API later) — nothing here names a campus.
 * The server checks this again; this is only for instant feedback in the form.
 */
import { CAMPUSES, type Campus } from '../config';

export type MemberType = 'student' | 'staff';

export type EmailCheck =
  | { ok: true; email: string; memberType: MemberType; campus: string }
  | { ok: false; reason: 'empty' | 'format' | 'domain' };

const LOCAL_PART = /^[a-z0-9._%+-]+$/;

export function checkCampusEmail(input: string, campuses: Campus[] = CAMPUSES): EmailCheck {
  const email = input.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'empty' };

  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) return { ok: false, reason: 'format' };
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!LOCAL_PART.test(local)) return { ok: false, reason: 'format' };

  for (const campus of campuses) {
    if (Object.hasOwn(campus.emailDomains, domain)) {
      return { ok: true, email, memberType: campus.emailDomains[domain], campus: campus.slug };
    }
  }
  return { ok: false, reason: 'domain' };
}

/** Every allowed domain, for hints and error messages. */
export function allowedDomains(campuses: Campus[] = CAMPUSES): string[] {
  return campuses.flatMap((c) => Object.keys(c.emailDomains));
}

export function emailErrorText(reason: 'empty' | 'format' | 'domain', campuses: Campus[] = CAMPUSES): string {
  if (reason === 'empty') return 'Enter your campus email.';
  if (reason === 'format') return 'That doesn’t look like an email address.';
  return `Use your campus email. It must end in ${allowedDomains(campuses).map((d) => `@${d}`).join(' or ')}.`;
}
