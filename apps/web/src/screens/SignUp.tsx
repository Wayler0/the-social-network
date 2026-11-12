import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_SLUG, CAMPUSES } from '../config';
import { allowedDomains, checkCampusEmail, emailErrorText } from '../lib/email';
import { requestCode, ApiError } from '../lib/api';

/** Issue #1 — sign-up / sign-in: campus email only. Design: canvas screen 1. */
export function SignUp() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const check = checkCampusEmail(email);
    if (!check.ok) {
      setError(emailErrorText(check.reason));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const { resendAfterSeconds } = await requestCode(check.email);
      // Email goes in router state, never in the URL.
      navigate('/verify', { state: { email: check.email, resendAfterSeconds } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t send the code. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-hero">
        <span className="wordmark">{APP_SLUG}<span>.</span></span>
        <h1 className="screen-title">Your campus, in one place.</h1>
        <p>For the {CAMPUSES.map((c) => c.name).join(', ')} community: students, staff and alumni. Join with your campus email.</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">Campus email</label>
          <input
            id="email" className="input" type="email" inputMode="email" autoComplete="email"
            autoCapitalize="none" spellCheck={false} placeholder={`you@${allowedDomains()[0]}`}
            value={email} onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            aria-invalid={error ? 'true' : 'false'} aria-describedby="email-help"
          />
          {error
            ? <span id="email-help" className="error" role="alert">{error}</span>
            : <span id="email-help" className="hint">We’ll send a 6-digit code to this address.</span>}
        </div>
        <button className="btn" type="submit" disabled={sending}>{sending ? 'Sending code…' : 'Send code'}</button>
      </form>

      <p className="auth-foot">
        By continuing you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.
      </p>
    </main>
  );
}
