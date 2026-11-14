/**
 * API client. Shapes follow docs/api-contract.md (sections 3 and 4).
 * Until the API exists, VITE_API_MOCK=true (in .env.development) fakes it in the browser:
 * any 6-digit code works except 000000, and the profile is kept in localStorage.
 */
import { APP_SLUG, CAMPUSES } from '../config';
import { checkCampusEmail } from './email';
import { isComplete, normaliseMemberNumber, type Me, type toPatch } from './profile';

const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message ?? 'Something went wrong. Try again.', res.status, data.error);
  return data as T;
}

// ---------------------------------------------------------------- mock store (development only)
const MOCK_KEY = `${APP_SLUG}.mockMe`;
function mockRead(): Me | null {
  try { const raw = localStorage.getItem(MOCK_KEY); return raw ? (JSON.parse(raw) as Me) : null; } catch { return null; }
}
function mockWrite(me: Me | null) {
  try { if (me) localStorage.setItem(MOCK_KEY, JSON.stringify(me)); else localStorage.removeItem(MOCK_KEY); } catch { /* storage blocked */ }
}
function mockNewMe(email: string): Me {
  const check = checkCampusEmail(email);
  const campus = CAMPUSES.find((c) => check.ok && c.slug === check.campus) ?? CAMPUSES[0];
  return {
    id: crypto.randomUUID(), campus: { slug: campus.slug, name: campus.name }, email,
    memberType: check.ok && check.memberType === 'staff' ? 'staff' : null,
    name: null, photoUrl: null, course: null, yearOfStudy: null, graduationYear: null,
    memberNumber: null, memberNumberStatus: 'unverified', isUnder18: null,
    badges: [], isAdmin: false, profileComplete: false,
  };
}

// ---------------------------------------------------------------- auth
export async function requestCode(email: string): Promise<{ resendAfterSeconds: number }> {
  if (MOCK) { await wait(600); return { resendAfterSeconds: 30 }; }
  return call('POST', '/api/auth/request-code', { email });
}

export async function verifyCode(email: string, code: string): Promise<{ newUser: boolean }> {
  if (MOCK) {
    await wait(600);
    if (code === '000000') throw new ApiError('That code is wrong or has expired.', 400, 'code_wrong');
    const existing = mockRead();
    if (existing && existing.email === email) return { newUser: false };
    mockWrite(mockNewMe(email));
    return { newUser: true };
  }
  return call('POST', '/api/auth/verify-code', { email, code });
}

export async function logout(): Promise<void> {
  if (MOCK) { try { localStorage.removeItem(`${APP_SLUG}.mockSignedIn`); } catch { /* ignore */ } return; }
  return call('POST', '/api/auth/logout');
}

// ---------------------------------------------------------------- me
/** The signed-in member, or null when not signed in. */
export async function getMe(): Promise<Me | null> {
  if (MOCK) {
    await wait(150);
    let signedIn = false;
    try { signedIn = localStorage.getItem(`${APP_SLUG}.mockSignedIn`) === '1'; } catch { /* ignore */ }
    return signedIn ? mockRead() : null;
  }
  try {
    return await call<Me>('GET', '/api/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function updateMe(patch: ReturnType<typeof toPatch>): Promise<Me> {
  if (MOCK) {
    await wait(500);
    const me = mockRead();
    if (!me) throw new ApiError('Please sign in again.', 401, 'not_signed_in');
    if (normaliseMemberNumber(patch.memberNumber) === 'TAKEN1') {
      throw new ApiError('That registration number is already used by another account.', 409, 'member_number_taken');
    }
    const next: Me = { ...me, ...patch, memberType: me.memberType === 'staff' ? 'staff' : patch.memberType };
    next.profileComplete = isComplete(next);
    mockWrite(next);
    return next;
  }
  return call('PATCH', '/api/me', patch);
}

export async function deleteMe(): Promise<void> {
  if (MOCK) { await wait(500); mockWrite(null); return; }
  return call('DELETE', '/api/me', { confirm: 'DELETE' });
}

export async function disputeMemberNumber(memberNumber: string, details: string): Promise<void> {
  if (MOCK) { await wait(400); return; }
  return call('POST', '/api/me/member-number-dispute', { memberNumber, details });
}
