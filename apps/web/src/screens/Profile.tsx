import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../lib/auth';
import { memberTypeLabel } from '../lib/profile';

function initials(name: string | null): string {
  if (!name) return '?';
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

/** Issue #7 — your own profile. Posts, groups and badges fill in as those features land. */
export function Profile() {
  const { me } = useAuth();
  if (!me) return null;
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
        <div className="avatar-lg" aria-hidden="true">{initials(me.name)}</div>
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
      <section className="empty" style={{ minHeight: 'auto', paddingTop: 24 }}>
        <p>Your posts will show here.</p>
      </section>
    </>
  );
}
