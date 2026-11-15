import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { createGroup, getGroups, type Group } from '../lib/community';

export function GroupBadges({ g }: { g: Group }) {
  return (
    <span className="badges">
      {g.kind === 'club' && g.clubVerified && <span className="badge-pill strong">Club</span>}
      {g.isClassGroup && <span className="badge-pill">Class</span>}
      {g.visibility === 'private' && <span className="badge-pill">Private</span>}
      {g.studentOnly && <span className="badge-pill">Students only</span>}
    </span>
  );
}

/** Groups: the ones you're in, and the rest to discover (issue #25). */
export function Groups() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [items, setItems] = useState<Group[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (from: string | null) => {
    if (!from) setState('loading');
    try {
      const page = await getGroups(tab === 'mine', from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch { setState('error'); }
  }, [tab]);
  useEffect(() => { void load(null); }, [load]);

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Groups</h1>
        <Link to="/groups/new" className="icon-btn" aria-label="Create a group"><Icon name="plus" /></Link>
      </header>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>Your groups</button>
        <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Discover</button>
      </div>

      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && (
        <section className="empty"><h1>Didn’t load</h1><p>Check your connection.</p>
          <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => load(null)}>Try again</button></section>
      )}
      {state === 'ready' && items.length === 0 && (
        <section className="empty">
          <h1>{tab === 'mine' ? 'No groups yet' : 'Nothing to discover yet'}</h1>
          <p>{tab === 'mine' ? 'Join a club or start a group for your friends, hostel or course.' : 'Be the first to start one.'}</p>
          <Link to="/groups/new" className="btn btn-link" style={{ maxWidth: 200 }}>Create a group</Link>
        </section>
      )}

      <ul className="list">
        {items.map((g) => (
          <li key={g.id}>
            <Link to={`/groups/${g.id}`} className="list-row">
              <span className="group-icon" aria-hidden="true">{g.name.trim()[0]?.toUpperCase()}</span>
              <span className="list-main">
                <strong>{g.name}</strong>
                <GroupBadges g={g} />
                <span className="post-meta">
                  {g.memberCount !== null && `${g.memberCount} member${g.memberCount === 1 ? '' : 's'}`}
                  {g.myStatus === 'pending' && ' · Request sent'}
                  {g.myRole === 'admin' && ' · You’re an admin'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button>}
    </>
  );
}

/** Create a group: name, description, public or private, students only (issue #25). */
export function GroupNew() {
  const navigate = useNavigate();
  const { me } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [studentOnly, setStudentOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canStudentOnly = me?.memberType === 'fresher' || me?.memberType === 'continuing';
  const ok = name.trim().length >= 1 && name.trim().length <= 120;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError(null);
    try {
      const g = await createGroup({ name: name.trim(), description: description.trim() || undefined, visibility, ...(canStudentOnly ? { studentOnly } : {}) });
      navigate(`/groups/${g.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The group wasn’t created. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => navigate(-1)}><Icon name="close" /></button>
        <h1 className="topbar-title">New group</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen form-stack">
        <label className="field"><span>Name</span>
          <input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hostel B Football" />
        </label>
        <label className="field"><span>What’s it for? (optional)</span>
          <textarea className="input textarea" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <fieldset className="choice-group">
          <legend>Who can join</legend>
          <div className="choices two">
            {(['public', 'private'] as const).map((v) => (
              <label key={v} className={`choice${visibility === v ? ' selected' : ''}`}>
                <input type="radio" name="visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
                <strong>{v === 'public' ? 'Anyone' : 'By request'}</strong>
                <span>{v === 'public' ? 'Any member can join and see posts' : 'Admins approve; others see only the name'}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {canStudentOnly && (
          <label className="check">
            <input type="checkbox" checked={studentOnly} onChange={(e) => setStudentOnly(e.target.checked)} />
            <span><strong>Students only</strong> — staff can’t see or join it.</span>
          </label>
        )}
        <p className="hint">You’ll be the group’s admin. Admins moderate the group and can remove posts and members.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={!ok || busy}>{busy ? 'Creating…' : 'Create group'}</button>
      </div>
    </form>
  );
}
