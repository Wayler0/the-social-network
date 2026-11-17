import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registers the service worker (offline app shell, see vite.config.ts) and, when a new version
 * has downloaded, asks the member to reload instead of reloading under them mid-post.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version is ready.</span>
      <button className="btn secondary" onClick={() => setNeedRefresh(false)}>Later</button>
      <button className="btn" onClick={() => void updateServiceWorker(true)}>Reload</button>
    </div>
  );
}
