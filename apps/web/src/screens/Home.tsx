import { TopBar } from '../components/TopBar';
import { Placeholder } from '../components/Placeholder';

/** Feed arrives in week 2 (issue #4). Badge counts are sample values. */
export function Home() {
  return (
    <>
      <TopBar notifications={3} messages={2} />
      <Placeholder title="Welcome to Hatua" text="Your campus feed and the Today board will appear here." />
    </>
  );
}
