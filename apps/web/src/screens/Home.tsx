import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { InstallBanner } from '../components/InstallBanner';
import { PostCard } from '../components/PostCard';
import { TodayBoard } from '../components/TodayBoard';
import { TopBar } from '../components/TopBar';
import { ApiError } from '../lib/api';
import { getFeed } from '../lib/feed';
import {
  appendPage, getFeedState, patchPost, removeAuthor, removePost, saveScroll, setFirstPage, useFeedState,
} from '../lib/feed-store';

/** After this long away, coming back to Home checks for new posts (quietly, above what you see). */
const STALE_MS = 60_000;

/** Tapping Home in the bottom nav while already on Home: back to the top and check for new posts. */
export const HOME_RESELECT = 'home-reselect';

/**
 * Home: the campus feed, newest first, loading more as you scroll (issues #4, #22).
 * The feed stays in memory (lib/feed-store.ts), so coming back from a post or another tab
 * shows the same posts at the same place, with no loading screen.
 */
export function Home() {
  const { posts, cursor, done } = useFeedState();
  const [status, setStatus] = useState<'loading' | 'ready' | 'more' | 'refreshing' | 'error'>(
    () => (getFeedState().posts.length ? 'ready' : 'loading'));
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const hasPosts = getFeedState().posts.length > 0;
    setStatus(hasPosts ? 'refreshing' : 'loading'); setError(null);
    try {
      const page = await getFeed(null);
      setFirstPage(page.items, page.nextCursor);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load the feed. Check your connection.');
      setStatus(hasPosts ? 'ready' : 'error'); // keep showing what we have
    }
  }, []);

  const loadMore = useCallback(async (from: string) => {
    setStatus('more'); setError(null);
    try {
      const page = await getFeed(from);
      appendPage(page.items, page.nextCursor);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load more posts. Check your connection.');
      setStatus('error');
    }
  }, []);

  // Back where you were, then a quiet check for new posts if it has been a while.
  useLayoutEffect(() => {
    const { scrollY } = getFeedState();
    if (scrollY) window.scrollTo(0, scrollY);
    return () => saveScroll(window.scrollY);
  }, []);
  useEffect(() => {
    if (Date.now() - getFeedState().loadedAt > STALE_MS) void refresh();
  }, [refresh]);

  useEffect(() => {
    const onReselect = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); void refresh(); };
    window.addEventListener(HOME_RESELECT, onReselect);
    return () => window.removeEventListener(HOME_RESELECT, onReselect);
  }, [refresh]);

  // Load the next page when the bottom of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || status !== 'ready' || !cursor) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void loadMore(cursor); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, done, status, loadMore]);

  return (
    <>
      <TopBar />
      <TodayBoard />
      <InstallBanner />
      {status === 'loading' && <FeedSkeleton />}
      {status === 'refreshing' && <p className="feed-refreshing" role="status">Checking for new posts…</p>}

      {status === 'error' && posts.length === 0 && (
        <section className="empty">
          <h1>Feed didn’t load</h1>
          <p role="alert">{error}</p>
          <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => void refresh()}>Try again</button>
        </section>
      )}

      {status === 'ready' && posts.length === 0 && (
        <section className="empty">
          <h1>Nothing here yet</h1>
          <p>Be the first to post something for campus.</p>
          <Link to="/create" className="btn btn-link" style={{ maxWidth: 200 }}>Write a post</Link>
        </section>
      )}

      {posts.length > 0 && (
        <div className="feed">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onChange={patchPost} onRemoved={removePost} onBlocked={removeAuthor} />
          ))}
          <div ref={sentinel} />
          {status === 'more' && <p className="feed-foot" role="status">Loading more…</p>}
          {status === 'error' && (
            <div className="feed-foot">
              <p role="alert" className="error">{error}</p>
              <button type="button" className="linkish" onClick={() => cursor ? void loadMore(cursor) : void refresh()}>Try again</button>
            </div>
          )}
          {done && <p className="feed-foot">You’re all caught up.</p>}
        </div>
      )}
    </>
  );
}

function FeedSkeleton() {
  return (
    <div className="feed" role="status" aria-label="Loading the feed">
      {[0, 1, 2].map((i) => (
        <div key={i} className="post skeleton">
          <div className="post-head"><span className="sk sk-avatar" /><span className="sk sk-line" style={{ width: '40%' }} /></div>
          <span className="sk sk-line" /><span className="sk sk-line" style={{ width: '70%' }} />
        </div>
      ))}
    </div>
  );
}
