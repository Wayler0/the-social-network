import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { YearCheck } from './YearCheck';

export function AppShell() {
  return (
    <div className="shell">
      <main className="shell-main">
        <Outlet />
      </main>
      <BottomNav />
      <YearCheck />
    </div>
  );
}
