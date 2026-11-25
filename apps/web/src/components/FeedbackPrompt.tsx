import { useState } from 'react';
import { APP_NAME } from '../config';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { feedbackLater, sendFeedback } from '../lib/feedback';
import { Sheet } from './Sheet';

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * "Enjoying Hatua?": stars and an optional comment. Opens by itself on a member's third day in the
 * app (`me.askFeedback`); Settings → Send feedback opens it any time (`always`). Admins read
 * feedback without names.
 */
export function FeedbackSheet({ onDone, onLater }: { onDone: () => void; onLater: () => void }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!rating) return;
    setBusy(true); setError(null);
    try { await sendFeedback(rating, body); setSent(true); } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t send. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <Sheet title="Thank you!" onClose={onDone}>
        <p className="sheet-text">Your feedback goes to the team building {APP_NAME}. We read every one.</p>
        <button type="button" className="btn" onClick={onDone}>Done</button>
      </Sheet>
    );
  }
  return (
    <Sheet title={`Enjoying ${APP_NAME}?`} onClose={onLater}>
      <p className="sheet-text">Tell the team how it’s going. Your name isn’t shown with your feedback.</p>
      <div className="stars" role="radiogroup" aria-label="Your rating">
        {STARS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className={`star${n <= rating ? ' on' : ''}`} onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      <label htmlFor="feedback-body" className="visually-hidden">What should we improve?</label>
      <textarea id="feedback-body" className="input textarea" rows={3} maxLength={2000}
        placeholder="What should we improve? (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
      {error && <p className="error sheet-text" role="alert">{error}</p>}
      <button type="button" className="btn" disabled={!rating || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button>
      <button type="button" className="sheet-row muted" disabled={busy} onClick={onLater}>Not now</button>
    </Sheet>
  );
}

/** Shows the sheet by itself on day 3 (once the year question, if any, is answered). */
export function FeedbackPrompt() {
  const { me, setMe } = useAuth();
  const [closed, setClosed] = useState(false);
  if (!me?.askFeedback || closed) return null;
  const done = () => { setClosed(true); setMe({ ...me, askFeedback: false }); };
  return (
    <FeedbackSheet onDone={done}
      onLater={() => { setClosed(true); feedbackLater().catch(() => { /* asked again next visit, which is fine */ }); }} />
  );
}
