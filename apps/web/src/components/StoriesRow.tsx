import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getStories, type StoryGroup } from '../lib/stories';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { StoryViewer } from './StoryViewer';

/**
 * The stories row at the top of Home (CLAUDE.md section 4, "Stories / status"):
 * "Your story" first, then official accounts, clubs and people, in the server's order
 * (unseen before seen). A violet ring means something new; grey means all seen.
 */
export function StoriesRow() {
  const { me } = useAuth();
  const [groups, setGroups] = useState<StoryGroup[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    getStories().then((r) => setGroups(r.items)).catch(() => setGroups((g) => g ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!me || groups === null) return <div className="stories-row" aria-hidden="true" />;
  const mineIndex = groups.findIndex((g) => g.isMine);
  const others = groups.map((g, i) => ({ g, i })).filter(({ g }) => !g.isMine);

  return (
    <>
      <nav className="stories-row" aria-label="Stories">
        <div className="story">
          {mineIndex >= 0
            ? <button type="button" className="story-ring-btn" aria-label="Your story" onClick={() => setOpen(mineIndex)}>
                <span className={`story-ring${groups[mineIndex]!.allSeen ? ' seen' : ''}`}><Avatar name={me.name} photoUrl={me.photoUrl} size={56} /></span>
              </button>
            : <Link to="/story/new" className="story-ring-btn" aria-label="Add to your story">
                <span className="story-ring none"><Avatar name={me.name} photoUrl={me.photoUrl} size={56} /></span>
              </Link>}
          <Link to="/story/new" className="story-add" aria-label="Add to your story"><Icon name="plus" size={14} strokeWidth={3} /></Link>
          <span className="story-name">Your story</span>
        </div>
        {others.map(({ g, i }) => (
          <div key={`${g.author.type}:${g.author.id}`} className="story">
            <button type="button" className="story-ring-btn" onClick={() => setOpen(i)}
              aria-label={`${g.author.name}'s story${g.allSeen ? '' : ', new'}`}>
              <span className={`story-ring${g.allSeen ? ' seen' : ''}${g.author.type === 'office' ? ' official' : ''}`}>
                <Avatar name={g.author.name} photoUrl={g.author.photoUrl} size={56} />
              </span>
            </button>
            <span className="story-name">{g.author.name}</span>
          </div>
        ))}
      </nav>
      {open !== null && groups[open] && (
        <StoryViewer groups={groups} start={open}
          onSeen={(storyId) => setGroups((list) => list && list.map((g) => {
            if (!g.stories.some((s) => s.id === storyId)) return g;
            const stories = g.stories.map((s) => (s.id === storyId ? { ...s, seen: true } : s));
            return { ...g, stories, allSeen: stories.every((s) => s.seen) };
          }))}
          onDeleted={() => load()}
          onClose={() => { setOpen(null); load(); }} />
      )}
    </>
  );
}
