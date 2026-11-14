import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Placeholder } from './components/Placeholder';
import { useAuth } from './lib/auth';
import { EditProfile } from './screens/EditProfile';
import { Home } from './screens/Home';
import { Onboarding } from './screens/Onboarding';
import { Profile } from './screens/Profile';
import { ReelsComingSoon } from './screens/ReelsComingSoon';
import { Settings } from './screens/Settings';
import { SignUp } from './screens/SignUp';
import { VerifyCode } from './screens/VerifyCode';

function Splash() {
  return <div className="splash" role="status" aria-label="Loading" />;
}

/** Signed in with a finished profile; otherwise send to sign-in or onboarding. */
function RequireAuth() {
  const { status, me } = useAuth();
  const { pathname } = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut' || !me) return <Navigate to="/welcome" replace />;
  if (!me.profileComplete && pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
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

      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<Onboarding />} />
        {/* Full-screen pages without the bottom nav, still in the one-column frame. */}
        <Route element={<div className="shell"><Outlet /></div>}>
          <Route path="/profile/edit" element={<EditProfile />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
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
