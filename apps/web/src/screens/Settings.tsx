import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ApiError, deleteMe } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Settings and account: log out and delete account (CLAUDE.md sections 4.1 and 10). */
export function Settings() {
  const { me, signOut, setMe } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteMe();
      await signOut().catch(() => undefined);
      setMe(null);
      navigate('/welcome', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t delete your account. Try again.');
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <Link to="/profile" className="icon-btn" aria-label="Back to profile"><Icon name="back" /></Link>
        <h1 className="topbar-title">Settings</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen settings">
        <p className="muted">Signed in as <strong style={{ color: 'var(--ink)' }}>{me?.email}</strong></p>
        <Link to="/profile/edit" className="settings-row">Edit profile</Link>
        <a href="/privacy" className="settings-row">Privacy policy</a>
        <a href="/terms" className="settings-row">Terms and community guidelines</a>
        <button className="settings-row" onClick={() => void signOut().then(() => navigate('/welcome', { replace: true }))}>Log out</button>

        <div className="danger-zone">
          <h2>Delete account</h2>
          <p className="muted">Your profile and personal details are deleted and you are logged out everywhere. Your posts stay, shown as “Deleted member”. This can’t be undone.</p>
          {!confirming ? (
            <button className="btn danger" onClick={() => setConfirming(true)}>Delete my account</button>
          ) : (
            <div className="field">
              <label htmlFor="confirm">Type DELETE to confirm</label>
              <input id="confirm" className="input" autoCapitalize="characters" value={typed} onChange={(e) => setTyped(e.target.value)} />
              {error && <span className="error" role="alert">{error}</span>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn secondary" onClick={() => { setConfirming(false); setTyped(''); }} disabled={busy}>Cancel</button>
                <button className="btn danger" onClick={onDelete} disabled={typed !== 'DELETE' || busy}>{busy ? 'Deleting…' : 'Delete forever'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
