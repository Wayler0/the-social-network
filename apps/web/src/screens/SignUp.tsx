import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { APP_SLUG } from '../config';
import { useCampuses } from '../lib/campuses';
import { allowedDomains, checkCampusEmail, emailErrorText } from '../lib/email';
import { requestCode, ApiError } from '../lib/api';
import { getLastEmail } from '../lib/last-email';

/** Issue #1 — sign-up / sign-in: campus email only. Design: canvas screen 1. */
export function SignUp() {
  const navigate = useNavigate();
  const campuses = useCampuses();
  const [email, setEmail] = useState(getLastEmail);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Graduated: sign in with the personal email linked before graduating (Settings).
  const [personal, setPersonal] = useState(false);
  const [offerPersonal, setOfferPersonal] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Instant feedback once the campus list has loaded; the server checks either way.
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) { setError(personal ? 'Enter your personal email.' : 'Enter your campus email.'); return; }
    let toSend = trimmed;
    if (campuses && !personal) {
      const check = checkCampusEmail(email, campuses);
      if (!check.ok) { setError(emailErrorText(check.reason, campuses)); setOfferPersonal(check.reason === 'domain'); return; }
      toSend = check.email;
    }
    setError(null);
    setSending(true);
    try {
      const { resendAfterSeconds } = await requestCode(toSend, personal);
      // Email goes in router state, never in the URL.
      navigate('/verify', { state: { email: toSend, resendAfterSeconds, personal } });
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
        <p>For the {campuses?.length ? campuses.map((c) => c.name).join(', ') : 'campus'} community: students, staff and alumni. Sign in or join with your campus email.</p>
      </div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="email">{personal ? 'Personal email' : 'Campus email'}</label>
          <input
            id="email" className="input" type="email" inputMode="email" autoComplete="email"
            autoCapitalize="none" spellCheck={false} placeholder={personal ? 'you@gmail.com' : campuses ? `you@${allowedDomains(campuses)[0]}` : 'you@your-campus-email'}
            value={email} onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            aria-invalid={error ? 'true' : 'false'} aria-describedby="email-help"
          />
          {error
            ? <span id="email-help" className="error" role="alert">{error}</span>
            : <span id="email-help" className="hint">{personal
              ? 'Only works if you linked it in Settings before graduating.'
              : 'We’ll send a 6-digit code to this address.'}</span>}
        </div>
        {(offerPersonal || personal) && (
          <button type="button" className="linkish" onClick={() => { setPersonal(!personal); setError(null); setOfferPersonal(false); }}>
            {personal ? 'Use my campus email instead' : 'Graduated? Sign in with your linked personal email'}
          </button>
        )}
        <button className="btn" type="submit" disabled={sending}>{sending ? 'Sending code…' : 'Send code'}</button>
      </form>

      <p className="auth-foot">
        By continuing you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.
      </p>
    </main>
  );
}
