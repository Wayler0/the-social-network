import { Link } from 'react-router-dom';
import { APP_NAME, APP_SLUG } from '../config';
import { useUnread } from '../lib/unread';
import { Icon } from './Icon';

/** Home top bar: wordmark, notifications (heart, real unread count), messages (paper plane; 0 until chat exists, no fake numbers). */
export function TopBar({ messages = 0 }: { messages?: number }) {
  const notifications = useUnread().count;
  return (
    <header className="topbar">
      <Link to="/" className="wordmark" aria-label={`${APP_NAME} home`}>{APP_SLUG}<span>.</span></Link>
      <div className="topbar-actions">
        <Link to="/notifications" className="icon-btn" aria-label={`Notifications${notifications ? `, ${notifications} new` : ''}`}>
          <Icon name="heart" />
          {notifications > 0 && <span className="badge" aria-hidden="true">{notifications > 99 ? '99+' : notifications}</span>}
        </Link>
        <Link to="/messages" className="icon-btn" aria-label={`Messages${messages ? `, ${messages} unread` : ''}`}>
          <Icon name="send" />
          {messages > 0 && <span className="badge violet">{messages}</span>}
        </Link>
      </div>
    </header>
  );
}
