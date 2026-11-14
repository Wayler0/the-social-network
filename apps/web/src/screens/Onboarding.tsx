import { Navigate, useNavigate } from 'react-router-dom';
import { ProfileForm } from '../components/ProfileForm';
import { APP_NAME } from '../config';
import { useAuth } from '../lib/auth';

/** Issue #7 — first-time profile, right after the code is verified. */
export function Onboarding() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  if (!me) return <Navigate to="/welcome" replace />;
  if (me.profileComplete) return <Navigate to="/" replace />;

  return (
    <main className="auth">
      <div className="auth-hero" style={{ paddingTop: 8 }}>
        <h1 className="screen-title">Set up your profile</h1>
        <p>A few details so classmates can find you on {APP_NAME} and we can add you to your class group.</p>
      </div>
      <ProfileForm me={me} submitLabel="Finish" onSaved={(m) => { setMe(m); navigate('/', { replace: true }); }} />
    </main>
  );
}
