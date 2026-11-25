import { Link } from 'react-router-dom';
import { plural } from '../lib/feed';
import { dateTile, isLive, isOver, whenText, type CampusEvent } from '../lib/events';

/** Who is hosting: the office, else the group, else the member who made it. */
export const hostName = (e: CampusEvent) => e.office?.name ?? e.group?.name ?? e.createdBy.name;

/** The one status worth showing, most important first; `withRsvp` false leaves out Going / Interested. */
export function EventStatus({ e, withRsvp = true }: { e: CampusEvent; withRsvp?: boolean }) {
  if (e.cancelled) return <span className="badge-pill danger-pill">Cancelled</span>;
  if (isLive(e)) return <span className="badge-pill live-pill">Happening now</span>;
  if (isOver(e)) return <span className="badge-pill">Ended</span>;
  if (!withRsvp) return null;
  if (e.myRsvp === 'going') return <span className="badge-pill strong">Going</span>;
  if (e.myRsvp === 'interested') return <span className="badge-pill">Interested</span>;
  return null;
}

/** An event in a list: date tile, title, when and where, host and how many are going. */
export function EventCard({ e }: { e: CampusEvent }) {
  const tile = dateTile(e.startsAt);
  return (
    <Link to={`/events/${e.id}`} className={`list-row event-row${e.cancelled ? ' cancelled' : ''}`}>
      <span className="date-tile" aria-hidden="true"><span>{tile.month}</span><strong>{tile.day}</strong></span>
      <span className="list-main">
        <strong className="event-title">{e.title}</strong>
        <span className="post-meta">{whenText(e.startsAt, e.endsAt)}</span>
        {e.location && <span className="post-meta">{e.location}</span>}
        <span className="post-meta">{hostName(e)}{e.goingCount > 0 && ` · ${plural(e.goingCount, 'person', 'people')} going`}</span>
        <span className="badges"><EventStatus e={e} /></span>
      </span>
    </Link>
  );
}
