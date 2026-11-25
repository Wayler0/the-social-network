import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ApiError } from '../lib/api';
import { timeAgo } from '../lib/feed';
import { deleteStory, getStoryViewers, likeStory, markStorySeen, type StoryGroup, type StoryViewer as Viewer } from '../lib/stories';
import { closeLayer, useBackCloses } from '../lib/back-closes';
import { Avatar } from './Avatar';
import { ContentMenu } from './ContentMenu';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

const STORY_MS = 5000;
const HOLD_MS = 200;

/**
 * Full-screen stories, one author after another. Tap the right side for the next story, the left
 * for the previous; press and hold to pause. Close with X, Escape or the phone's Back button.
 * Your own stories show who viewed them; others' can be reported.
 */
export function StoryViewer({ groups, start, onSeen, onDeleted, onClose }: {
  groups: StoryGroup[];
  start: number;
  onSeen: (storyId: string) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const firstUnseen = (gi: number) => Math.max(0, groups[gi]!.stories.findIndex((s) => !s.seen));
  const [gi, setGi] = useState(start);
  const [si, setSi] = useState(() => (groups[start]!.isMine ? 0 : firstUnseen(start)));
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'viewers' | 'menu' | 'report' | 'delete'>('none');
  const [ready, setReady] = useState(false);
  // Likes made while the viewer is open (the stories list itself is not refetched).
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const progressRef = useRef(0);
  const wasHold = useRef(false);

  const group = groups[gi];
  const story = group?.stories[si];
  const paused = held || sheet !== 'none' || !ready;

  // Back button closes the viewer instead of leaving Home.
  useBackCloses('storyViewer', onClose);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);
  const closing = useRef(false);
  const close = useCallback(() => { if (!closing.current) { closing.current = true; closeLayer('storyViewer'); } }, []);

  const next = useCallback(() => {
    if (!group) return;
    if (si < group.stories.length - 1) { setSi(si + 1); return; }
    if (gi < groups.length - 1) { setGi(gi + 1); setSi(groups[gi + 1]!.isMine ? 0 : firstUnseen(gi + 1)); return; }
    close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gi, si, group, groups, close]);

  const prev = useCallback(() => {
    if (si > 0) { setSi(si - 1); return; }
    if (gi > 0) { setGi(gi - 1); setSi(groups[gi - 1]!.stories.length - 1); return; }
    progressRef.current = 0;
    setProgress(0);
  }, [gi, si, groups]);

  // New story: start from zero, wait for its photo, tell the server it was seen.
  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
    setError(null);
    setReady(!story?.image);
    if (story && !group!.isMine && !story.seen) {
      markStorySeen(story.id).then(() => onSeen(story.id)).catch(() => { /* not critical */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.id]);

  // The timer: moves on after STORY_MS unless paused.
  useEffect(() => {
    if (paused || !story) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      progressRef.current = Math.min(1, progressRef.current + (now - last) / STORY_MS);
      last = now;
      setProgress(progressRef.current);
      if (progressRef.current >= 1) next(); else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, story, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet !== 'none') return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet, close, next, prev]);

  if (!group || !story) return null;

  function onPointerDown() {
    wasHold.current = false;
    holdTimer.current = window.setTimeout(() => { wasHold.current = true; setHeld(true); }, HOLD_MS);
  }
  function onPointerUp(e: ReactPointerEvent) {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    setHeld(false);
    if (wasHold.current) return; // a hold only pauses
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    if (x < e.currentTarget.clientWidth / 3) prev(); else next();
  }

  const a = group.author;
  return (
    <div className="story-viewer" role="dialog" aria-modal="true" aria-label={`${a.name}'s story`}>
      <div className="story-bars" aria-hidden="true">
        {group.stories.map((s, i) => (
          <span key={s.id} className="story-bar"><span style={{ width: `${(i < si ? 1 : i === si ? progress : 0) * 100}%` }} /></span>
        ))}
      </div>
      <header className="story-top">
        <Avatar name={a.name} photoUrl={a.photoUrl} size={36} />
        <div className="story-who">
          <strong>{group.isMine ? 'Your story' : a.name}</strong>
          {a.type === 'office' && <span className="badge-pill strong">Official</span>}
          <span className="story-time">{timeAgo(story.createdAt)}{story.audience === 'close_friends' ? ' · Close friends' : ''}</span>
        </div>
        <button type="button" className="story-icon" aria-label="Story options" onClick={() => setSheet('menu')}><Icon name="more" /></button>
        <button type="button" className="story-icon" aria-label="Close stories" onClick={close}><Icon name="close" /></button>
      </header>

      <div className={`story-stage story-bg-${story.image ? 'black' : story.background ?? 'black'}`} onPointerDown={onPointerDown} onPointerUp={onPointerUp}
        onPointerCancel={() => { if (holdTimer.current) window.clearTimeout(holdTimer.current); setHeld(false); }}
        onContextMenu={(e) => e.preventDefault()}>
        {story.image
          ? <img src={story.image.url} alt="" draggable={false} onLoad={() => setReady(true)} onError={() => setReady(true)} />
          : null}
        {story.body && <p className={`story-text${story.image ? ' over-photo' : ''}`}>{story.body}</p>}
      </div>

      {group.isMine ? (
        <footer className="story-foot">
          <button type="button" className="story-seen" onClick={() => setSheet('viewers')}>
            <Icon name="eye" size={18} /> Seen by {story.viewCount ?? 0}
            {(story.likeCount ?? 0) > 0 && <><span aria-hidden="true"> · </span><Icon name="heart" size={16} fill="currentColor" /> {story.likeCount}</>}
          </button>
        </footer>
      ) : (
        <footer className="story-foot story-foot-end">
          {(() => {
            const isLiked = liked[story.id] ?? story.likedByMe;
            return (
              <button type="button" className={`story-like${isLiked ? ' liked' : ''}`} aria-pressed={isLiked}
                aria-label={isLiked ? 'Unlike story' : 'Like story'}
                onClick={() => {
                  const next = !isLiked;
                  setLiked((m) => ({ ...m, [story.id]: next }));   // straight away; put back if the server says no
                  likeStory(story.id, next).catch(() => setLiked((m) => ({ ...m, [story.id]: !next })));
                }}>
                <Icon name="heart" size={28} fill={isLiked ? 'currentColor' : 'none'} />
              </button>
            );
          })()}
        </footer>
      )}

      {sheet === 'menu' && (
        <Sheet title="Story options" onClose={() => setSheet('none')}>
          {group.isMine
            ? <button type="button" className="sheet-row danger" onClick={() => setSheet('delete')}>Delete story</button>
            : <button type="button" className="sheet-row" onClick={() => setSheet('report')}>Report story</button>}
          <button type="button" className="sheet-row muted" onClick={() => setSheet('none')}>Cancel</button>
        </Sheet>
      )}
      {sheet === 'report' && (
        <ContentMenu kind="story" startAt="report" targetId={story.id}
          author={{ id: a.type === 'user' ? a.id : null, name: a.name, photoUrl: a.photoUrl, badges: a.badges }}
          isOwn={false} canDelete={false} onDelete={async () => undefined}
          onBlocked={() => { onDeleted(); close(); }} onClose={() => setSheet('none')} />
      )}
      {sheet === 'delete' && (
        <Sheet title="Delete this story?" onClose={() => setSheet('none')}>
          <p className="sheet-text">It disappears for everyone straight away.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sheet-actions">
            <button type="button" className="btn danger" onClick={async () => {
              try { await deleteStory(story.id); onDeleted(); close(); } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Couldn’t delete. Try again.');
              }
            }}>Delete story</button>
            <button type="button" className="sheet-row muted" onClick={() => setSheet('none')}>Cancel</button>
          </div>
        </Sheet>
      )}
      {sheet === 'viewers' && <ViewersSheet storyId={story.id} onClose={() => setSheet('none')} />}
    </div>
  );
}

function ViewersSheet({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const [data, setData] = useState<{ count: number; likeCount: number; items: Viewer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getStoryViewers(storyId).then(setData).catch((err) => setError(err instanceof ApiError ? err.message : 'Couldn’t load viewers.'));
  }, [storyId]);
  return (
    <Sheet title={data ? `Seen by ${data.count}${data.likeCount ? ` · ${data.likeCount} like${data.likeCount === 1 ? '' : 's'}` : ''}` : 'Seen by'} onClose={onClose}>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="muted sheet-text" role="status">Loading…</p>}
      {data && data.items.length === 0 && <p className="muted sheet-text">No views yet.</p>}
      {data && data.items.length > 0 && (
        <ul className="people-list story-viewers">
          {data.items.map((v) => (
            <li key={v.id} className="person-row">
              <span className="person-main"><Avatar name={v.name} photoUrl={v.photoUrl} size={36} /><span><strong>{v.name}</strong> <span className="muted">· {timeAgo(v.viewedAt)}</span></span></span>
              {v.liked && <span className="viewer-liked" aria-label="Liked your story"><Icon name="heart" size={18} fill="currentColor" /></span>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
