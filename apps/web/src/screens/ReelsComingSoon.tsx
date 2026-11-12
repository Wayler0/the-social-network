import { Icon } from '../components/Icon';

/** Decided 12 Nov: Reels tab stays in the nav but shows "Coming soon" in v0.1 (CLAUDE.md). */
export function ReelsComingSoon() {
  return (
    <section className="empty reels-soon">
      <div className="soon-icon"><Icon name="reels" size={44} color="#fff" /></div>
      <span className="pill">COMING SOON</span>
      <h1>Reels</h1>
      <p>Short campus videos — lessons, events and fun. We’re building it with data-saver mode so it won’t eat your bundles.</p>
    </section>
  );
}
