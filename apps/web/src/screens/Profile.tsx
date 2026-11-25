import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { PostList } from '../components/PostList';
import { ProfileHeader, type FollowCounts } from '../components/ProfileHeader';
import { useAuth } from '../lib/auth';
import { getSaved, getUser, getUserPosts } from '../lib/feed';

/**
 * Issue #7 — your own profile, with your posts and the posts you saved (only you see Saved).
 * The tab is in the address (?tab=saved) so Back from a post returns to the same tab.
 */
export function Profile() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'saved' ? 'saved' : 'posts';
  const userId = me?.id;
  const loadPosts = useCallback((cursor: string | null) => getUserPosts(userId!, cursor), [userId]);
  const loadSaved = useCallback((cursor: string | null) => getSaved(cursor), []);
  // Follower counts come with the public profile (GET /api/users/:id), which works for yourself too.
  const [counts, setCounts] = useState<FollowCounts | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getUser(userId).then((u) => { if (alive) setCounts(u); }).catch(() => { /* counts are a nice-to-have */ });
    return () => { alive = false; };
  }, [userId]);
  if (!me) return null;
  const show = (t: 'posts' | 'saved') => setParams(t === 'saved' ? { tab: 'saved' } : {}, { replace: true });

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">Profile</h1>
        <Link to="/settings" className="icon-btn" aria-label="Settings and account"><Icon name="menu" /></Link>
      </header>
      <ProfileHeader p={me} campusName={me.campus.name} counts={counts} listLinks />
      <div style={{ padding: '0 16px 16px' }}>
        <Link to="/profile/edit" className="btn secondary btn-link">Edit profile</Link>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'posts'} className={tab === 'posts' ? 'active' : ''} onClick={() => show('posts')}>Posts</button>
        <button type="button" role="tab" aria-selected={tab === 'saved'} className={tab === 'saved' ? 'active' : ''} onClick={() => show('saved')}>Saved</button>
      </div>
      {tab === 'posts'
        ? <PostList key="posts" load={loadPosts} empty={<>
            <p>You haven’t posted yet.</p>
            <Link to="/create" className="btn btn-link" style={{ maxWidth: 200 }}>Write a post</Link>
          </>} />
        : <PostList key="saved" load={loadSaved} onSaveChange="remove-unsaved" empty={<>
            <p>Nothing saved yet. Tap the bookmark on a post to keep it here. Only you can see what you save.</p>
          </>} />}
    </>
  );
}
