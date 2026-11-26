import { Link } from 'react-router-dom';
import { timeAgo, type Post } from '../lib/feed';
import { Avatar } from './Avatar';
import { RichText } from './RichText';

/** The original post inside a repost (or a note when it is no longer available to you). */
export function RepostCard({ repost }: { repost: NonNullable<Post['repostOf']> }) {
  if (!repost.available) return <p className="repost-card unavailable">This post is no longer available.</p>;
  return (
    <Link to={`/post/${repost.id}`} className="repost-card">
      <span className="repost-head">
        <Avatar name={repost.author.name} photoUrl={repost.author.photoUrl} size={24} />
        <strong>{repost.author.name}</strong>
        {repost.author.badges.map((b) => <span key={b} className="badge-pill">{b}</span>)}
        <span className="muted">· {timeAgo(repost.createdAt)}</span>
      </span>
      {repost.body && <span className="repost-body"><RichText text={repost.body} /></span>}
      {repost.image && <img className="repost-image" src={repost.image.url} width={repost.image.width} height={repost.image.height} alt="" loading="lazy" decoding="async" />}
    </Link>
  );
}
