import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getMe, onSignedOut } from './api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('session ending mid-use', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a 401 from a later request tells listeners, so the app returns to sign-in', async () => {
    const signedOut = vi.fn();
    const stop = onSignedOut(signedOut);
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'not_signed_in', message: 'Please sign in.' })));
    expect(await getMe()).toBeNull();                       // GET /api/me: 401 simply means "nobody"
    expect(signedOut).toHaveBeenCalledTimes(1);
    stop();
    await getMe();
    expect(signedOut).toHaveBeenCalledTimes(1);             // unsubscribed
  });

  it('other errors keep the contract\'s code and message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: 'suspended', message: 'This account is suspended.' })));
    await expect(getMe()).rejects.toMatchObject({ status: 403, code: 'suspended', message: 'This account is suspended.' });
    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
  });
});
