import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSignedOut, toApiError } from './api';

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('toApiError', () => {
  it('keeps the contract\'s error code, message and retry time', async () => {
    const err = await toApiError(json(429, { error: 'rate_limited', message: 'Try again in 30 seconds.', retryAfterSeconds: 30 }));
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.code, err.message, err.retryAfterSeconds]).toEqual([429, 'rate_limited', 'Try again in 30 seconds.', 30]);
  });
  it('has a readable message when the body is not ours (proxy error page, crash)', async () => {
    const err = await toApiError(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect([err.code, err.message]).toEqual(['internal', 'Something went wrong on our side. Try again in a moment.']);
  });
});

describe('api()', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends cookies and JSON, and reads JSON back', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    expect(await api('PATCH', '/api/me', { name: 'A' })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/me', expect.objectContaining({
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{"name":"A"}',
    }));
  });

  it('204 gives undefined', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await api('POST', '/api/auth/logout')).toBeUndefined();
  });

  it('a 401 signs the app out, except from the sign-in endpoints themselves', async () => {
    const signedOut = vi.fn();
    const stop = onSignedOut(signedOut);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'not_signed_in', message: 'Please sign in.' })));
    await expect(api('GET', '/api/feed')).rejects.toMatchObject({ status: 401, code: 'not_signed_in' });
    expect(signedOut).toHaveBeenCalledTimes(1);
    await expect(api('POST', '/api/auth/logout')).rejects.toBeInstanceOf(ApiError);
    expect(signedOut).toHaveBeenCalledTimes(1);
    stop();
  });

  it('no connection becomes a friendly offline error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api('GET', '/api/feed')).rejects.toMatchObject({ status: 0, code: 'offline' });
  });
});
