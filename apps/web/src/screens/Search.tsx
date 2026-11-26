import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { PostCard } from '../components/PostCard';
import { ApiError } from '../lib/api';
import { memberTypeLabel } from '../lib/profile';
import { search, SEARCH_MIN, type SearchResult, type SearchType } from '../lib/search';

const TABS: { type: SearchType; label: string }[] = [
  { type: 'all', label: 'All' }, { type: 'people', label: 'People' }, { type: 'groups', label: 'Groups' },
  { type: 'posts', label: 'Posts' }, { type: 'questions', label: 'Questions' },
];

/**
 * Search people, groups and clubs, posts and Ask a Senior questions (MVP item 10). Results as you
 * type (after a short pause). What you typed is kept in this page's history entry, not the address,
 * so Back from a result returns to it and names never appear in links.
 */
export function Search() {
  const navigate = useNavigate();
  const location = useLocation();
  const saved = (location.state ?? {}) as { q?: string; type?: SearchType };
  const [q, setQ] = useState(saved.q ?? '');
  const [type, setType] = useState<SearchType>(saved.type ?? 'all');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = q.trim();

  useEffect(() => { if (!saved.q) inputRef.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    navigate('.', { replace: true, state: { q, type } });
    if (term.length < SEARCH_MIN) { setResult(null); setStatus('idle'); return; }
    let stale = false;
    setStatus('loading');
    const timer = setTimeout(() => {
      search(term, type).then((r) => { if (!stale) { setResult(r); setStatus('ready'); } })
        .catch((err) => { if (!stale) { setStatus('error'); setError(err instanceof ApiError ? err.message : 'Couldn’t search. Check your connection and try again.'); } });
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [term, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = result;
  const empty = r && !r.people.length && !r.groups.length && !r.posts.length && !r.questions.length;
  const more = (t: SearchType, n: number) => type === 'all' && n >= 8 && (
    <button type="button" className="linkish search-more" onClick={() => setType(t)}>See all</button>
  );

  return (
    <>
      <header className="topbar search-bar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <form role="search" className="search-form" onSubmit={(e) => { e.preventDefault(); inputRef.current?.blur(); }}>
          <label htmlFor="search-q" className="visually-hidden">Search</label>
          <input id="search-q" ref={inputRef} type="search" enterKeyHint="search" autoComplete="off" maxLength={80}
            placeholder="Search people, groups, posts" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" className="icon-btn search-clear" aria-label="Clear search" onClick={() => { setQ(''); inputRef.current?.focus(); }}><Icon name="close" size={18} /></button>}
        </form>
      </header>

      <div className="tabs search-tabs" role="tablist" aria-label="What to search">
        {TABS.map((t) => (
          <button key={t.type} type="button" role="tab" aria-selected={type === t.type}
            className={`tab${type === t.type ? ' active' : ''}`} onClick={() => setType(t.type)}>{t.label}</button>
        ))}
      </div>

      {status === 'idle' && <p className="search-hint muted">Type at least {SEARCH_MIN} letters. Search finds names, groups, posts and questions, never emails or registration numbers.</p>}
      {status === 'loading' && !r && <p className="search-hint muted" role="status">Searching…</p>}
      {status === 'error' && <p className="error search-hint" role="alert">{error}</p>}
      {status !== 'error' && empty && <p className="search-hint muted" role="status">Nothing found for “{r!.q}”. Try another spelling or fewer words.</p>}

      {r && !empty && (
        <div aria-live="polite" aria-busy={status === 'loading'}>
          {r.people.length > 0 && (
            <section aria-label="People">
              {type === 'all' && <h2 className="search-section">People</h2>}
              <ul className="people-list">
                {r.people.map((p) => (
                  <li key={p.id} className="person-row">
                    <Link to={`/u/${p.id}`} className="person-main">
                      <Avatar name={p.name} photoUrl={p.photoUrl} />
                      <span><strong>{p.name}</strong>{p.badges.map((b) => <span key={b} className="badge-pill">{b}</span>)}
                        <span className="muted search-meta">{[memberTypeLabel[p.memberType], p.course, p.yearOfStudy ? `Year ${p.yearOfStudy}` : null].filter(Boolean).join(' · ')}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
              {more('people', r.people.length)}
            </section>
          )}
          {r.groups.length > 0 && (
            <section aria-label="Groups and clubs">
              {type === 'all' && <h2 className="search-section">Groups &amp; clubs</h2>}
              <ul className="people-list">
                {r.groups.map((g) => (
                  <li key={g.id} className="person-row">
                    <Link to={`/groups/${g.id}`} className="person-main">
                      <span className="group-mark" aria-hidden="true">{g.name.slice(0, 1).toUpperCase()}</span>
                      <span><strong>{g.name}</strong>{g.kind === 'club' && g.clubVerified && <span className="badge-pill">CLUB</span>}
                        <span className="muted search-meta">{g.visibility === 'private' ? 'Private' : 'Public'} · {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
              {more('groups', r.groups.length)}
            </section>
          )}
          {r.questions.length > 0 && (
            <section aria-label="Ask a Senior questions">
              {type === 'all' && <h2 className="search-section">Ask a Senior</h2>}
              <ul className="people-list">
                {r.questions.map((x) => (
                  <li key={x.id} className="person-row">
                    <Link to={`/ask/${x.id}`} className="person-main">
                      <span className="group-mark mint" aria-hidden="true"><Icon name="question" size={20} /></span>
                      <span><span className="search-question">{x.body}</span>
                        <span className="muted search-meta">{x.answerCount} {x.answerCount === 1 ? 'answer' : 'answers'}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
              {more('questions', r.questions.length)}
            </section>
          )}
          {r.posts.length > 0 && (
            <section aria-label="Posts">
              {type === 'all' && <h2 className="search-section">Posts</h2>}
              {r.posts.map((p) => (
                <PostCard key={p.id} post={p}
                  onChange={(next) => setResult((cur) => cur && { ...cur, posts: cur.posts.map((x) => (x.id === next.id ? next : x)) })}
                  onRemoved={() => setResult((cur) => cur && { ...cur, posts: cur.posts.filter((x) => x.id !== p.id) })}
                  onBlocked={() => setResult((cur) => cur && { ...cur, posts: cur.posts.filter((x) => x.author.id !== p.author.id) })} />
              ))}
              {more('posts', r.posts.length)}
            </section>
          )}
        </div>
      )}
    </>
  );
}
