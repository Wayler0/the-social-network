/**
 * Auth API client. Endpoints match Kim's auth issue (#17):
 *   POST /api/auth/request-code { email }
 *   POST /api/auth/verify-code  { email, code }
 * Until the API exists, VITE_API_MOCK=true (in .env.development) fakes it:
 * any 6-digit code works except 000000.
 */
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message ?? 'Something went wrong. Try again.', res.status);
  return data as T;
}

export async function requestCode(email: string): Promise<{ resendAfterSeconds: number }> {
  if (MOCK) {
    await wait(600);
    return { resendAfterSeconds: 30 };
  }
  return post('/api/auth/request-code', { email });
}

export async function verifyCode(email: string, code: string): Promise<{ newUser: boolean }> {
  if (MOCK) {
    await wait(600);
    if (code === '000000') throw new ApiError('That code is wrong or has expired.', 400);
    return { newUser: true };
  }
  return post('/api/auth/verify-code', { email, code });
}
