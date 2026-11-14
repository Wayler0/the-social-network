/**
 * API client. Shapes and rules: docs/api-contract.md.
 * - Every request sends the session cookie (HttpOnly, set by the API; the app never sees it).
 * - Errors come back as ApiError with the contract's `error` code and `message` (show the message).
 * - A 401 from any endpoint means the session ended: listeners (the auth provider) sign the app out.
 *
 * VITE_API_MOCK=true fakes sign-in and /api/me, for working on screens without the API running:
 * any 6-digit code works except 000000.
 */
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** The contract's error code, e.g. "code_wrong", "rate_limited", "profile_incomplete". */
    public code: string = 'internal',
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

type Listener = () => void;
const signedOutListeners = new Set<Listener>();
/** Called when any request answers 401 (session expired, revoked, account deleted). */
export function onSignedOut(listener: Listener): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

/** Turns a failed response into an ApiError, using the contract's `{ error, message }` body when there is one. */
export async function toApiError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; retryAfterSeconds?: number };
  const message = data.message
    ?? (res.status >= 500 ? 'Something went wrong on our side. Try again in a moment.' : 'Something went wrong. Try again.');
  return new ApiError(message, res.status, data.error ?? (res.status >= 500 ? 'internal' : 'unknown'), data.retryAfterSeconds);
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('No connection. Check your data or Wi-Fi and try again.', 0, 'offline');
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401 && !path.startsWith('/api/auth/')) signedOutListeners.forEach((l) => l());
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- sign-in (contract section 3)

export async function requestCode(email: string): Promise<{ resendAfterSeconds: number }> {
  if (MOCK) { await wait(600); return { resendAfterSeconds: 30 }; }
  return api('POST', '/api/auth/request-code', { email });
}

export async function verifyCode(email: string, code: string): Promise<{ newUser: boolean }> {
  if (MOCK) {
    await wait(600);
    if (code === '000000') throw new ApiError('That code is wrong or has expired.', 400, 'code_wrong');
    mockMe = { ...MOCK_ME, email };
    return { newUser: true };
  }
  return api('POST', '/api/auth/verify-code', { email, code });
}

export async function logout(): Promise<void> {
  if (MOCK) { mockMe = null; return; }
  await api('POST', '/api/auth/logout');
}

// ---------------------------------------------------------------- me (contract section 4)

export type MemberType = 'fresher' | 'continuing' | 'alumni' | 'staff';

export type Me = {
  id: string;
  campus: { slug: string; name: string };
  email: string;
  memberType: MemberType;
  name: string | null;
  photoUrl: string | null;
  course: string | null;
  yearOfStudy: number | null;
  graduationYear: number | null;
  memberNumber: string | null;
  memberNumberStatus: 'unverified' | 'verified' | 'disputed';
  isUnder18: boolean | null;
  badges: string[];
  isAdmin: boolean;
  profileComplete: boolean;
};

export type MeChanges = Partial<{
  name: string; memberType: MemberType; course: string | null; yearOfStudy: number | null;
  graduationYear: number | null; memberNumber: string; isUnder18: boolean; photoImageId: string | null;
}>;

/** The signed-in member, or null when nobody is signed in. */
export async function getMe(): Promise<Me | null> {
  if (MOCK) { await wait(200); return mockMe; }
  try {
    return await api<Me>('GET', '/api/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function updateMe(changes: MeChanges): Promise<Me> {
  if (MOCK) {
    await wait(400);
    const next = { ...mockMe!, ...changes } as Me;
    next.profileComplete = Boolean(next.name && next.memberNumber && next.isUnder18 !== null
      && (next.memberType === 'alumni' ? next.graduationYear : next.memberType === 'staff' || next.yearOfStudy));
    mockMe = next;
    return next;
  }
  return api('PATCH', '/api/me', changes);
}

/** "Someone has claimed my number": goes to the admins (202). */
export async function disputeMemberNumber(memberNumber: string, details?: string): Promise<void> {
  if (MOCK) { await wait(400); return; }
  await api('POST', '/api/me/member-number-dispute', details ? { memberNumber, details } : { memberNumber });
}

// ---------------------------------------------------------------- mock data

const MOCK_ME: Me = {
  id: '00000000-0000-4000-8000-000000000000', campus: { slug: 'mock', name: 'Mock Campus' }, email: '',
  memberType: 'continuing', name: null, photoUrl: null, course: null, yearOfStudy: null, graduationYear: null,
  memberNumber: null, memberNumberStatus: 'unverified', isUnder18: null, badges: [], isAdmin: false, profileComplete: false,
};
let mockMe: Me | null = null;
