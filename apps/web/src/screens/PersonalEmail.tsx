import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmPersonalEmail, linkPersonalEmail, unlinkPersonalEmail } from '../lib/personal-email';

/**
 * "Keep access after graduating": the university closes the student email right after graduation,
 * so a member links a personal email (code sent to it) and can sign in with it later.
 */
export function PersonalEmail() {
  const navigate = useNavigate();
  const { me, setMe } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const linked = me?.personalEmail ?? null;
  const failed = (err: unknown) => setError(err instanceof ApiError ? err.message : 'Couldn’t reach the server. Check your connection and try again.');

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError('Enter a personal email address.');
    setBusy(true); setError(null);
    try { await linkPersonalEmail(email.trim()); setStep('code'); } catch (err) { failed(err); } finally { setBusy(false); }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { personalEmail } = await confirmPersonalEmail(code.trim());
      if (me) setMe({ ...me, personalEmail });
      setStep('email'); setEmail(''); setCode(''); setNote('Linked. You can sign in with this email after you graduate.');
    } catch (err) { failed(err); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(null);
    try { await unlinkPersonalEmail(); if (me) setMe({ ...me, personalEmail: null }); setNote(null); } catch (err) { failed(err); } finally { setBusy(false); }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Keep access after graduating</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen settings">
        <p className="muted">The university closes your student email soon after you graduate. Link a personal email now (Gmail, Yahoo…) and you can keep signing in with it, as an alumnus.</p>
        <p className="hint">Only you see it. It’s used for signing in, nothing else.</p>

        {linked && (
          <div className="linked-email">
            <span>Linked: <strong>{linked}</strong></span>
            <button type="button" className="btn secondary small-btn" disabled={busy} onClick={() => void remove()}>Remove</button>
          </div>
        )}
        {note && <p className="notice" role="status">{note}</p>}

        {step === 'email' ? (
          <form className="auth-form" onSubmit={send} noValidate>
            <div className="field">
              <label htmlFor="pe">{linked ? 'Use a different personal email' : 'Personal email'}</label>
              <input id="pe" className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                placeholder="you@gmail.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending code…' : 'Send code'}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={confirm} noValidate>
            <div className="field">
              <label htmlFor="pe-code">Enter the 6-digit code we sent to {email.trim()}</label>
              <input id="pe-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null); }} />
              <span className="hint">Check spam if it isn’t there. It expires in 10 minutes.</span>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Link email'}</button>
            <button type="button" className="linkish" onClick={() => { setStep('email'); setCode(''); setError(null); }}>Use a different email</button>
          </form>
        )}
      </div>
    </>
  );
}
