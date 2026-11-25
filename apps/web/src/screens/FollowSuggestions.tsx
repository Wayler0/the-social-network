import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { follow } from '../lib/feed';
import { takeReturnTo } from '../lib/return-to';
import { getSuggestions, type SuggestedClub, type SuggestedPerson } from '../lib/suggestions';

const GOAL_PEOPLE = 5;

/**
 * "Make Home yours": follow classmates and clubs so the first feed has people you know.
 * `onboarding`: the last step after a new profile (Skip or Continue go on to Home, or to a shared
 * link the member opened). Otherwise "People to follow" from Discover, with a Back button.
 */
export function FollowSuggestions({ onboarding = false }: { onboarding?: boolean }) {
  const navigate = useNavigate();
  const [people, setPeople] = useState<SuggestedPerson[] | null>(null);
  const [clubs, setClubs] = useState<SuggestedClub[]>([]);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSuggestions().then((s) => { setPeople(s.people); setClubs(s.clubs); })
      .catch((err) => { setPeople([]); setError(err instanceof ApiError ? err.message : 'Couldn’t load suggestions.'); });
  }, []);

  const done = () => navigate(takeReturnTo() ?? '/', { replace: true });

  async function toggle(type: 'user' | 'group', id: string) {
    const key = `${type}:${id}`;
    const next = !on[key];
    setOn((s) => ({ ...s, [key]: next })); // straight away; put back if the server says no
    setError(null);
    try { await follow(type, id, next); } catch (err) {
      setOn((s) => ({ ...s, [key]: !next }));
      setError(err instanceof ApiError ? err.message : 'Couldn’t update. Try again.');
    }
  }

  // Nobody to suggest during onboarding: go straight on rather than show an empty step.
  if (onboarding && people && people.length === 0 && clubs.length === 0 && !error) return <Navigate to={takeReturnTo() ?? '/'} replace />;

  const followedPeople = (people ?? []).filter((p) => on[`user:${p.id}`]).length;
  const button = (type: 'user' | 'group', id: string, name: string) => {
    const isOn = !!on[`${type}:${id}`];
    return (
      <button type="button" className={`btn small-btn follow-btn${isOn ? ' secondary' : ''}`} aria-pressed={isOn}
        aria-label={`${isOn ? 'Unfollow' : 'Follow'} ${name}`} onClick={() => void toggle(type, id)}>
        {isOn ? 'Following' : 'Follow'}
      </button>
    );
  };

  return (
    <div className="follow-step">
      {onboarding ? (
        <header className="follow-step-head">
          <h1 className="screen-title">Make Home yours</h1>
          <p className="muted">Follow classmates and clubs so your feed starts with people you know.</p>
          <span className={`count-chip${followedPeople >= GOAL_PEOPLE ? ' ok' : ''}`}>
            {followedPeople >= GOAL_PEOPLE ? `${followedPeople} people followed` : `${followedPeople} of ${GOAL_PEOPLE} people`}
          </span>
        </header>
      ) : (
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
          <h1 className="topbar-title">People to follow</h1>
          <span style={{ width: 44 }} />
        </header>
      )}

      {people === null && <p className="feed-foot" role="status">Finding people you may know…</p>}
      {error && <p className="error post-error" role="alert">{error}</p>}

      {people && people.length > 0 && (
        <section aria-labelledby="sugg-people">
          <h2 id="sugg-people" className="section-label">People</h2>
          <ul className="people-list">
            {people.map((p) => (
              <li key={p.id} className="person-row">
                <Link to={`/u/${p.id}`} className="person-main">
                  <Avatar name={p.name} photoUrl={p.photoUrl} size={44} />
                  <span><strong>{p.name}</strong>{p.badges.map((b) => <span key={b} className="badge-pill"> {b}</span>)}<br />
                    <span className="muted person-why">{[p.course, p.reason].filter(Boolean).join(' · ')}</span></span>
                </Link>
                {button('user', p.id, p.name)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {clubs.length > 0 && (
        <section aria-labelledby="sugg-clubs">
          <h2 id="sugg-clubs" className="section-label">Clubs</h2>
          <ul className="people-list">
            {clubs.map((c) => (
              <li key={c.id} className="person-row">
                <Link to={`/groups/${c.id}`} className="person-main">
                  <span className="group-icon" aria-hidden="true">{c.name.trim()[0]?.toUpperCase()}</span>
                  <span><strong>{c.name}</strong>{c.clubVerified && <span className="badge-pill strong"> Club</span>}<br />
                    <span className="muted person-why">{c.followerCount} follower{c.followerCount === 1 ? '' : 's'}</span></span>
                </Link>
                {button('group', c.id, c.name)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {people && people.length === 0 && clubs.length === 0 && !onboarding && (
        <section className="empty" style={{ minHeight: 'auto', paddingTop: 24 }}><p>No suggestions right now. Check back as more of your class joins.</p></section>
      )}

      {onboarding && (
        <footer className="follow-step-foot">
          <button type="button" className="btn" onClick={done}>{followedPeople > 0 ? 'Go to my feed' : 'Continue'}</button>
          <button type="button" className="linkish" onClick={done}>Skip for now</button>
        </footer>
      )}
    </div>
  );
}
