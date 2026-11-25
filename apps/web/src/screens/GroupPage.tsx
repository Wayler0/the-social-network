import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ContentMenu } from '../components/ContentMenu';
import { EventCard } from '../components/EventCard';
import { Icon } from '../components/Icon';
import { PostCard } from '../components/PostCard';
import { Sheet } from '../components/Sheet';
import { setClubVerified } from '../lib/admin';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  answerRequest, getGroup, getGroupPosts, getMembers, getRequests, joinGroup, leaveGroup,
  type Channel, type Group, type JoinRequest, type Member,
} from '../lib/community';
import { getEvents, type CampusEvent } from '../lib/events';
import { follow, type Post } from '../lib/feed';
import { GroupBadges } from './Groups';

/**
 * One group: about, join/leave, its posts (members only), members, and join requests for admins (issue #25).
 * Clubs (CLAUDE.md section 4, Club pages): Follow, an Announcements tab (admins post; members and
 * followers read; anyone may read a public club's) and a Discussion tab for members.
 */
export function GroupPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState<'posts' | 'announcements' | 'discussion' | 'events' | 'members' | 'requests'>('posts');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [menu, setMenu] = useState(false);

  const load = useCallback(async () => {
    try { setGroup(await getGroup(id)); setState('ready'); } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? 'missing' : 'error');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const top = (title: string) => (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
      <h1 className="topbar-title">{title}</h1>
      {group ? <button type="button" className="icon-btn" aria-label="Group options" onClick={() => setMenu(true)}><Icon name="more" /></button>
        : <span style={{ width: 44 }} />}
    </header>
  );

  if (state === 'loading') return <>{top('Group')}<p className="feed-foot" role="status">Loading…</p></>;
  if (state !== 'ready' || !group) {
    return (<>{top('Group')}<section className="empty">
      <h1>{state === 'missing' ? 'Group not available' : 'Didn’t load'}</h1>
      <p>{state === 'missing' ? 'It may have been removed, or it isn’t open to you.' : 'Check your connection.'}</p>
      {state === 'error' && <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={load}>Try again</button>}
    </section></>);
  }

  const member = group.myStatus === 'active';
  const admin = group.myRole === 'admin';
  const canPost = member && (group.posting === 'everyone' || admin);
  const club = group.kind === 'club';
  const clubTab = tab === 'posts' ? 'announcements' : tab;

  async function toggleFollow() {
    const before = group!;
    const on = !before.following;
    // Show it straight away; put it back if the server says no.
    setGroup({ ...before, following: on, followerCount: before.followerCount === null ? null : Math.max(0, before.followerCount + (on ? 1 : -1)) });
    try {
      const r = await follow('group', before.id, on);
      setGroup((g) => (g ? { ...g, following: r.following, followerCount: r.followerCount } : g));
    } catch (err) {
      setGroup(before);
      setError(err instanceof ApiError ? err.message : 'Couldn’t update. Try again.');
    }
  }

  async function join() {
    setBusy(true); setError(null);
    try {
      const r = await joinGroup(group!.id);
      setGroup({ ...group!, myStatus: r.status, myRole: r.status === 'active' ? 'member' : null,
        memberCount: r.status === 'active' && group!.memberCount !== null ? group!.memberCount + 1 : group!.memberCount });
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Couldn’t join. Try again.'); }
    finally { setBusy(false); }
  }

  async function leave() {
    setBusy(true); setError(null);
    try {
      await leaveGroup(group!.id);
      setConfirmLeave(false);
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Couldn’t leave. Try again.'); setConfirmLeave(false); }
    finally { setBusy(false); }
  }

  return (
    <>
      {top(group.name)}
      <section className="group-head">
        <span className="group-icon large" aria-hidden="true">{group.name.trim()[0]?.toUpperCase()}</span>
        <h2>{group.name}</h2>
        <GroupBadges g={group} />
        {(group.memberCount !== null || group.followerCount !== null) && (
          <p className="post-meta">
            {[group.memberCount !== null && `${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`,
              group.followerCount !== null && `${group.followerCount} follower${group.followerCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </p>
        )}
        {group.description && <p className="group-desc">{group.description}</p>}
        {!club && group.posting === 'admins_only' && <p className="hint">Only admins post here.</p>}
        {club && <p className="hint">Follow to get its announcements in your feed.{group.visibility === 'public' ? ' Join to take part in the discussion.' : ''}</p>}

        <div className="group-actions">
          {group.myStatus === 'none' && !group.isClassGroup && (
            <button type="button" className="btn" disabled={busy} onClick={join}>
              {group.visibility === 'public' ? 'Join group' : 'Ask to join'}
            </button>
          )}
          {group.myStatus === 'pending' && <button type="button" className="btn secondary" disabled>Request sent</button>}
          {group.canFollow && (
            <button type="button" className={`btn${group.following ? ' secondary' : ''}`} aria-pressed={group.following} onClick={() => void toggleFollow()}>
              {group.following ? 'Following' : 'Follow'}
            </button>
          )}
          {club && admin && <Link to={`/create?group=${group.id}&announcement=1`} className="btn btn-link">Post announcement</Link>}
          {canPost && !(club && admin && group.posting === 'admins_only') && (
            <Link to={`/create?group=${group.id}`} className={`btn btn-link${club ? ' secondary' : ''}`}>{club ? 'Write in discussion' : 'Write a post'}</Link>
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {club && member ? (
        <>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={clubTab === 'announcements'} className={clubTab === 'announcements' ? 'active' : ''} onClick={() => setTab('announcements')}>Announcements</button>
            <button type="button" role="tab" aria-selected={clubTab === 'discussion'} className={clubTab === 'discussion' ? 'active' : ''} onClick={() => setTab('discussion')}>Discussion</button>
            <button type="button" role="tab" aria-selected={tab === 'events'} className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Events</button>
            <button type="button" role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>
            {admin && group.visibility === 'private' && (
              <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Requests</button>
            )}
          </div>
          {clubTab === 'announcements' && <GroupPosts key="ann" groupId={group.id} channel="announcements" empty="No announcements yet." />}
          {clubTab === 'discussion' && <GroupPosts key="disc" groupId={group.id} channel="discussion" empty="No discussion yet. Start one." />}
          {tab === 'events' && <GroupEvents groupId={group.id} canCreate={canPost} />}
          {tab === 'members' && <Members groupId={group.id} />}
          {tab === 'requests' && <Requests groupId={group.id} onApproved={() => setGroup((g) => (g && g.memberCount !== null ? { ...g, memberCount: g.memberCount + 1 } : g))} />}
        </>
      ) : club && group.visibility === 'public' ? (
        <>
          <h2 className="section-label">Announcements</h2>
          <GroupPosts key="ann-public" groupId={group.id} channel="all" empty="No announcements yet." />
        </>
      ) : member ? (
        <>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'posts'} className={tab === 'posts' ? 'active' : ''} onClick={() => setTab('posts')}>Posts</button>
            <button type="button" role="tab" aria-selected={tab === 'events'} className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>Events</button>
            <button type="button" role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>
            {admin && group.visibility === 'private' && !group.isClassGroup && (
              <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Requests</button>
            )}
          </div>
          {tab === 'posts' && <GroupPosts groupId={group.id} />}
          {tab === 'events' && <GroupEvents groupId={group.id} canCreate={canPost} />}
          {tab === 'members' && <Members groupId={group.id} />}
          {tab === 'requests' && <Requests groupId={group.id} onApproved={() => setGroup((g) => (g && g.memberCount !== null ? { ...g, memberCount: g.memberCount + 1 } : g))} />}
        </>
      ) : (
        <p className="feed-foot">{group.visibility === 'private' ? 'Posts are visible to members only.' : 'Join to see and write posts.'}</p>
      )}

      {menu && (
        <GroupMenu group={group} onClose={() => setMenu(false)} onChange={setGroup}
          onLeave={() => { setMenu(false); setConfirmLeave(true); }} />
      )}
      {confirmLeave && (
        <Sheet title={`Leave ${group.name}?`} onClose={() => setConfirmLeave(false)}>
          <p className="sheet-text">{group.visibility === 'private' ? 'To come back you’ll need an admin to accept you again.' : 'You can join again any time.'}</p>
          <div className="sheet-actions">
            <button type="button" className="btn danger" disabled={busy} onClick={leave}>{busy ? 'Leaving…' : 'Leave group'}</button>
            <button type="button" className="sheet-row muted" onClick={() => setConfirmLeave(false)}>Cancel</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** Report the group, or leave it. Reporting uses the shared menu with the group as the target. */
function GroupMenu({ group, onClose, onLeave, onChange }: { group: Group; onClose: () => void; onLeave: () => void; onChange: (g: Group) => void }) {
  const { me } = useAuth();
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (reporting) {
    return (
      <ContentMenu kind="group" targetId={group.id} author={{ id: null, name: group.name, photoUrl: null, badges: [] }}
        isOwn={false} canDelete={false} startAt="report" onDelete={async () => {}} onBlocked={() => {}} onClose={onClose} />
    );
  }
  const canLeave = group.myStatus !== 'none' && !group.isClassGroup;
  return (
    <Sheet title="Group options" onClose={onClose}>
      <div className="sheet-actions">
        <button type="button" className="sheet-row" onClick={() => setReporting(true)}>Report group</button>
        {me?.isAdmin && !group.isClassGroup && (
          // Admins give the CLUB badge after checking the Dean of Students' list of registered societies.
          <button type="button" className="sheet-row" onClick={async () => {
            setError(null);
            try {
              const r = await setClubVerified(group.id, !group.clubVerified);
              onChange({ ...group, clubVerified: r.clubVerified, kind: r.clubVerified ? 'club' : group.kind }); onClose();
            } catch (err) { setError(err instanceof ApiError ? err.message : 'That didn’t work.'); }
          }}>{group.clubVerified ? 'Remove CLUB badge' : 'Give CLUB badge (registered society)'}</button>
        )}
        {canLeave && <button type="button" className="sheet-row danger" onClick={onLeave}>{group.myStatus === 'pending' ? 'Cancel request' : 'Leave group'}</button>}
        <button type="button" className="sheet-row muted" onClick={onClose}>Cancel</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </Sheet>
  );
}

function GroupPosts({ groupId, channel = 'all', empty = 'No posts yet.' }: { groupId: string; channel?: Channel; empty?: string }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async (from: string | null) => {
    try {
      const page = await getGroupPosts(groupId, from, channel);
      setPosts((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch { setState('error'); }
  }, [groupId, channel]);
  useEffect(() => { void load(null); }, [load]);

  if (state === 'loading') return <p className="feed-foot" role="status">Loading…</p>;
  if (state === 'error') return <p className="feed-foot" role="alert">Posts didn’t load. <button type="button" className="linkish" onClick={() => load(null)}>Try again</button></p>;
  if (posts.length === 0) return <p className="feed-foot">{empty}</p>;
  return (
    <div className="feed">
      {posts.map((p) => (
        <PostCard key={p.id} post={{ ...p, group: null }}
          onChange={(n) => setPosts((l) => l.map((x) => (x.id === n.id ? n : x)))}
          onRemoved={(rid) => setPosts((l) => l.filter((x) => x.id !== rid))}
          onBlocked={(aid) => setPosts((l) => l.filter((x) => x.author.id !== aid))} />
      ))}
      {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button>}
    </div>
  );
}

/** The group's upcoming events; members who may post here may also host one. */
function GroupEvents({ groupId, canCreate }: { groupId: string; canCreate: boolean }) {
  const [items, setItems] = useState<CampusEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async (from: string | null) => {
    try {
      const page = await getEvents('upcoming', { groupId, cursor: from });
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor); setState('ready');
    } catch { setState('error'); }
  }, [groupId]);
  useEffect(() => { void load(null); }, [load]);

  return (
    <>
      {canCreate && (
        <div className="screen" style={{ paddingBottom: 4 }}>
          <Link to={`/events/new?group=${groupId}`} className="btn secondary btn-link">Host an event</Link>
        </div>
      )}
      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && <p className="feed-foot" role="alert">Events didn’t load. <button type="button" className="linkish" onClick={() => load(null)}>Try again</button></p>}
      {state === 'ready' && items.length === 0 && <p className="feed-foot">No upcoming events.</p>}
      <ul className="list">{items.map((e) => <li key={e.id}><EventCard e={e} /></li>)}</ul>
      {cursor && <button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button>}
    </>
  );
}

function Members({ groupId }: { groupId: string }) {
  const [items, setItems] = useState<Member[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const load = useCallback(async (from: string | null) => {
    try {
      const page = await getMembers(groupId, from);
      setItems((prev) => (from && prev ? [...prev, ...page.items] : page.items)); setCursor(page.nextCursor);
    } catch { setItems((prev) => prev ?? []); }
  }, [groupId]);
  useEffect(() => { void load(null); }, [load]);
  if (!items) return <p className="feed-foot" role="status">Loading…</p>;
  return (
    <ul className="list">
      {items.map((m) => (
        <li key={m.id} className="list-row">
          <Avatar name={m.name} photoUrl={m.photoUrl} size={40} />
          <span className="list-main"><strong>{m.name}</strong>
            <span className="post-meta">{m.role === 'admin' ? 'Admin' : 'Member'}</span></span>
        </li>
      ))}
      {cursor && <li><button type="button" className="linkish comments-more" onClick={() => load(cursor)}>Show more</button></li>}
    </ul>
  );
}

function Requests({ groupId, onApproved }: { groupId: string; onApproved: () => void }) {
  const [items, setItems] = useState<JoinRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getRequests(groupId).then((r) => setItems(r.items)).catch(() => setItems([])); }, [groupId]);

  async function decide(userId: string, approve: boolean) {
    setError(null);
    try {
      await answerRequest(groupId, userId, approve);
      setItems((l) => (l ?? []).filter((r) => r.id !== userId));
      if (approve) onApproved();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'That didn’t work. Try again.'); }
  }

  if (!items) return <p className="feed-foot" role="status">Loading…</p>;
  if (items.length === 0) return <p className="feed-foot">No one is waiting to join.</p>;
  return (
    <>
      {error && <p className="error" role="alert" style={{ padding: '8px 16px' }}>{error}</p>}
      <ul className="list">
        {items.map((r) => (
          <li key={r.id} className="list-row">
            <Avatar name={r.name} photoUrl={r.photoUrl} size={40} />
            <span className="list-main"><strong>{r.name}</strong><span className="post-meta">{r.memberType}</span></span>
            <button type="button" className="btn small-btn" onClick={() => decide(r.id, true)}>Accept</button>
            <button type="button" className="btn secondary small-btn" onClick={() => decide(r.id, false)}>Decline</button>
          </li>
        ))}
      </ul>
    </>
  );
}
