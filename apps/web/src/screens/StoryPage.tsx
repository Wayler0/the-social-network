import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StoryViewer } from '../components/StoryViewer';
import { getStory, type StoryGroup } from '../lib/stories';

/**
 * A shared story link (/story/:id). Opens the story full screen for members who may see it; after
 * 24 hours, or for anyone else, it says it isn't available. Closing goes Home.
 */
export function StoryPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<StoryGroup | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    getStory(id)
      .then((r) => setGroup({ author: r.author, isMine: r.isMine, allSeen: r.story.seen, stories: [r.story] }))
      .catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <section className="empty">
        <h1>Story not available</h1>
        <p>Stories last 24 hours, and only the people they were shared with can see them.</p>
        <Link to="/" className="btn btn-link" style={{ maxWidth: 200 }}>Go to Home</Link>
      </section>
    );
  }
  if (!group) return <p className="feed-foot" role="status">Loading…</p>;
  return <StoryViewer groups={[group]} start={0} onSeen={() => undefined} onDeleted={() => navigate('/', { replace: true })}
    onClose={() => navigate('/', { replace: true })} />;
}
