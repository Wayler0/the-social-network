import { useLayoutEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Placeholder } from './components/Placeholder';
import { useAuth } from './lib/auth';
import { APP_NAME } from './config';
import { rememberReturnTo } from './lib/return-to';
import { EditProfile } from './screens/EditProfile';
import { Home } from './screens/Home';
import { Admin } from './screens/Admin';
import { Ask, AskQuestion } from './screens/Ask';
import { Compose } from './screens/Compose';
import { EventDetail } from './screens/EventDetail';
import { EventForm } from './screens/EventForm';
import { Events } from './screens/Events';
import { Discover } from './screens/Discover';
import { Search } from './screens/Search';
import { Help } from './screens/Help';
import { GroupPage } from './screens/GroupPage';
import { GroupNew, Groups } from './screens/Groups';
import { Today } from './screens/Today';
import { Notifications } from './screens/Notifications';
import { NotificationSettings } from './screens/NotificationSettings';
import { Onboarding } from './screens/Onboarding';
import { PostDetail } from './screens/PostDetail';
import { FollowList } from './screens/FollowList';
import { FollowSuggestions } from './screens/FollowSuggestions';
import { Profile } from './screens/Profile';
import { UserProfile } from './screens/UserProfile';
import { ReelsComingSoon } from './screens/ReelsComingSoon';
import { Settings } from './screens/Settings';
import { PrivacyPolicy, Terms } from './screens/Legal';
import { StoryNew } from './screens/StoryNew';
import { StoryPage } from './screens/StoryPage';
import { SignUp } from './screens/SignUp';
import { VerifyCode } from './screens/VerifyCode';

function Splash() {
  return <div className="splash" role="status" aria-label="Loading" />;
}

/** Signed in with a finished profile; otherwise send to sign-in or onboarding. */
/** The server couldn't be reached. You are NOT signed out: keep the session and try again. */
function Unreachable() {
  const { retryNow } = useAuth();
  return (
    <main className="empty" style={{ minHeight: '100dvh' }}>
      <h1>Can’t reach {APP_NAME}</h1>
      <p>Check your data or Wi-Fi. You’re still signed in; we’ll keep trying.</p>
      <button type="button" className="btn" style={{ maxWidth: 220 }} onClick={retryNow}>Try again</button>
    </main>
  );
}

function RequireAuth() {
  const { status, me } = useAuth();
  const { pathname, search } = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'unreachable') return <Unreachable />;
  if (status === 'signedOut' || !me) {
    rememberReturnTo(pathname + search); // e.g. a shared post link: go there after sign-in
    return <Navigate to="/welcome" replace />;
  }
  if (!me.profileComplete && pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'unreachable') return <Unreachable />;
  return status === 'signedIn' ? <Navigate to="/" replace /> : <Outlet />;
}

/** Each screen opens at the top. Home is the exception: it puts you back where you were in the feed. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => { if (pathname !== '/') window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export function App() {
  return (
    <>
    <ScrollToTop />
    <Routes>
      {/* Public: readable before signing in (linked from sign-up). */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/help" element={<Help />} />
      <Route element={<GuestOnly />}>
        <Route path="/welcome" element={<SignUp />} />
        <Route path="/verify" element={<VerifyCode />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/onboarding/follow" element={<div className="shell"><FollowSuggestions onboarding /></div>} />
        {/* Full-screen pages without the bottom nav, still in the one-column frame. */}
        <Route element={<div className="shell"><Outlet /></div>}>
          <Route path="/profile/edit" element={<EditProfile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/notifications" element={<NotificationSettings />} />
          <Route path="/create" element={<Compose />} />
          <Route path="/story/new" element={<StoryNew />} />
          <Route path="/story/:id" element={<StoryPage />} />
          <Route path="/people" element={<FollowSuggestions />} />
          <Route path="/search" element={<Search />} />
          <Route path="/post/:id" element={<PostDetail />} />
          <Route path="/groups/new" element={<GroupNew />} />
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="/ask/:id" element={<AskQuestion />} />
          <Route path="/events/new" element={<EventForm />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/events/:id/edit" element={<EventForm />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route path="discover" element={<Discover />} />
          <Route path="groups" element={<Groups />} />
          <Route path="ask" element={<Ask />} />
          <Route path="events" element={<Events />} />
          <Route path="today" element={<Today />} />
          <Route path="reels" element={<ReelsComingSoon />} />
          <Route path="profile" element={<Profile />} />
          <Route path="profile/followers" element={<FollowList which="followers" />} />
          <Route path="profile/following" element={<FollowList which="following" />} />
          <Route path="u/:id" element={<UserProfile />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="messages" element={<Placeholder title="Messages" text="End-to-end encrypted chat arrives in v0.2." />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
