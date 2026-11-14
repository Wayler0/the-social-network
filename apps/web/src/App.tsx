import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Placeholder } from './components/Placeholder';
import { useAuth } from './lib/auth';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { ReelsComingSoon } from './screens/ReelsComingSoon';
import { SignUp } from './screens/SignUp';
import { VerifyCode } from './screens/VerifyCode';

/** While the app asks the API who is signed in. */
function Splash() {
  return <main className="auth" aria-busy="true"><p className="hint" style={{ margin: 'auto' }}>Loading…</p></main>;
}

/** Signed in, with a finished profile (the API refuses posting and joining until then). */
function RequireAuth() {
  const { status, me } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') return <Navigate to="/welcome" replace />;
  if (!me!.profileComplete) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Signed in, profile not finished yet. */
function RequireOnboarding() {
  const { status, me } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut') return <Navigate to="/welcome" replace />;
  if (me!.profileComplete) return <Navigate to="/" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  return status === 'signedIn' ? <Navigate to="/" replace /> : <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/welcome" element={<SignUp />} />
        <Route path="/verify" element={<VerifyCode />} />
      </Route>

      <Route element={<RequireOnboarding />}>
        <Route path="/onboarding" element={<Onboarding />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="discover" element={<Placeholder title="Discover" text="Search, groups, Ask a Senior, Events and Market." />} />
          <Route path="create" element={<Placeholder title="New post" text="The post composer arrives in week 2." />} />
          <Route path="reels" element={<ReelsComingSoon />} />
          <Route path="profile" element={<Profile />} />
          <Route path="notifications" element={<Placeholder title="Notifications" text="Likes, comments and replies will show here." />} />
          <Route path="messages" element={<Placeholder title="Messages" text="End-to-end encrypted chat arrives in v0.2." />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
