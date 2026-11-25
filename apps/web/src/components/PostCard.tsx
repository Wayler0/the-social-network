import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { follow, deletePost, REACTION_EMOJI, REACTION_LABEL, REACTIONS, reactToPost, savePost, type Reaction, plural, timeAgo, type Post } from '../lib/feed';
import { Avatar } from './Avatar';
import { ContentMenu } from './ContentMenu';
import { Icon } from './Icon';
import { PhotoViewer } from './PhotoViewer';
import { setFollowingAuthor } from '../lib/feed-store';
import { sharePost } from '../lib/share';
import { RichText } from './RichText';
import { dateTile, whenText } from '../lib/events';

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

  async function toggleSave() {
    const save = !post.savedByMe;
    onChange({ ...post, savedByMe: save }); // straight away; put back if the server says no
    setShareNote(save ? 'Saved. Find it on your profile.' : null);
    try {
      await savePost(post.id, save);
      if (save) window.setTimeout(() => setShareNote(null), 2500);
    } catch (err) {
      onChange(post);
      setShareNote(err instanceof ApiError ? err.message : 'Couldn’t save. Try again.');
    }
  }

  const [picker, setPicker] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  /** Set, change or (with null) remove my reaction. Shows straight away; puts it back if the server says no. */
  async function react(reaction: Reaction | null) {
    setPicker(false);
    const counts = { ...post.reactions };
    if (post.myReaction) counts[post.myReaction] = Math.max(0, (counts[post.myReaction] ?? 1) - 1);
    if (reaction) counts[reaction] = (counts[reaction] ?? 0) + 1;
    const delta = (reaction ? 1 : 0) - (post.myReaction ? 1 : 0);
    onChange({ ...post, myReaction: reaction, likedByMe: reaction !== null, reactions: counts, likeCount: Math.max(0, post.likeCount + delta) });
    setLikeError(null);
    try {
      const r = await reactToPost(post.id, reaction);
      onChange({ ...post, myReaction: r.myReaction, likedByMe: r.myReaction !== null, likeCount: r.likeCount, reactions: r.reactions });
    } catch (err) {
      onChange(post);
      setLikeError(err instanceof ApiError ? err.message : 'Couldn’t save your reaction. Try again.');
    }
  }
  // Tap: like / remove. Press and hold (or right-click): choose a reaction.
  const pressStart = () => {
    longPressed.current = false;
    pressTimer.current = window.setTimeout(() => { longPressed.current = true; setPicker(true); }, 450);
  };
  const pressEnd = () => { if (pressTimer.current) window.clearTimeout(pressTimer.current); };
  const tapLike = () => { if (longPressed.current) return; void react(post.myReaction ? null : 'like'); };
  const topReactions = REACTIONS.filter((r) => (post.reactions[r] ?? 0) > 0)
    .sort((a, b) => (post.reactions[b] ?? 0) - (post.reactions[a] ?? 0)).slice(0, 3);


  // Follow straight from a post: only on personal posts by someone you don't follow yet.
  const [followBusy, setFollowBusy] = useState(false);
  const canFollow = !post.office && !!post.author.id && !isOwn && !post.followingAuthor;
  async function followAuthor() {
    if (!post.author.id || followBusy) return;
    setFollowBusy(true);
    onChange({ ...post, followingAuthor: true });   // straight away; put back if the server says no
    try {
      await follow('user', post.author.id, true);
      setFollowingAuthor(post.author.id, true);       // their other posts in the feed too
    } catch {
      onChange({ ...post, followingAuthor: false });
    } finally { setFollowBusy(false); }
  }

  // Personal posts link to the author's profile (office pages come later).
  const profileHref = !post.office && post.author.id ? `/u/${post.author.id}` : null;
  const who = post.office
    ? <><strong>{post.office.name}</strong>{post.office.verified && <span className="badge-pill strong">Official</span>}</>
    : <><strong>{post.author.name}</strong>{post.author.badges.map((b) => <span key={b} className="badge-pill">{b}</span>)}</>;

  return (
    <article className="post" aria-label={`Post by ${post.office?.name ?? post.author.name}`}>
      <header className="post-head">
        {profileHref
          ? <Link to={profileHref} className="post-avatar-link" aria-hidden="true" tabIndex={-1}><Avatar name={post.author.name} photoUrl={post.author.photoUrl} /></Link>
          : <Avatar name={post.office?.name ?? post.author.name} photoUrl={post.office?.photoUrl ?? post.author.photoUrl} />}
        <div className="post-who">
          <div className="post-name">
            {profileHref ? <Link to={profileHref} className="post-name-link">{who}</Link> : who}
            {canFollow && (
              <><span className="post-dot" aria-hidden="true">·</span>
              <button type="button" className="post-follow" disabled={followBusy} onClick={() => void followAuthor()}
                aria-label={`Follow ${post.author.name}`}>Follow</button></>
            )}
          </div>
          <div className="post-meta">
            {post.office && <span>by {post.author.name} · </span>}
            {post.announcement && <span className="pill announce-pill">Announcement</span>}
            {post.group && <span>{post.announcement ? 'from' : 'in'} <Link to={`/groups/${post.group.id}`} className="post-group-link">{post.group.name}</Link> · </span>}
            <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{timeAgo(post.createdAt)}</time>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Post options" onClick={() => setMenu(true)}>
          <Icon name="more" />
        </button>
      </header>

      {/* Tapping the text opens the post (the comments button is the keyboard and screen-reader way);
          links inside the text open themselves instead. A link can't sit inside another link. */}
      {post.body && <p className={`post-body${linkToPost ? ' tappable' : ''}`}
        onClick={linkToPost ? () => { if (!window.getSelection()?.toString()) navigate(href); } : undefined}>
        <RichText text={post.body} />
      </p>}

      {post.event && (() => {
        const ev = post.event!;
        const tile = dateTile(ev.startsAt);
        return (
          <Link to={`/events/${ev.id}`} className={`post-event${ev.cancelled ? ' cancelled' : ''}`}>
            <span className="date-tile" aria-hidden="true"><span>{tile.month}</span><strong>{tile.day}</strong></span>
            <span className="post-event-main">
              <strong className="post-event-title">{ev.title}</strong>
              <span className="post-meta">{ev.cancelled ? 'Cancelled' : whenText(ev.startsAt, null)}{ev.location ? ` · ${ev.location}` : ''}</span>
              <span className="post-meta">{ev.goingCount} going{ev.myRsvp ? ` · You’re ${ev.myRsvp === 'going' ? 'going' : 'interested'}` : ''}</span>
            </span>
          </Link>
        );
      })()}

      {post.image && (
        <button type="button" className="post-image-btn" aria-label="Open photo full screen" onClick={() => setViewing(true)}>
          <img className="post-image" src={post.image.url} width={post.image.width} height={post.image.height}
            alt="" loading="lazy" decoding="async" />
        </button>
      )}
      {viewing && post.image && <PhotoViewer src={post.image.url} alt="" name={post.id.slice(0, 8)} onClose={() => setViewing(false)} />}

      <footer className="post-actions">
        <span className="react-wrap">
          <button type="button" className={`action${post.myReaction ? ' liked' : ''}`} aria-pressed={post.myReaction !== null}
            aria-label={`${post.myReaction ? `Remove ${REACTION_LABEL[post.myReaction]}` : 'Like'}, ${plural(post.likeCount, 'reaction')}. Press and hold for more reactions`}
            onClick={tapLike} onPointerDown={pressStart} onPointerUp={pressEnd} onPointerLeave={pressEnd}
            onContextMenu={(e) => { e.preventDefault(); setPicker(true); }}>
            {post.myReaction && post.myReaction !== 'like'
              ? <span className="react-emoji" aria-hidden="true">{REACTION_EMOJI[post.myReaction]}</span>
              : <Icon name="heart" fill={post.myReaction ? 'currentColor' : 'none'} />}
            <span>{post.likeCount}</span>
            {topReactions.length > 1 && <span className="react-top" aria-hidden="true">{topReactions.map((r) => REACTION_EMOJI[r]).join('')}</span>}
          </button>
          {picker && <span className="react-backdrop" aria-hidden="true" onClick={() => setPicker(false)} />}
          {picker && (
            <span className="react-picker" role="menu" aria-label="Reactions">
              {REACTIONS.map((r) => (
                <button key={r} type="button" role="menuitem" aria-label={REACTION_LABEL[r]}
                  className={post.myReaction === r ? 'chosen' : ''} onClick={() => void react(post.myReaction === r ? null : r)}>
                  {REACTION_EMOJI[r]}
                </button>
              ))}
            </span>
          )}
        </span>
        {linkToPost
          ? <Link to={href} className="action" aria-label={plural(post.commentCount, 'comment')}><Icon name="comment" /><span>{post.commentCount}</span></Link>
          : <span className="action static" aria-label={plural(post.commentCount, 'comment')}><Icon name="comment" /><span>{post.commentCount}</span></span>}
        <button type="button" className="action" aria-label="Share link to this post" onClick={() => void share()}>
          <Icon name="share" />
        </button>
        <button type="button" className={`action action-end${post.savedByMe ? ' saved' : ''}`} aria-pressed={post.savedByMe}
          aria-label={post.savedByMe ? 'Remove from saved' : 'Save post'} onClick={() => void toggleSave()}>
          <Icon name="bookmark" fill={post.savedByMe ? 'currentColor' : 'none'} />
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
