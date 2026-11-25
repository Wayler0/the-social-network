import { Navigate, useNavigate } from 'react-router-dom';
import { ProfileForm } from '../components/ProfileForm';
import { APP_NAME } from '../config';
import { useAuth } from '../lib/auth';
import { takeReturnTo } from '../lib/return-to';

/** Issue #7 — first-time profile, right after the code is verified. */
export function Onboarding() {
  const { me, setMe } = useAuth();
  const navigate = useNavigate();
  if (!me) return <Navigate to="/welcome" replace />;
  if (me.profileComplete) return <Navigate to="/" replace />;

  return (
    <main className="auth">
      <div className="auth-hero" style={{ paddingTop: 8 }}>
        {me.memberNumberNeedsFix ? <>
          <h1 className="screen-title">Update your registration number</h1>
          <p>The registration number on your account isn’t in the right format. Enter it exactly as it appears on your student ID, then tap Save.</p>
        </> : <>
          <h1 className="screen-title">Set up your profile</h1>
          <p>A few details so classmates can find you on {APP_NAME} and we can add you to your class group.</p>
        </>}
      </div>
      <ProfileForm me={me} submitLabel={me.memberNumberNeedsFix ? 'Save' : 'Finish'} onSaved={(m) => { setMe(m); navigate(takeReturnTo() ?? '/', { replace: true }); }} />
    </main>
  );
}
