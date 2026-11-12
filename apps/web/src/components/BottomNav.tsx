import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

const items: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/discover', label: 'Discover', icon: 'discover' },
  { to: '/reels', label: 'Reels', icon: 'reels' },
  { to: '/profile', label: 'Profile', icon: 'profile' },
];

function Item({ to, label, icon }: (typeof items)[number]) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
      <Icon name={icon} />
      <span>{label}</span>
    </NavLink>
  );
}

/** Bottom nav: Home, Discover, + (create), Reels, Profile — CLAUDE.md §14. */
export function BottomNav() {
  return (
    <nav className="bottomnav" aria-label="Main">
      <Item {...items[0]} />
      <Item {...items[1]} />
      <NavLink to="/create" className="create-btn" aria-label="Create a post">
        <Icon name="plus" size={26} strokeWidth={2.6} />
      </NavLink>
      <Item {...items[2]} />
      <Item {...items[3]} />
    </nav>
  );
}
