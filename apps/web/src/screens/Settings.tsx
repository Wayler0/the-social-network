import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { InstallHelp } from '../components/InstallHelp';
import { ApiError, deleteMe } from '../lib/api';
import { isModerator } from '../lib/admin';
import { useAuth } from '../lib/auth';
import { promptInstall, useInstallState } from '../lib/install';
import { forgetLastEmail } from '../lib/last-email';
import { APP_NAME } from '../config';

/** Settings and account: log out and delete account (CLAUDE.md sections 4.1 and 10). */
export function Settings() {
  const { me, signOut, setMe } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const install = useInstallState();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [exporting, setExporting] = useState<'idle' | 'busy' | 'done' | string>('idle');

  /** Data Protection Act: a copy of everything we hold about the member, as a JSON file. */
  async function downloadMyData() {
    setExporting('busy');
    try {
      const res = await fetch('/api/me/export', { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { message?: string } | null;
        setExporting(body?.message ?? 'Couldn’t download your data. Try again.');
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'my-data.json';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExporting('done');
    } catch {
      setExporting('Couldn’t download your data. Check your connection.');
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteMe();
      forgetLastEmail();
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
        <Link to="/settings/notifications" className="settings-row">Notifications</Link>
        {isModerator(me) && <Link to="/admin" className="settings-row">{me?.isAdmin ? 'Admin' : 'Moderation'}</Link>}
        {install === 'available' && (
          <button className="settings-row" onClick={() => void promptInstall()}>Install {APP_NAME} on this device</button>
        )}
        {(install === 'ios' || install === 'android-menu' || install === 'in-app') && (
          <>
            <button className="settings-row" onClick={() => setShowIosHelp((v) => !v)} aria-expanded={showIosHelp}>
              {install === 'in-app' ? `Open ${APP_NAME} in your browser` : `Add ${APP_NAME} to your home screen`}
            </button>
            {showIosHelp && <p className="muted install-help"><InstallHelp state={install} /></p>}
          </>
        )}
        <button className="settings-row" onClick={() => void downloadMyData()} disabled={exporting === 'busy'}>
          {exporting === 'busy' ? 'Preparing your data…' : 'Download my data'}
        </button>
        {exporting === 'done' && <p className="muted install-help" role="status">Downloaded: a file with everything {APP_NAME} holds about you.</p>}
        {exporting !== 'idle' && exporting !== 'busy' && exporting !== 'done' && <p className="error install-help" role="alert">{exporting}</p>}
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
