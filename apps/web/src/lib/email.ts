/**
 * University email rules (CLAUDE.md §3, verification).
 * Students: name@student.tharaka.ac.ke   Staff: name@tharaka.ac.ke
 * The server checks this again — this is only for instant feedback in the form.
 */
export type MemberType = 'student' | 'staff';

export type EmailCheck =
  | { ok: true; email: string; memberType: MemberType }
  | { ok: false; reason: 'empty' | 'format' | 'domain' };

const LOCAL_PART = /^[a-z0-9._%+-]+$/;

export function checkUniversityEmail(input: string): EmailCheck {
  const email = input.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'empty' };

  const at = email.lastIndexOf('@');
  if (at <= 0 || at !== email.indexOf('@')) return { ok: false, reason: 'format' };
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!LOCAL_PART.test(local)) return { ok: false, reason: 'format' };

  if (domain === 'student.tharaka.ac.ke') return { ok: true, email, memberType: 'student' };
  if (domain === 'tharaka.ac.ke') return { ok: true, email, memberType: 'staff' };
  return { ok: false, reason: 'domain' };
}

export const emailErrorText: Record<'empty' | 'format' | 'domain', string> = {
  empty: 'Enter your university email.',
  format: 'That doesn’t look like an email address.',
  domain: 'Use your Tharaka University email — it ends in tharaka.ac.ke.',
};
