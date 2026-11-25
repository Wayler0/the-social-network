import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deletePost, likePost, plural, timeAgo, type Post } from '../lib/feed';
import { Avatar } from './Avatar';
import { ContentMenu } from './ContentMenu';
import { Icon } from './Icon';
import { PhotoViewer } from './PhotoViewer';
import { sharePost } from '../lib/share';
import { RichText } from './RichText';

/**
 * One post: author (or office), text, photo, like and comment counts, and the "…" menu.
 * `onChange` gets the updated post (likes); `onRemoved` the id of a deleted post; `onBlocked` the id of a blocked author.
 */
export function PostCard({ post, onChange, onRemoved, onBlocked, linkToPost = true }: {
  post: Post;
  onChange: (post: Post) => void;
  onRemoved: (id: string) => void;
  onBlocked: (authorId: string) => void;
  linkToPost?: boolean;
}) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const isOwn = !!me && post.author.id === me.id;
  const href = `/post/${post.id}`;

  async function share() {
    const result = await sharePost(post.id);
    const note = result === 'copied' ? 'Link copied. Only members can open it.'
      : result === 'failed' ? 'Couldn’t share. Copy the link from the address bar instead.' : null;
    setShareNote(note);
    if (note) window.setTimeout(() => setShareNote(null), 3000);
  }

  async function toggleLike() {
    const like = !post.likedByMe;
    // Show it straight away; put it back if the server says no.
    onChange({ ...post, likedByMe: like, likeCount: Math.max(0, post.likeCount + (like ? 1 : -1)) });
    setLikeError(null);
    try {
      const r = await likePost(post.id, like);
      onChange({ ...post, likedByMe: r.liked, likeCount: r.likeCount });
    } catch (err) {
      onChange(post);
      setLikeError(err instanceof ApiError ? err.message : 'Couldn’t save your like. Try again.');
    }
  }

  const who = post.office
    ? <><strong>{post.office.name}</strong>{post.office.verified && <span className="badge-pill strong">Official</span>}</>
    : <><strong>{post.author.name}</strong>{post.author.badges.map((b) => <span key={b} className="badge-pill">{b}</span>)}</>;

  return (
    <article className="post" aria-label={`Post by ${post.office?.name ?? post.author.name}`}>
      <header className="post-head">
        <Avatar name={post.office?.name ?? post.author.name} photoUrl={post.office?.photoUrl ?? post.author.photoUrl} />
        <div className="post-who">
          <div className="post-name">{who}</div>
          <div className="post-meta">
            {post.office && <span>by {post.author.name} · </span>}
            {post.group && <span>in {post.group.name} · </span>}
            <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{timeAgo(post.createdAt)}</time>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Post options" onClick={() => setMenu(true)}>
          <Icon name="more" />
        </button>
      </header>

      {/* Tapping the text opens the post (the comments button is the keyboard and screen-reader way);
          links inside the text open themselves instead. A link can't sit inside another link. */}
      <p className={`post-body${linkToPost ? ' tappable' : ''}`}
        onClick={linkToPost ? () => { if (!window.getSelection()?.toString()) navigate(href); } : undefined}>
        <RichText text={post.body} />
      </p>

      {post.image && (
        <button type="button" className="post-image-btn" aria-label="Open photo full screen" onClick={() => setViewing(true)}>
          <img className="post-image" src={post.image.url} width={post.image.width} height={post.image.height}
            alt="" loading="lazy" decoding="async" />
        </button>
      )}
      {viewing && post.image && <PhotoViewer src={post.image.url} alt="" name={post.id.slice(0, 8)} onClose={() => setViewing(false)} />}

      <footer className="post-actions">
        <button type="button" className={`action${post.likedByMe ? ' liked' : ''}`} aria-pressed={post.likedByMe}
          aria-label={`${post.likedByMe ? 'Unlike' : 'Like'}, ${plural(post.likeCount, 'like')}`} onClick={toggleLike}>
          <Icon name="heart" fill={post.likedByMe ? 'currentColor' : 'none'} />
          <span>{post.likeCount}</span>
        </button>
        {linkToPost
          ? <Link to={href} className="action" aria-label={plural(post.commentCount, 'comment')}><Icon name="comment" /><span>{post.commentCount}</span></Link>
          : <span className="action static" aria-label={plural(post.commentCount, 'comment')}><Icon name="comment" /><span>{post.commentCount}</span></span>}
        <button type="button" className="action" aria-label="Share link to this post" onClick={() => void share()}>
          <Icon name="share" />
        </button>
      </footer>
      {shareNote && <p className="hint post-error" role="status">{shareNote}</p>}
      {likeError && <p className="error post-error" role="alert">{likeError}</p>}

      {menu && (
        <ContentMenu kind="post" targetId={post.id} author={post.author} isOwn={isOwn}
          canDelete={isOwn || !!me?.isAdmin}
          onDelete={async () => { await deletePost(post.id); onRemoved(post.id); }}
          onBlocked={onBlocked} onClose={() => setMenu(false)} />
      )}
    </article>
  );
}
