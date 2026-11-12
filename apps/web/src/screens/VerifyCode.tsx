import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { requestCode, verifyCode, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const LENGTH = 6;

/** Issue #2 — enter the one-time code. Design: canvas screen 2. */
export function VerifyCode() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const state = location.state as { email?: string; resendAfterSeconds?: number } | null;
  const email = state?.email;

  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(state?.resendAfterSeconds ?? 30);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => { inputs.current[0]?.focus(); }, []);

  if (!email) return <Navigate to="/welcome" replace />;

  async function submit(code: string) {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(email!, code);
      signIn();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t check the code. Try again.');
      setDigits(Array(LENGTH).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  }

  function setAt(i: number, value: string) {
    const next = [...digits];
    next[i] = value;
    setDigits(next);
    if (error) setError(null);
    if (next.every((d) => d !== '')) void submit(next.join(''));
  }

  function onChange(i: number, raw: string) {
    const d = raw.replace(/\D/g, '');
    if (d.length > 1) return fillFrom(i, d); // autofill / fast typing
    setAt(i, d);
    if (d && i < LENGTH - 1) inputs.current[i + 1]?.focus();
  }

  function fillFrom(start: number, text: string) {
    const next = [...digits];
    let i = start;
    for (const ch of text) { if (i >= LENGTH) break; next[i++] = ch; }
    setDigits(next);
    inputs.current[Math.min(i, LENGTH - 1)]?.focus();
    if (next.every((d) => d !== '')) void submit(next.join(''));
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, i: number) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!text) return;
    e.preventDefault();
    fillFrom(i, text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < LENGTH - 1) inputs.current[i + 1]?.focus();
  }

  async function resend() {
    setError(null);
    try {
      const { resendAfterSeconds } = await requestCode(email!);
      setCooldown(resendAfterSeconds);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t resend. Try again.');
    }
  }

  return (
    <main className="auth">
      <Link to="/welcome" className="icon-btn back-link" aria-label="Back, change email"><Icon name="back" /></Link>
      <div className="auth-hero" style={{ paddingTop: 0 }}>
        <h1 className="screen-title">Check your email</h1>
        <p>We sent a 6-digit code to <strong style={{ color: 'var(--ink)' }}>{email}</strong>. It expires in 10 minutes.</p>
      </div>

      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (digits.every(Boolean)) void submit(digits.join('')); }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
          <legend className="visually-hidden">6-digit code</legend>
          <div className="code-inputs">
            {digits.map((d, i) => (
              <input
                key={i} ref={(el) => { inputs.current[i] = el; }}
                value={d} inputMode="numeric" pattern="[0-9]*" maxLength={i === 0 ? LENGTH : 1}
                autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={`Digit ${i + 1}`}
                aria-invalid={error ? 'true' : 'false'}
                onChange={(e) => onChange(i, e.target.value)} onPaste={(e) => onPaste(e, i)} onKeyDown={(e) => onKeyDown(e, i)}
              />
            ))}
          </div>
        </fieldset>
        {error && <span className="error" role="alert">{error}</span>}
        {busy && <span className="hint" aria-live="polite">Checking…</span>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="hint">Didn’t get it? Check spam.</span>
          <button type="button" className="linkish" onClick={resend} disabled={cooldown > 0}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
          </button>
        </div>
      </form>
    </main>
  );
}
