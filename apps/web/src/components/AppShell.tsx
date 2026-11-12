import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';

export function AppShell() {
  return (
    <div className="shell">
      <main className="shell-main">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
