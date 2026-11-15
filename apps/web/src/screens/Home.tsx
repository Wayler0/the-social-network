import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PostCard } from '../components/PostCard';
import { TopBar } from '../components/TopBar';
import { ApiError } from '../lib/api';
import { getFeed, type Post } from '../lib/feed';

/** Home: the campus feed, newest first, loading more as you scroll (issues #4, #22). */
export function Home() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async (from: string | null) => {
    setStatus(from ? 'more' : 'loading'); setError(null);
    try {
      const page = await getFeed(from);
      setPosts((prev) => {
        const base = from ? prev : [];
        const seen = new Set(base.map((p) => p.id));
        return [...base, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
      setDone(page.nextCursor === null);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load the feed. Check your connection.');
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(null); }, [load]);

  // Load the next page when the bottom of the list comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || status !== 'ready' || !cursor) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) void load(cursor); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, done, status, load]);

  const update = (p: Post) => setPosts((list) => list.map((x) => (x.id === p.id ? p : x)));
  const remove = (id: string) => setPosts((list) => list.filter((x) => x.id !== id));
  const hideAuthor = (authorId: string) => setPosts((list) => list.filter((x) => x.author.id !== authorId));

  return (
    <>
      <TopBar />
      {status === 'loading' && <FeedSkeleton />}

      {status === 'error' && posts.length === 0 && (
        <section className="empty">
          <h1>Feed didn’t load</h1>
          <p role="alert">{error}</p>
          <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => load(null)}>Try again</button>
        </section>
      )}

      {status !== 'loading' && status !== 'error' && posts.length === 0 && (
        <section className="empty">
          <h1>Nothing here yet</h1>
          <p>Be the first to post something for campus.</p>
          <Link to="/create" className="btn btn-link" style={{ maxWidth: 200 }}>Write a post</Link>
        </section>
      )}

      {posts.length > 0 && (
        <div className="feed">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onChange={update} onRemoved={remove} onBlocked={hideAuthor} />
          ))}
          <div ref={sentinel} />
          {status === 'more' && <p className="feed-foot" role="status">Loading more…</p>}
          {status === 'error' && (
            <div className="feed-foot">
              <p role="alert" className="error">{error}</p>
              <button type="button" className="linkish" onClick={() => load(cursor)}>Try again</button>
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
