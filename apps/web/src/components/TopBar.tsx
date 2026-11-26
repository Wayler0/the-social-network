import { Link } from 'react-router-dom';
import { APP_NAME, APP_SLUG } from '../config';
import { useUnread } from '../lib/unread';
import { Icon } from './Icon';

/** Home top bar: wordmark, search, notifications (heart, real unread count). Messages come back with chat (v0.2). */
export function TopBar() {
  const notifications = useUnread().count;
  return (
    <header className="topbar">
      <Link to="/" className="wordmark" aria-label={`${APP_NAME} home`}>{APP_SLUG}<span>.</span></Link>
      <div className="topbar-actions">
        <Link to="/search" className="icon-btn" aria-label="Search"><Icon name="discover" /></Link>
        <Link to="/notifications" className="icon-btn" aria-label={`Notifications${notifications ? `, ${notifications} new` : ''}`}>
          <Icon name="heart" />
          {notifications > 0 && <span className="badge" aria-hidden="true">{notifications > 99 ? '99+' : notifications}</span>}
        </Link>

      </div>
    </header>
  );
}
