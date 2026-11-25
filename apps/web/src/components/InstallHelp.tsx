import { APP_NAME } from '../config';
import type { InstallState } from '../lib/install';

/** How to get the app on this phone, for the states where the browser can't just open its dialog. */
export function InstallHelp({ state }: { state: InstallState }) {
  if (state === 'in-app') {
    return <>You’re in another app’s browser, which can’t install {APP_NAME} and won’t keep you signed in. Tap <strong>⋮</strong> or <strong>…</strong> and choose <strong>Open in Chrome</strong> (or <strong>Open in Safari</strong>), then install from there.</>;
  }
  if (state === 'ios') {
    return <>In Safari, tap <strong>Share</strong> (the square with an arrow), then <strong>Add to Home Screen</strong>.</>;
  }
  if (state === 'android-menu') {
    return <>In Chrome, tap <strong>⋮</strong> (top right), then <strong>Install app</strong> or <strong>Add to Home screen</strong>.</>;
  }
  return null;
}
