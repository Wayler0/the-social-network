import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { follow, getFollowers, getFollowing, type Followed, type Follower } from '../lib/feed';

type Row = { key: string; id: string; name: string | null; photoUrl: string | null; href: string | null; note: string | null; followsBack?: boolean };

const followedHref = (f: Followed) => (f.type === 'user' ? `/u/${f.id}` : f.type === 'group' ? `/groups/${f.id}` : null);

/** Your followers, or who you follow (people, offices and clubs). Only your own lists exist. */
export function FollowList({ which }: { which: 'followers' | 'following' }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string | null) => {
    setStatus(from ? 'more' : 'loading'); setError(null);
    try {
      const next: Row[] = which === 'followers'
        ? (await getFollowers(from).then((p) => { setCursor(p.nextCursor); return p.items; }))
            .map((f: Follower) => ({ key: f.id, id: f.id, name: f.name, photoUrl: f.photoUrl, href: `/u/${f.id}`, note: null, followsBack: f.followsBack }))
        : (await getFollowing(from).then((p) => { setCursor(p.nextCursor); return p.items; }))
            .map((f: Followed) => ({ key: `${f.type}:${f.id}`, id: f.id, name: f.name, photoUrl: f.photoUrl, href: followedHref(f),
              note: f.type === 'office' ? 'Office' : f.type === 'group' ? 'Club' : null }));
      setRows((prev) => (from ? [...prev, ...next] : next));
      setStatus('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load. Check your connection.');
      setStatus('error');
    }
  }, [which]);
  useEffect(() => { void load(null); }, [load]);

  async function followBack(row: Row) {
    setRows((list) => list.map((r) => (r.key === row.key ? { ...r, followsBack: true } : r)));
    try { await follow('user', row.id, true); } catch {
      setRows((list) => list.map((r) => (r.key === row.key ? { ...r, followsBack: false } : r)));
    }
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">{which === 'followers' ? 'Followers' : 'Following'}</h1>
        <span style={{ width: 44 }} />
      </header>
      {status === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {status !== 'loading' && rows.length === 0 && status !== 'error' && (
        <section className="empty" style={{ minHeight: 'auto', paddingTop: 24 }}>
          <p>{which === 'followers' ? 'No followers yet. Post something and people will find you.' : 'You’re not following anyone yet. Tap a name on a post to see their profile.'}</p>
        </section>
      )}
      <ul className="people-list">
        {rows.map((r) => (
          <li key={r.key} className="person-row">
            {r.href
              ? <Link to={r.href} className="person-main"><Avatar name={r.name} photoUrl={r.photoUrl} /><span><strong>{r.name}</strong>{r.note && <span className="muted"> · {r.note}</span>}</span></Link>
              : <span className="person-main"><Avatar name={r.name} photoUrl={r.photoUrl} /><span><strong>{r.name}</strong>{r.note && <span className="muted"> · {r.note}</span>}</span></span>}
            {which === 'followers' && r.followsBack === false && (
              <button type="button" className="btn small-btn" onClick={() => void followBack(r)}>Follow back</button>
            )}
          </li>
        ))}
      </ul>
      {status === 'error' && (
        <div className="feed-foot"><p role="alert" className="error">{error}</p>
          <button type="button" className="linkish" onClick={() => void load(rows.length ? cursor : null)}>Try again</button></div>
      )}
      {cursor && status === 'ready' && <button type="button" className="linkish feed-foot" onClick={() => void load(cursor)}>Show more</button>}
    </>
  );
}
