import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EventCard } from '../components/EventCard';
import { Icon } from '../components/Icon';
import { getEvents, getMyEvents, type CampusEvent } from '../lib/events';
import type { Page } from '../lib/feed';

type Tab = 'upcoming' | 'mine' | 'past';
const TABS: [Tab, string][] = [['upcoming', 'Upcoming'], ['mine', 'Your plans'], ['past', 'Past']];

const fetchTab = (tab: Tab, cursor: string | null): Promise<Page<CampusEvent>> =>
  tab === 'mine' ? getMyEvents(cursor) : getEvents(tab, { cursor });

/** Events on campus (docs/api-contract.md section 14): upcoming, the ones you said you'd go to, and past. */
export function Events() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [items, setItems] = useState<CampusEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (from: string | null) => {
    if (!from) setState('loading');
    try {
      const page = await fetchTab(tab, from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch { setState('error'); }
  }, [tab]);
  useEffect(() => { void load(null); }, [load]);

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Events</h1>
        <Link to="/events/new" className="icon-btn" aria-label="Create an event"><Icon name="plus" /></Link>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && (
        <section className="empty"><h1>Didn’t load</h1><p>Check your connection.</p>
          <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => load(null)}>Try again</button></section>
      )}
      {state === 'ready' && items.length === 0 && (
        <section className="empty">
          <h1>{tab === 'mine' ? 'No plans yet' : tab === 'past' ? 'No past events' : 'Nothing coming up'}</h1>
          <p>{tab === 'mine'
            ? 'Tap Going or Interested on an event and it shows up here.'
            : tab === 'past' ? 'Events that have ended show up here.' : 'Got something happening? Let campus know.'}</p>
          {tab === 'upcoming' && <Link to="/events/new" className="btn btn-link" style={{ maxWidth: 200 }}>Create an event</Link>}
        </section>
      )}

      {state === 'ready' && (
        <ul className="list">
          {items.map((e) => <li key={e.id}><EventCard e={e} /></li>)}
        </ul>
      )}
      {state === 'ready' && cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button>}
    </>
  );
}
