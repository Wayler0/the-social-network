import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { deletePost, likePost, plural, timeAgo, type Post } from '../lib/feed';
import { Avatar } from './Avatar';
import { ContentMenu } from './ContentMenu';
import { Icon } from './Icon';

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
  const [menu, setMenu] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const isOwn = !!me && post.author.id === me.id;
  const href = `/post/${post.id}`;

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

      {linkToPost
        ? <Link to={href} className="post-body-link"><p className="post-body">{post.body}</p></Link>
        : <p className="post-body">{post.body}</p>}

      {post.image && (
        <img className="post-image" src={post.image.url} width={post.image.width} height={post.image.height}
          alt="" loading="lazy" decoding="async" />
      )}

      <footer className="post-actions">
        <button type="button" className={`action${post.likedByMe ? ' liked' : ''}`} aria-pressed={post.likedByMe}
          aria-label={`${post.likedByMe ? 'Unlike' : 'Like'}, ${plural(post.likeCount, 'like')}`} onClick={toggleLike}>
          <Icon name="heart" fill={post.likedByMe ? 'currentColor' : 'none'} />
          <span>{post.likeCount}</span>
        </button>
        {linkToPost
          ? <Link to={href} className="action" aria-label={plural(post.commentCount, 'comment')}><Icon name="comment" /><span>{post.commentCount}</span></Link>
          : <span className="action static" aria-label={plural(post.commentCount, 'comment')}><Icon name="comment" /><span>{post.commentCount}</span></span>}
      </footer>
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
