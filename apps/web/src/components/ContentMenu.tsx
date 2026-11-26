import { useState } from 'react';
import { ApiError } from '../lib/api';
import { blockUser, report, REPORT_REASONS, type Author, type ReportReason } from '../lib/feed';
import { Sheet } from './Sheet';

type Step = 'menu' | 'report' | 'block' | 'delete' | 'reported';

/**
 * The "…" menu on a post or comment: report, block the author, delete (own, or admin / post author for comments).
 * Report and block are on every piece of content (CLAUDE.md section 6). Every destructive step asks first, in the sheet.
 */
export function ContentMenu({ kind, targetId, author, isOwn, canDelete, onDelete, onEdit, onBlocked, onClose, startAt = 'menu' }: {
  kind: 'post' | 'comment' | 'group' | 'question' | 'answer' | 'profile' | 'story' | 'event';
  /** Open straight on a step, e.g. 'report' when the caller has its own menu. */
  startAt?: 'menu' | 'report';
  targetId: string;
  author: Author;
  isOwn: boolean;
  canDelete: boolean;
  onDelete: () => Promise<void>;
  /** Your own content that can be edited: shows "Edit …" (the caller closes the menu and opens its editor). */
  onEdit?: () => void;
  onBlocked: (authorId: string) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(startAt);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canBlock = !isOwn && author.id !== null;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t reach the server. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  if (step === 'menu') {
    return (
      <Sheet title={`${kind[0]!.toUpperCase()}${kind.slice(1)} options`} onClose={onClose}>
        <div className="sheet-actions">
          {!isOwn && <button type="button" className="sheet-row" onClick={() => setStep('report')}>Report {kind}</button>}
          {canBlock && <button type="button" className="sheet-row" onClick={() => setStep('block')}>Block {author.name}</button>}
          {isOwn && onEdit && <button type="button" className="sheet-row" onClick={onEdit}>Edit {kind}</button>}
          {canDelete && <button type="button" className="sheet-row danger" onClick={() => setStep('delete')}>Delete {kind}</button>}
          <button type="button" className="sheet-row muted" onClick={onClose}>Cancel</button>
        </div>
      </Sheet>
    );
  }

  if (step === 'report') {
    return (
      <Sheet title={`Why are you reporting this ${kind}?`} onClose={onClose}>
        <form className="sheet-form" onSubmit={(e) => {
          e.preventDefault();
          if (!reason) return;
          void run(async () => { await report(kind === 'profile' ? 'user' : kind, targetId, reason, details.trim() || undefined); setStep('reported'); });
        }}>
          <fieldset className="reasons">
            <legend className="visually-hidden">Reason</legend>
            {REPORT_REASONS.map(([value, label]) => (
              <label key={value} className={`reason${reason === value ? ' selected' : ''}`}>
                <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span className="hint">Anything moderators should know? (optional)</span>
            <textarea className="input textarea" rows={2} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          {reason === 'self_harm' && (
            <p className="notice">If someone is in danger right now, call campus security or 999. You can also reach the Dean of Students.</p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="btn" disabled={!reason || busy}>{busy ? 'Sending…' : 'Send report'}</button>
        </form>
      </Sheet>
    );
  }

  if (step === 'reported') {
    return (
      <Sheet title="Thanks for telling us" onClose={onClose}>
        <p className="sheet-text">Moderators will review it. The person isn’t told who reported them.</p>
        <div className="sheet-actions">
          {canBlock && <button type="button" className="sheet-row" onClick={() => setStep('block')}>Also block {author.name}</button>}
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      </Sheet>
    );
  }

  if (step === 'block') {
    return (
      <Sheet title={`Block ${author.name}?`} onClose={onClose}>
        <p className="sheet-text">You won’t see each other’s posts and comments. They aren’t told. You can unblock them in Settings.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn danger" disabled={busy}
            onClick={() => run(async () => { await blockUser(author.id!); onBlocked(author.id!); onClose(); })}>
            {busy ? 'Blocking…' : 'Block'}
          </button>
          <button type="button" className="sheet-row muted" onClick={onClose}>Cancel</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Delete this ${kind}?`} onClose={onClose}>
      <p className="sheet-text">This can’t be undone.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn danger" disabled={busy} onClick={() => run(async () => { await onDelete(); onClose(); })}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
        <button type="button" className="sheet-row muted" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
