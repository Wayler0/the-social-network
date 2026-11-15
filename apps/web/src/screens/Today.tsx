import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { AnnouncementCard } from '../components/TodayBoard';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  createAnnouncement, deleteAnnouncement, getAnnouncements, getMyOffices, type Announcement, type MyOffice,
} from '../lib/community';

/** All announcements (pinned first), and a form for members who can post for a verified office (issue #26). */
export function Today() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [offices, setOffices] = useState<MyOffice[]>([]);
  const [composing, setComposing] = useState(false);
  const [removing, setRemoving] = useState<Announcement | null>(null);

  const load = useCallback(async (from: string | null) => {
    try {
      const page = await getAnnouncements(from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch { setState('error'); }
  }, []);

  useEffect(() => {
    void load(null);
    getMyOffices().then((r) => setOffices(r.items.filter((o) => o.verified))).catch(() => setOffices([]));
  }, [load]);

  const owns = (a: Announcement) => !!me?.isAdmin || offices.some((o) => o.id === a.office.id && o.role === 'owner');

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Today board</h1>
        {offices.length > 0
          ? <button type="button" className="icon-btn" aria-label="New announcement" onClick={() => setComposing(true)}><Icon name="plus" /></button>
          : <span style={{ width: 44 }} />}
      </header>

      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && (
        <section className="empty"><h1>Didn’t load</h1><p>Check your connection.</p>
          <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => load(null)}>Try again</button></section>
      )}
      {state === 'ready' && items.length === 0 && (
        <section className="empty"><h1>No announcements</h1><p>Official offices post news and notices here.</p></section>
      )}

      <div className="today-list">
        {items.map((a, i) => (
          <div key={a.id}>
            {i > 0 && items[i - 1]!.pinned && !a.pinned && <h2 className="list-label">Earlier</h2>}
            {i === 0 && a.pinned && <h2 className="list-label">Pinned</h2>}
            <AnnouncementCard a={a} action={owns(a) && (
              <button type="button" className="icon-btn small" aria-label="Delete announcement" onClick={() => setRemoving(a)}>
                <Icon name="more" size={18} />
              </button>
            )} />
          </div>
        ))}
        {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show older</button>}
      </div>

      {composing && (
        <AnnouncementForm offices={offices} onClose={() => setComposing(false)}
          onPosted={(a) => { setItems((list) => [a, ...list]); setComposing(false); }} />
      )}
      {removing && (
        <DeleteSheet a={removing} onClose={() => setRemoving(null)}
          onDeleted={() => { setItems((list) => list.filter((x) => x.id !== removing.id)); setRemoving(null); }} />
      )}
    </>
  );
}

const PIN_DAYS = [0, 1, 3, 7, 14] as const;

function AnnouncementForm({ offices, onClose, onPosted }: { offices: MyOffice[]; onClose: () => void; onPosted: (a: Announcement) => void }) {
  const [officeId, setOfficeId] = useState(offices[0]!.id);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [days, setDays] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = title.trim().length > 0 && title.trim().length <= 140 && body.trim().length > 0 && body.trim().length <= 5000;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      const pinnedUntil = days > 0 ? new Date(Date.now() + days * 86_400_000 - 60_000).toISOString() : undefined;
      onPosted(await createAnnouncement({ officeId, title: title.trim(), body: body.trim(), urgency: urgent ? 'urgent' : 'normal', pinnedUntil }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'It didn’t post. Try again.');
    } finally { setBusy(false); }
  }

  return (
    <Sheet title="New announcement" onClose={onClose}>
      <form className="sheet-form" onSubmit={submit}>
        {offices.length > 1 && (
          <label className="field"><span>Post as</span>
            <select className="input" value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Title</span>
          <input className="input" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field"><span>Message</span>
          <textarea className="input textarea" rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <label className="field"><span>Pin to the Today board</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PIN_DAYS.map((d) => <option key={d} value={d}>{d === 0 ? 'Don’t pin' : `${d} day${d === 1 ? '' : 's'}`}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          <span><strong>Urgent</strong> — always shown at the top for everyone. Use only for safety and must-know news.</span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={!ok || busy}>{busy ? 'Posting…' : 'Post announcement'}</button>
      </form>
    </Sheet>
  );
}

function DeleteSheet({ a, onClose, onDeleted }: { a: Announcement; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet title="Delete this announcement?" onClose={onClose}>
      <p className="sheet-text">“{a.title}” will be removed for everyone. This can’t be undone.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn danger" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await deleteAnnouncement(a.id); onDeleted(); } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Couldn’t delete. Try again.'); setBusy(false);
          }
        }}>{busy ? 'Deleting…' : 'Delete'}</button>
        <button type="button" className="sheet-row muted" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
