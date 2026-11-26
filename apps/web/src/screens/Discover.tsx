import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { follow } from '../lib/feed';
import { getSuggestions, type SuggestedPerson } from '../lib/suggestions';
import { Icon, type IconName } from '../components/Icon';

const tiles: { to: string | null; title: string; text: string; icon: IconName; tone: string }[] = [
  { to: '/groups', title: 'Groups & clubs', text: 'Your class, clubs and interests', icon: 'people', tone: 'violet' },
  { to: '/ask', title: 'Ask a Senior', text: 'Questions about campus life, answered', icon: 'question', tone: 'mint' },
  { to: '/today', title: 'Today board', text: 'Official news from offices', icon: 'megaphone', tone: 'sunshine' },
  { to: '/events', title: 'Events', text: 'What’s on, and who’s going', icon: 'calendar', tone: 'coral' },
  { to: '/emergency', title: 'Emergency', text: 'Numbers to call, alert campus safety', icon: 'alert', tone: 'coral' },
];

/** Discover: the way into groups, Ask a Senior, the Today board and events (CLAUDE.md section 14). */
export function Discover() {
  return (
    <>
      <header className="topbar"><h1 className="topbar-title">Discover</h1></header>
      <Link to="/search" className="search-entry"><Icon name="discover" size={18} /> Search people, groups, posts</Link>
      <PeopleCards />
      <div className="tiles">
        {tiles.map((t) => {
          const inner = (<>
            <span className={`tile-icon ${t.tone}`}><Icon name={t.icon} /></span>
            <strong>{t.title}</strong>
            <span className="muted">{t.text}</span>
          </>);
          return t.to
            ? <Link key={t.title} to={t.to} className="tile">{inner}</Link>
            : <div key={t.title} className="tile disabled" aria-disabled="true">{inner}</div>;
        })}
      </div>
    </>
  );
}

/** "People in your course": a row of cards with Follow, from GET /api/suggestions. Hidden when empty. */
function PeopleCards() {
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => { getSuggestions().then((s) => setPeople(s.people.slice(0, 10))).catch(() => setPeople([])); }, []);
  if (!people || people.length === 0) return null;

  async function toggle(id: string) {
    const next = !on[id];
    setOn((s) => ({ ...s, [id]: next }));
    try { await follow('user', id, next); } catch { setOn((s) => ({ ...s, [id]: !next })); }
  }

  return (
    <section className="people-cards" aria-labelledby="people-cards-title">
      <div className="people-cards-head">
        <h2 id="people-cards-title">People you may know</h2>
        <Link to="/people" className="linkish">See all</Link>
      </div>
      <ul className="people-cards-row">
        {people.map((p) => (
          <li key={p.id} className="person-card">
            <Link to={`/u/${p.id}`} className="person-card-main">
              <Avatar name={p.name} photoUrl={p.photoUrl} size={60} />
              <strong>{p.name}</strong>
              <span className="muted">{p.reason || p.course}</span>
            </Link>
            <button type="button" className={`btn small-btn${on[p.id] ? ' secondary' : ''}`} aria-pressed={!!on[p.id]}
              aria-label={`${on[p.id] ? 'Unfollow' : 'Follow'} ${p.name}`} onClick={() => void toggle(p.id)}>
              {on[p.id] ? 'Following' : 'Follow'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
