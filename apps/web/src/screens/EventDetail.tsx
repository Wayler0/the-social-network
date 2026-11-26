import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ContentMenu } from '../components/ContentMenu';
import { EventStatus, hostName } from '../components/EventCard';
import { Icon } from '../components/Icon';
import { RichText } from '../components/RichText';
import { Sheet } from '../components/Sheet';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  deleteEvent, getAttendees, getEvent, isOver, setRsvp, updateEvent, whenText,
  type Attendee, type CampusEvent, type Rsvp,
} from '../lib/events';
import { createPost, plural } from '../lib/feed';
import { addPostToTop } from '../lib/feed-store';

type Open = null | 'menu' | 'cancel' | 'delete' | 'share' | Rsvp;

/** One event: details, Going / Interested, who's coming, and the host's edit / cancel / delete. */
export function EventDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [event, setEvent] = useState<CampusEvent | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [open, setOpen] = useState<Open>(null);
  const [caption, setCaption] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setEvent(await getEvent(id)); setState('ready'); } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const top = (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
      <h1 className="topbar-title">Event</h1>
      {event ? <button type="button" className="icon-btn" aria-label="Event options" onClick={() => setOpen('menu')}><Icon name="more" /></button>
        : <span style={{ width: 44 }} />}
    </header>
  );

  if (state === 'loading') return <>{top}<p className="feed-foot" role="status">Loading…</p></>;
  if (state !== 'ready' || !event) {
    return (<>{top}<section className="empty">
      <h1>{state === 'missing' ? 'Event not available' : 'Didn’t load'}</h1>
      <p>{state === 'missing' ? 'It may have been deleted, or it isn’t open to you.' : 'Check your connection.'}</p>
      {state === 'error' && <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={load}>Try again</button>}
    </section></>);
  }

  const e = event;
  const over = isOver(e);
  const closed = e.cancelled || over;

  async function run(action: () => Promise<void>, failText: string) {
    setBusy(true); setError(null);
    try { await action(); } catch (err) {
      setError(err instanceof ApiError ? err.message : failText);
      if (err instanceof ApiError && err.status === 409) void load(); // cancelled or over meanwhile
    } finally { setBusy(false); }
  }

  const rsvp = (status: Rsvp) => run(async () => {
    const r = await setRsvp(e.id, e.myRsvp === status ? null : status);
    setEvent({ ...e, ...r });
  }, 'That didn’t save. Try again.');

  const setCancelled = (cancelled: boolean) => run(async () => {
    setEvent(await updateEvent(e.id, { cancelled })); setOpen(null);
  }, 'That didn’t work. Try again.');

  return (
    <>
      {top}
      {e.image && <img className="post-image event-image" src={e.image.url} width={e.image.width} height={e.image.height} alt="" />}

      <section className="event-head">
        <span className="badges"><EventStatus e={e} withRsvp={false} /></span>
        <h2 className={e.cancelled ? 'struck' : undefined}>{e.title}</h2>
        {e.cancelled && <p className="notice danger-notice">The host cancelled this event.</p>}

        <dl className="event-facts">
          <div><dt><Icon name="calendar" size={20} /><span className="visually-hidden">When</span></dt>
            <dd>{whenText(e.startsAt, e.endsAt)}</dd></div>
          {e.location && <div><dt><Icon name="pin" size={20} /><span className="visually-hidden">Where</span></dt><dd>{e.location}</dd></div>}
          <div><dt><Icon name="people" size={20} /><span className="visually-hidden">Host</span></dt>
            <dd>Hosted by {e.group ? <Link to={`/groups/${e.group.id}`} className="text-link">{e.group.name}</Link> : hostName(e)}
              {e.office?.verified && <span className="badge-pill strong" style={{ marginLeft: 6 }}>Official</span>}
              {(e.office || e.group) && <span className="post-meta"> · by {e.createdBy.name}</span>}
            </dd></div>
        </dl>

        <div className="event-counts">
          <button type="button" className="linkish" disabled={e.goingCount === 0} onClick={() => setOpen('going')}>
            {plural(e.goingCount, 'person', 'people')} going
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="linkish" disabled={e.interestedCount === 0} onClick={() => setOpen('interested')}>
            {e.interestedCount} interested
          </button>
        </div>

        {!closed && (
          <div className="rsvp" role="group" aria-label="Will you go?">
            <button type="button" className={`btn${e.myRsvp === 'going' ? '' : ' secondary'}`} aria-pressed={e.myRsvp === 'going'}
              disabled={busy} onClick={() => rsvp('going')}>
              {e.myRsvp === 'going' && <Icon name="check" size={18} />} Going
            </button>
            <button type="button" className={`btn${e.myRsvp === 'interested' ? '' : ' secondary'}`} aria-pressed={e.myRsvp === 'interested'}
              disabled={busy} onClick={() => rsvp('interested')}>
              {e.myRsvp === 'interested' && <Icon name="check" size={18} />} Interested
            </button>
          </div>
        )}
        {!e.cancelled && !over && (
          <button type="button" className="btn secondary share-event-btn" onClick={() => setOpen('share')}>
            <Icon name="share" size={18} /> Share to feed
          </button>
        )}
        {shared && <p className="notice" role="status">Shared to the campus feed.</p>}
        {over && !e.cancelled && <p className="hint">This event has ended.</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {e.description && <div className="event-desc"><h3>About</h3><p><RichText text={e.description} /></p></div>}

      {open === 'share' && (
        <Sheet title="Share to feed" onClose={() => setOpen(null)}>
          <label htmlFor="event-caption" className="visually-hidden">Say something (optional)</label>
          <textarea id="event-caption" className="input textarea" rows={3} maxLength={2000}
            placeholder="Say something about it (optional)" value={caption} onChange={(ev) => setCaption(ev.target.value)} />
          {error && <p className="error" role="alert">{error}</p>}
          <button type="button" className="btn" disabled={busy} onClick={async () => {
            setBusy(true); setError(null);
            try {
              addPostToTop(await createPost({ eventId: e.id, body: caption.trim() }));
              setShared(true); setCaption(''); setOpen(null);
            } catch (err) { setError(err instanceof ApiError ? err.message : 'Couldn’t share. Try again.'); }
            finally { setBusy(false); }
          }}>{busy ? 'Sharing…' : 'Share'}</button>
          <button type="button" className="sheet-row muted" onClick={() => setOpen(null)}>Cancel</button>
        </Sheet>
      )}

      {open === 'menu' && (e.canManage ? (
        <Sheet title="Event options" onClose={() => setOpen(null)}>
          <div className="sheet-actions">
            {!over && <Link to={`/events/${e.id}/edit`} className="sheet-row btn-link">Edit event</Link>}
            {!over && (e.cancelled
              ? <button type="button" className="sheet-row" disabled={busy} onClick={() => setCancelled(false)}>Restore event</button>
              : <button type="button" className="sheet-row danger" onClick={() => setOpen('cancel')}>Cancel event</button>)}
            <button type="button" className="sheet-row danger" onClick={() => setOpen('delete')}>Delete event</button>
            <button type="button" className="sheet-row muted" onClick={() => setOpen(null)}>Close</button>
          </div>
        </Sheet>
      ) : (
        <ContentMenu kind="event" targetId={e.id} author={e.createdBy} isOwn={false} canDelete={!!me?.isAdmin}
          onDelete={async () => { await deleteEvent(e.id); navigate('/events', { replace: true }); }}
          onBlocked={() => navigate('/events', { replace: true })} onClose={() => setOpen(null)} />
      ))}

      {open === 'cancel' && (
        <Sheet title="Cancel this event?" onClose={() => setOpen(null)}>
          <p className="sheet-text">It stays listed as cancelled, and everyone going or interested gets a notification.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn danger" disabled={busy} onClick={() => setCancelled(true)}>{busy ? 'Cancelling…' : 'Cancel event'}</button>
            <button type="button" className="sheet-row muted" onClick={() => setOpen(null)}>Keep it</button>
          </div>
        </Sheet>
      )}

      {open === 'delete' && (
        <Sheet title="Delete this event?" onClose={() => setOpen(null)}>
          <p className="sheet-text">It disappears for everyone, and no one is notified. To let people know, cancel it instead. This can’t be undone.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn danger" disabled={busy}
              onClick={() => run(async () => { await deleteEvent(e.id); navigate('/events', { replace: true }); }, 'Couldn’t delete. Try again.')}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" className="sheet-row muted" onClick={() => setOpen(null)}>Cancel</button>
          </div>
        </Sheet>
      )}

      {(open === 'going' || open === 'interested') && <Attendees eventId={e.id} status={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Attendees({ eventId, status, onClose }: { eventId: string; status: Rsvp; onClose: () => void }) {
  const [items, setItems] = useState<Attendee[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async (from: string | null) => {
    setFailed(false);
    try {
      const page = await getAttendees(eventId, status, from);
      setItems((prev) => (from && prev ? [...prev, ...page.items] : page.items)); setCursor(page.nextCursor);
    } catch { setFailed(true); setItems((prev) => prev ?? []); }
  }, [eventId, status]);
  useEffect(() => { void load(null); }, [load]);

  return (
    <Sheet title={status === 'going' ? 'Going' : 'Interested'} onClose={onClose}>
      {!items && <p className="sheet-text" role="status">Loading…</p>}
      {failed && <p className="error" role="alert">Didn’t load. <button type="button" className="linkish" onClick={() => load(null)}>Try again</button></p>}
      {items && (
        <ul className="list">
          {items.map((a) => (
            <li key={a.id} className="list-row">
              <Avatar name={a.name} photoUrl={a.photoUrl} size={40} />
              <span className="list-main"><strong>{a.name ?? 'Member'}</strong></span>
            </li>
          ))}
          {items.length === 0 && !failed && <li className="sheet-text">No one yet.</li>}
        </ul>
      )}
      {cursor && <button type="button" className="linkish" onClick={() => load(cursor)}>Show more</button>}
      <button type="button" className="sheet-row muted" onClick={onClose}>Close</button>
    </Sheet>
  );
}
