import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { getEmergencyContacts, sendEmergencyAlert, type EmergencyContact } from '../lib/emergency';

/**
 * Emergency (MVP item 8): numbers to call first, then "Alert campus safety", which reaches
 * moderators and the campus safety offices directly. No location is sent.
 */
export function Emergency() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<EmergencyContact[] | null>(null);
  const [message, setMessage] = useState('');
  const [step, setStep] = useState<'ready' | 'confirm' | 'sending' | 'sent'>('ready');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getEmergencyContacts().then((r) => setContacts(r.contacts)).catch(() => setContacts([])); }, []);

  async function send() {
    setStep('sending'); setError(null);
    try { const r = await sendEmergencyAlert(message.trim()); setContacts(r.contacts); setStep('sent'); } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The alert didn’t send. Call one of the numbers above now.');
      setStep('confirm');
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Emergency</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen emergency">
        <p className="emergency-lead">In danger right now? <strong>Call first.</strong></p>
        <ul className="emergency-numbers">
          {contacts === null && <li className="muted">Loading numbers…</li>}
          {contacts?.map((c) => (
            <li key={`${c.label}${c.phone}`}>
              <a className="emergency-call" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
                <span><strong>{c.label}</strong><span className="muted">{c.phone}</span></span>
                <span className="emergency-call-btn">Call</span>
              </a>
            </li>
          ))}
          {contacts?.length === 0 && <li className="muted">No numbers set yet. In Kenya, call 999 or 112.</li>}
        </ul>

        <section className="emergency-alert" aria-labelledby="alert-title">
          <h2 id="alert-title">Alert campus safety</h2>
          {step === 'sent' ? (
            <p className="notice" role="status">Sent. Moderators and campus safety staff have been alerted and can see who you are. If you’re in danger, call a number above too.</p>
          ) : (
            <>
              <p className="muted">Sends an alert straight to moderators and campus safety offices (security, health centre, Dean of Students). They’ll see your name so they can reach you. Your location is not sent.</p>
              <label className="field">
                <span className="hint">What’s happening and where? (optional)</span>
                <textarea className="input textarea" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Someone collapsed outside the library" />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              {step === 'ready'
                ? <button type="button" className="btn danger" onClick={() => setStep('confirm')}>Alert campus safety</button>
                : (
                  <div className="emergency-confirm">
                    <p><strong>Send the alert now?</strong></p>
                    <button type="button" className="btn danger" disabled={step === 'sending'} onClick={() => void send()}>{step === 'sending' ? 'Sending…' : 'Yes, send alert'}</button>
                    <button type="button" className="btn secondary" disabled={step === 'sending'} onClick={() => setStep('ready')}>Cancel</button>
                  </div>
                )}
            </>
          )}
        </section>
        <p className="hint">You can also post in the feed. Please don’t name anyone hurt until it’s officially confirmed.</p>
      </div>
    </>
  );
}
