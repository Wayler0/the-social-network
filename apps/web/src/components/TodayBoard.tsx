import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_SLUG } from '../config';
import { getAnnouncements, type Announcement } from '../lib/community';
import { timeAgo } from '../lib/feed';
import { Avatar } from './Avatar';
import { RichText } from './RichText';

const SEEN_KEY = `${APP_SLUG}.todaySeen`;
const today = () => new Date().toISOString().slice(0, 10);

/** Has the member already opened the app today? (Per device; only decides whether normal pins start open.) */
function seenToday(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === today(); } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, today()); } catch { /* storage blocked: always open, which is fine */ }
}

/**
 * Today board at the top of Home (CLAUDE.md section 4.7): pinned announcements from verified offices.
 * Urgent ones always show. Normal ones start open on the first visit of the day and can be collapsed.
 */
export function TodayBoard() {
  const [pins, setPins] = useState<Announcement[] | null>(null);
  const [open, setOpen] = useState(() => !seenToday());

  useEffect(() => {
    getAnnouncements().then((page) => setPins(page.items.filter((a) => a.pinned))).catch(() => setPins([]));
    markSeen();
  }, []);

  if (!pins || pins.length === 0) return null;
  const urgent = pins.filter((a) => a.urgency === 'urgent');
  const normal = pins.filter((a) => a.urgency === 'normal');
  const offices = [...new Map(pins.map((a) => [a.office.id, a.office])).values()];

  return (
    <section className="today" aria-labelledby="today-title">
      <div className="today-head">
        <h2 id="today-title">Today</h2>
        <Link to="/today" className="linkish">See all</Link>
      </div>
      <div className="today-offices" aria-hidden="true">
        {offices.map((o) => (
          <Link key={o.id} to="/today" className="story" tabIndex={-1}>
            <span className="story-ring"><Avatar name={o.name} photoUrl={o.photoUrl} size={52} /></span>
            <span className="story-name">{o.name}</span>
          </Link>
        ))}
      </div>
      {urgent.map((a) => <AnnouncementCard key={a.id} a={a} />)}
      {normal.length > 0 && (open
        ? <>
            {normal.map((a) => <AnnouncementCard key={a.id} a={a} />)}
            <button type="button" className="linkish today-toggle" onClick={() => setOpen(false)}>Hide announcements</button>
          </>
        : <button type="button" className="today-collapsed" onClick={() => setOpen(true)} aria-expanded="false">
            {normal.length} pinned announcement{normal.length === 1 ? '' : 's'} · Show
          </button>)}
    </section>
  );
}

export function AnnouncementCard({ a, action }: { a: Announcement; action?: React.ReactNode }) {
  return (
    <article className={`announcement${a.urgency === 'urgent' ? ' urgent' : ''}`}>
      <header className="announcement-head">
        <Avatar name={a.office.name} photoUrl={a.office.photoUrl} size={32} />
        <div className="post-who">
          <div className="post-name"><strong>{a.office.name}</strong>{a.office.verified && <span className="badge-pill strong">Official</span>}</div>
          <div className="post-meta">
            {a.urgency === 'urgent' && <span className="urgent-label">Urgent · </span>}
            <time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
          </div>
        </div>
        {action}
      </header>
      <h3 className="announcement-title">{a.title}</h3>
      <p className="announcement-body"><RichText text={a.body} /></p>
    </article>
  );
}
