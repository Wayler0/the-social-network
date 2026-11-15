import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';

const tiles: { to: string | null; title: string; text: string; icon: IconName; tone: string }[] = [
  { to: '/groups', title: 'Groups & clubs', text: 'Your class, clubs and interests', icon: 'people', tone: 'violet' },
  { to: '/ask', title: 'Ask a Senior', text: 'Questions about campus life, answered', icon: 'question', tone: 'mint' },
  { to: '/today', title: 'Today board', text: 'Official news from offices', icon: 'megaphone', tone: 'sunshine' },
  { to: null, title: 'Events', text: 'Coming later', icon: 'calendar', tone: 'muted' },
  { to: null, title: 'Market', text: 'Coming later', icon: 'tag', tone: 'muted' },
];

/** Discover: the way into groups, Ask a Senior and the Today board (CLAUDE.md section 14). */
export function Discover() {
  return (
    <>
      <header className="topbar"><h1 className="topbar-title">Discover</h1></header>
      <div className="tiles">
        {tiles.map((t) => {
          const inner = (<>
            <span className={`tile-icon ${t.tone}`}><Icon name={t.icon} /></span>
            <strong>{t.title}</strong>
            <span className="muted">{t.text}</span>
          </>);
          return t.to
            ? <Link key={t.title} to={t.to} className="tile">{inner}</Link>
            : <div key={t.title} className="tile disabled" aria-disabled="true">{inner}</div>;
        })}
      </div>
    </>
  );
}
