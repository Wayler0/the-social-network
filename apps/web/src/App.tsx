import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Placeholder } from './components/Placeholder';
import { useAuth } from './lib/auth';
import { Home } from './screens/Home';
import { Profile } from './screens/Profile';
import { ReelsComingSoon } from './screens/ReelsComingSoon';
import { SignUp } from './screens/SignUp';
import { VerifyCode } from './screens/VerifyCode';

function RequireAuth() {
  const { signedIn } = useAuth();
  return signedIn ? <Outlet /> : <Navigate to="/welcome" replace />;
}

function GuestOnly() {
  const { signedIn } = useAuth();
  return signedIn ? <Navigate to="/" replace /> : <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/welcome" element={<SignUp />} />
        <Route path="/verify" element={<VerifyCode />} />
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
