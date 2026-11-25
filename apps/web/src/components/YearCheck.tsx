import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, call } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Me } from '../lib/profile';
import { Sheet } from './Sheet';

/**
 * After a new academic year starts, the server moves students up a year (src/me/year.ts in the API)
 * and asks once: "You're now in Year 3, right?". Yes keeps it; they can also stay in their old year
 * (repeating or deferred), say they've graduated (becomes alumni), or pick another year in Edit profile.
 * "Later" hides it until the app is next opened.
 */
export function YearCheck() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = me?.yearCheck;
  if (!me || !check || later) return null;

  async function answer(request: () => Promise<Me>) {
    setBusy(true); setError(null);
    try { setMe(await request()); } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t save. Check your connection and try again.');
    } finally { setBusy(false); }
  }
  const yes = () => answer(() => call<Me>('POST', '/api/me/year-check'));
  const stay = () => answer(() => call<Me>('PATCH', '/api/me',
    check.from === 1 ? { memberType: 'fresher', yearOfStudy: 1 } : { memberType: 'continuing', yearOfStudy: check.from }));
  const graduated = () => answer(() => call<Me>('PATCH', '/api/me', { memberType: 'alumni', graduationYear: new Date().getFullYear() }));

  return (
    <Sheet title="New academic year" onClose={() => setLater(true)}>
      <p className="sheet-text">We’ve moved you up to <strong>Year {check.to}</strong>{me.course ? ` of ${me.course}` : ''} and into your new class group. Is that right?</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void yes()}>Yes, I’m in Year {check.to}</button>
      <button type="button" className="sheet-row" disabled={busy} onClick={() => void stay()}>No, I’m still in Year {check.from}</button>
      <button type="button" className="sheet-row" disabled={busy} onClick={() => void graduated()}>I’ve graduated</button>
      <button type="button" className="sheet-row" disabled={busy} onClick={() => { setLater(true); navigate('/profile/edit'); }}>Another year…</button>
      {error && <p className="error sheet-text" role="alert">{error}</p>}
      <button type="button" className="sheet-row muted" disabled={busy} onClick={() => setLater(true)}>Later</button>
    </Sheet>
  );
}
