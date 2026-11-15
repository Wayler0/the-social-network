import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { ContentMenu } from '../components/ContentMenu';
import { Icon } from '../components/Icon';
import { PostCard } from '../components/PostCard';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addComment, COMMENT_MAX, deleteComment, getComments, getPost, timeAgo, type Comment, type Post } from '../lib/feed';

/** One post with its comments, oldest first, and a box to add one (issue #22). */
export function PostDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [p, c] = await Promise.all([getPost(id), getComments(id)]);
      setPost(p); setComments(c.items); setCursor(c.nextCursor); setState('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return setState('missing');
      setLoadError(err instanceof ApiError ? err.message : 'Couldn’t load this post. Check your connection.');
      setState('error');
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function more() {
    try {
      const c = await getComments(id, cursor);
      setComments((list) => [...list, ...c.items.filter((x) => !list.some((y) => y.id === x.id))]);
      setCursor(c.nextCursor);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Couldn’t load more comments.');
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || body.length > COMMENT_MAX || !post) return;
    setSending(true); setSendError(null);
    try {
      const c = await addComment(post.id, body);
      setComments((list) => [...list, c]);
      // Show the new comment above the sticky comment box.
      requestAnimationFrame(() => document.getElementById(`comment-${c.id}`)?.scrollIntoView({ block: 'nearest' }));
      setPost({ ...post, commentCount: post.commentCount + 1 });
      setText('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : 'Your comment didn’t send. Try again.');
    } finally { setSending(false); }
  }

  const back = (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
      <h1 className="topbar-title">Post</h1>
      <span style={{ width: 44 }} />
    </header>
  );

  if (state === 'loading') return <>{back}<p className="feed-foot" role="status">Loading…</p></>;
  if (state === 'missing' || !post) {
    return (
      <>{back}
        <section className="empty">
          <h1>{state === 'missing' ? 'Post not available' : 'Didn’t load'}</h1>
          <p>{state === 'missing' ? 'It may have been deleted or hidden.' : loadError}</p>
          {state === 'error' && <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={load}>Try again</button>}
        </section>
      </>
    );
  }

  const canDeleteComment = (c: Comment) => !!me && (c.author.id === me.id || post.author.id === me.id || me.isAdmin);

  return (
    <>
      {back}
      <PostCard post={post} linkToPost={false} onChange={setPost}
        onRemoved={() => navigate('/', { replace: true })}
        onBlocked={() => navigate('/', { replace: true })} />

      <section className="comments" aria-label="Comments">
        {comments.length === 0 && <p className="muted comments-empty">No comments yet. Say something kind.</p>}
        {comments.map((c) => (
          <div key={c.id} id={`comment-${c.id}`} className="comment">
            <Avatar name={c.author.name} photoUrl={c.author.photoUrl} size={32} />
            <div className="comment-main">
              <p className="comment-text"><strong>{c.author.name}</strong> {c.body}</p>
              <time className="post-meta" dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
            </div>
            <button type="button" className="icon-btn small" aria-label="Comment options" onClick={() => setMenuFor(c)}>
              <Icon name="more" size={18} />
            </button>
          </div>
        ))}
        {cursor && <button type="button" className="linkish comments-more" onClick={more}>Show more comments</button>}
      </section>

      <form className="comment-form" onSubmit={send}>
        <label htmlFor="comment" className="visually-hidden">Add a comment</label>
        <input id="comment" className="input" placeholder="Add a comment…" maxLength={COMMENT_MAX}
          value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="linkish" disabled={!text.trim() || sending}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
      {sendError && <p className="error comment-error" role="alert">{sendError}</p>}

      {menuFor && (
        <ContentMenu kind="comment" targetId={menuFor.id} author={menuFor.author}
          isOwn={!!me && menuFor.author.id === me.id} canDelete={canDeleteComment(menuFor)}
          onDelete={async () => {
            await deleteComment(menuFor.id);
            setComments((list) => list.filter((x) => x.id !== menuFor.id));
            setPost((p) => (p ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p));
          }}
          onBlocked={(authorId) => setComments((list) => list.filter((x) => x.author.id !== authorId))}
          onClose={() => setMenuFor(null)} />
      )}
    </>
  );
}
