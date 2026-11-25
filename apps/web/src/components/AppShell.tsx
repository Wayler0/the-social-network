import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { FeedbackPrompt } from './FeedbackPrompt';
import { YearCheck } from './YearCheck';

export function AppShell() {
  return (
    <div className="shell">
      <main className="shell-main">
        <Outlet />
      </main>
      <BottomNav />
      <FeedbackPrompt />
      <YearCheck />
    </div>
  );
}
