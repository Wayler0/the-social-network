import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ContentMenu } from '../components/ContentMenu';
import { Icon } from '../components/Icon';
import { PostList } from '../components/PostList';
import { ProfileHeader } from '../components/ProfileHeader';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { follow, getUser, getUserPosts, type PublicProfile } from '../lib/feed';
import { removeAuthor } from '../lib/feed-store';

/**
 * Someone else's profile (GET /api/users/:id): who they are, follower counts, a Follow button
 * and their posts. Never their email or reg number. Report or block from the "…" menu.
 * Blocked, deleted or unknown members show "not available".
 */
export function UserProfile() {
  const { id = '' } = useParams();
  const { me } = useAuth();
  const navigate = useNavigate();
  const [user, setUser] = useState<PublicProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const loadPosts = useCallback((cursor: string | null) => getUserPosts(id, cursor), [id]);

  const load = useCallback(async () => {
    setState('loading');
    try { setUser(await getUser(id)); setState('ready'); } catch (err) {
      if (err instanceof ApiError && err.status === 404) return setState('missing');
      setError(err instanceof ApiError ? err.message : 'Couldn’t load this profile. Check your connection.');
      setState('error');
    }
  }, [id]);
  useEffect(() => { if (!me || id !== me.id) void load(); }, [load, me, id]);

  if (me && id === me.id) return <Navigate to="/profile" replace />;

  async function toggleFollow() {
    if (!user) return;
    const on = !user.isFollowing;
    const before = user;
    // Show it straight away; put it back if the server says no.
    setUser({ ...user, isFollowing: on, followerCount: Math.max(0, user.followerCount + (on ? 1 : -1)) });
    setFollowError(null);
    try {
      const r = await follow('user', user.id, on);
      setUser((u) => (u ? { ...u, isFollowing: r.following, followerCount: r.followerCount } : u));
    } catch (err) {
      setUser(before);
      setFollowError(err instanceof ApiError ? err.message : 'Couldn’t update. Try again.');
    }
  }

  const top = (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
      <h1 className="topbar-title">{user?.name ?? 'Profile'}</h1>
      {user
        ? <button type="button" className="icon-btn" aria-label="Profile options" onClick={() => setMenu(true)}><Icon name="more" /></button>
        : <span style={{ width: 44 }} />}
    </header>
  );

  if (state === 'loading') return <>{top}<p className="feed-foot" role="status">Loading…</p></>;
  if (state !== 'ready' || !user) {
    return (
      <>{top}
        <section className="empty">
          <h1>{state === 'missing' ? 'Profile not available' : 'Didn’t load'}</h1>
          <p>{state === 'missing' ? 'This member may have deleted their account.' : error}</p>
          {state === 'error' && <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => void load()}>Try again</button>}
        </section>
      </>
    );
  }

  return (
    <>
      {top}
      <ProfileHeader p={user} counts={user}
        extra={user.followsYou ? <span className="badge-pill">Follows you</span> : null} />
      <div className="profile-actions">
        <button type="button" className={`btn${user.isFollowing ? ' secondary' : ''}`} aria-pressed={user.isFollowing} onClick={() => void toggleFollow()}>
          {user.isFollowing ? 'Following' : user.followsYou ? 'Follow back' : 'Follow'}
        </button>
      </div>
      {followError && <p className="error post-error" role="alert">{followError}</p>}
      <h2 className="section-label">Posts</h2>
      <PostList key={id} load={loadPosts} empty={<p>No posts yet.</p>} />
      {menu && (
        <ContentMenu kind="profile" targetId={user.id} author={{ id: user.id, name: user.name ?? '', photoUrl: user.photoUrl, badges: user.badges }}
          isOwn={false} canDelete={false} onDelete={async () => undefined}
          onBlocked={(authorId) => { removeAuthor(authorId); navigate(-1); }}
          onClose={() => setMenu(false)} />
      )}
    </>
  );
}
