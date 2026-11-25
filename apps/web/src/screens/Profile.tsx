import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { initials } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { PostList } from '../components/PostList';
import { useAuth } from '../lib/auth';
import { getSaved, getUserPosts } from '../lib/feed';
import { memberTypeLabel } from '../lib/profile';

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
  if (!me) return null;
  const show = (t: 'posts' | 'saved') => setParams(t === 'saved' ? { tab: 'saved' } : {}, { replace: true });
  const detail = me.memberType === 'staff' ? me.campus.name
    : me.memberType === 'alumni' ? [me.course, me.graduationYear && `Class of ${me.graduationYear}`].filter(Boolean).join(' · ')
    : [me.course, me.yearOfStudy && `Year ${me.yearOfStudy}`].filter(Boolean).join(' · ');

  return (
    <>
      <header className="topbar">
        <h1 className="topbar-title">Profile</h1>
        <Link to="/settings" className="icon-btn" aria-label="Settings and account"><Icon name="menu" /></Link>
      </header>
      <section className="profile-head">
        {me.photoUrl
          ? <img className="avatar-lg" src={me.photoUrl} alt="" />
          : <div className="avatar-lg" aria-hidden="true">{initials(me.name)}</div>}
        <div className="profile-id">
          <h2>{me.name}</h2>
          <div className="badges">
            {me.memberType && <span className="badge-pill">{memberTypeLabel[me.memberType]}</span>}
            {me.badges.map((b) => <span key={b} className="badge-pill strong">{b}</span>)}
          </div>
          {detail && <p className="muted">{detail}</p>}
        </div>
      </section>
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
