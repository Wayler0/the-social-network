/**
 * "Install app": Android and desktop Chrome/Edge fire `beforeinstallprompt`, which we keep so a
 * button in Settings can open the install dialog later. iPhone Safari has no such event: the member
 * adds the app from the Share menu, so we show how instead.
 *
 * startInstallListener() runs in main.tsx before React starts, because the event can fire
 * before the Settings screen exists.
 */
import { useSyncExternalStore } from 'react';

/** Chrome's install event (not in TypeScript's DOM types). */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type InstallState =
  | 'installed' // opened from the home screen, or just installed
  | 'available' // the browser will show its install dialog
  | 'ios' // iPhone/iPad Safari: Share → Add to Home Screen
  | 'in-app' // inside Instagram, Facebook, TikTok… : can't install, must open in the real browser
  | 'android-menu' // Android, but the browser hasn't offered its dialog (yet): use the ⋮ menu
  | 'unavailable'; // browser can't install, or not yet ready (e.g. not served over HTTPS)

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** iPhone, iPod, or an iPad (which reports itself as a Mac with a touch screen). */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * Browsers built into other apps (Instagram, Facebook, TikTok, Snapchat, LinkedIn, Android
 * web views). They can't install web apps and keep their own sign-in, separate from Chrome or
 * Safari. WhatsApp opens links in a Chrome tab on Android, which can install from its ⋮ menu.
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|; wv\)/.test(userAgent);
}

export const isAndroid = (userAgent: string) => /Android/.test(userAgent);

export function installState(env: {
  standalone: boolean;
  installed: boolean;
  canPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}): InstallState {
  if (env.standalone || env.installed) return 'installed';
  if (isInAppBrowser(env.userAgent)) return 'in-app';
  if (env.canPrompt) return 'available';
  if (isIos(env.userAgent, env.maxTouchPoints)) return 'ios';
  if (isAndroid(env.userAgent)) return 'android-menu';
  return 'unavailable';
}

function currentState(): InstallState {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installState({
    standalone,
    installed,
    canPrompt: deferred !== null,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

export function startInstallListener(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // keep Chrome's mini-bar away; we offer our own banner (InstallBanner) and Settings row
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

/** Opens the browser's install dialog. The event can be used only once. */
export async function promptInstall(): Promise<void> {
  const event = deferred;
  if (!event) return;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') installed = true;
  notify();
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentState,
  );
}
