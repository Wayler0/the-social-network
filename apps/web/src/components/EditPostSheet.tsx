import { useState } from 'react';
import { ApiError } from '../lib/api';
import { editPost, POST_MAX, type Post } from '../lib/feed';
import { Sheet } from './Sheet';

/** Change a post's text after posting. The post then shows "Edited"; moderators can still see the earlier text. */
export function EditPostSheet({ post, onSaved, onClose }: { post: Post; onSaved: (p: Post) => void; onClose: () => void }) {
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = body.trim();
  const tooLong = trimmed.length > POST_MAX;
  const canSave = !busy && !tooLong && (trimmed.length > 0 || !!post.event) && trimmed !== post.body;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setError(null);
    try { onSaved(await editPost(post.id, trimmed)); onClose(); } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t reach the server. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <Sheet title="Edit post" onClose={onClose}>
      <form className="sheet-form" onSubmit={save}>
        <label className="field">
          <span className="visually-hidden">Post text</span>
          <textarea className="input textarea" rows={5} value={body} autoFocus onChange={(e) => setBody(e.target.value)} aria-describedby="edit-count" />
        </label>
        <p id="edit-count" className={`hint count${tooLong ? ' over' : ''}`}>{trimmed.length} / {POST_MAX}</p>
        <p className="hint">Only the text can change. The post will say “Edited”.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={!canSave}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  );
}
