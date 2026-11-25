import { APP_SLUG } from '../config';

/**
 * The campus email last used to sign in on this device, so a returning member doesn't retype it.
 * Kept only on the device; forgotten when the account is deleted. Never sent anywhere by itself.
 */
const KEY = `${APP_SLUG}.lastEmail`;

export function getLastEmail(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
export function setLastEmail(email: string): void {
  try { localStorage.setItem(KEY, email); } catch { /* storage blocked */ }
}
export function forgetLastEmail(): void {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
