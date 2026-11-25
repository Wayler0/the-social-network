import { useState } from 'react';
import { APP_NAME, APP_SLUG } from '../config';
import { promptInstall, useInstallState } from '../lib/install';
import { Icon } from './Icon';
import { InstallHelp } from './InstallHelp';

const KEY = `${APP_SLUG}.installBannerHiddenAt`;
const HIDE_DAYS = 14;

function hiddenRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY));
    return at > 0 && Date.now() - at < HIDE_DAYS * 24 * 60 * 60 * 1000;
  } catch { return false; }
}

/**
 * "Get the app" card at the top of Home until the member installs it or closes the card
 * (then it stays away for two weeks; Settings always has the option).
 */
export function InstallBanner() {
  const state = useInstallState();
  const [hidden, setHidden] = useState(hiddenRecently);
  const [showHelp, setShowHelp] = useState(false);
  if (hidden || state === 'installed' || state === 'unavailable') return null;

  function hide() {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked: hidden until reload */ }
    setHidden(true);
  }

  return (
    <aside className="install-banner" aria-label={`Get the ${APP_NAME} app`}>
      <div className="install-banner-main">
        <img src="/icon-192.png" alt="" width={40} height={40} />
        <div>
          <strong>{state === 'in-app' ? `Open ${APP_NAME} in your browser` : `Get ${APP_NAME} on your home screen`}</strong>
          <span className="muted">{state === 'in-app' ? 'To install it and stay signed in.' : 'Opens like an app, stays signed in, no app store needed.'}</span>
        </div>
        {state === 'available'
          ? <button type="button" className="btn install-banner-btn" onClick={() => void promptInstall()}>Install</button>
          : <button type="button" className="btn install-banner-btn" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>How</button>}
        <button type="button" className="icon-btn small" aria-label="Not now" onClick={hide}><Icon name="close" size={18} /></button>
      </div>
      {showHelp && <p className="install-banner-help"><InstallHelp state={state} /></p>}
    </aside>
  );
}
