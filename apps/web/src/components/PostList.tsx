import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import type { Page, Post } from '../lib/feed';
import { patchPost, removeAuthor, removePost } from '../lib/feed-store';
import { PostCard } from './PostCard';

/**
 * A list of posts loaded page by page as you scroll (a profile's posts, saved posts).
 * Likes, saves and deletes made here also reach the Home feed. `key` it by what it lists,
 * so switching lists starts fresh.
 */
export function PostList({ load, empty, onSaveChange }: {
  load: (cursor: string | null) => Promise<Page<Post>>;
  empty: ReactNode;
  /** Saved list: drop a post as soon as it is unsaved. */
  onSaveChange?: 'remove-unsaved';
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (from: string | null) => {
    setStatus(from ? 'more' : 'loading'); setError(null);
    try {
      const page = await load(from);
      setPosts((prev) => {
        const base = from ? prev : [];
        const seen = new Set(base.map((p) => p.id));
        return [...base, ...page.items.filter((p) => !seen.has(p.id))];
      });
      setCursor(page.nextCursor);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t load posts. Check your connection.');
      setStatus('error');
    }
  }, [load]);

  useEffect(() => { void fetchPage(null); }, [fetchPage]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || status !== 'ready' || !cursor) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting) void fetchPage(cursor); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, status, fetchPage]);

  const change = (p: Post) => {
    patchPost(p);
    setPosts((list) => (onSaveChange === 'remove-unsaved' && !p.savedByMe
      ? list.filter((x) => x.id !== p.id)
      : list.map((x) => (x.id === p.id ? p : x))));
  };
  const removed = (id: string) => { removePost(id); setPosts((list) => list.filter((x) => x.id !== id)); };
  const blocked = (authorId: string) => { removeAuthor(authorId); setPosts((list) => list.filter((x) => x.author.id !== authorId)); };

  if (status === 'loading') return <p className="feed-foot" role="status">Loading…</p>;
  if (status === 'error' && posts.length === 0) {
    return (
      <div className="feed-foot">
        <p role="alert" className="error">{error}</p>
        <button type="button" className="linkish" onClick={() => void fetchPage(null)}>Try again</button>
      </div>
    );
  }
  if (posts.length === 0) return <section className="empty" style={{ minHeight: 'auto', paddingTop: 24 }}>{empty}</section>;

  return (
    <div className="feed">
      {posts.map((p) => <PostCard key={p.id} post={p} onChange={change} onRemoved={removed} onBlocked={blocked} />)}
      <div ref={sentinel} />
      {status === 'more' && <p className="feed-foot" role="status">Loading more…</p>}
      {status === 'error' && (
        <div className="feed-foot">
          <p role="alert" className="error">{error}</p>
          <button type="button" className="linkish" onClick={() => void fetchPage(cursor)}>Try again</button>
        </div>
      )}
    </div>
  );
}
