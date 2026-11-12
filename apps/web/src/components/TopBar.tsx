import { Link } from 'react-router-dom';
import { APP_NAME, APP_SLUG } from '../config';
import { Icon } from './Icon';

/** Home top bar: wordmark, notifications (heart), messages (paper plane). Counts are placeholders until the API exists. */
export function TopBar({ notifications = 0, messages = 0 }: { notifications?: number; messages?: number }) {
  return (
    <header className="topbar">
      <Link to="/" className="wordmark" aria-label={`${APP_NAME} home`}>{APP_SLUG}<span>.</span></Link>
      <div className="topbar-actions">
        <Link to="/notifications" className="icon-btn" aria-label={`Notifications${notifications ? `, ${notifications} new` : ''}`}>
          <Icon name="heart" />
          {notifications > 0 && <span className="badge">{notifications}</span>}
        </Link>
        <Link to="/messages" className="icon-btn" aria-label={`Messages${messages ? `, ${messages} unread` : ''}`}>
          <Icon name="send" />
          {messages > 0 && <span className="badge violet">{messages}</span>}
        </Link>
      </div>
    </header>
  );
}
