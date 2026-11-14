import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ProfileForm } from '../components/ProfileForm';
import { useAuth } from '../lib/auth';

/** Issue #7 — edit profile. */
export function EditProfile() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <>
      <header className="topbar">
        <Link to="/profile" className="icon-btn" aria-label="Back to profile"><Icon name="back" /></Link>
        <h1 className="topbar-title">Edit profile</h1>
        <span style={{ width: 44 }} />
      </header>
      <div className="screen">
        <ProfileForm me={me} submitLabel="Save" onSaved={(m) => { setMe(m); navigate('/profile'); }} />
      </div>
    </>
  );
}
