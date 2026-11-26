/**
 * The one place for the app's name and campus list.
 *
 * - The name is a PLACEHOLDER. To rename the app, change APP_NAME here. index.html and the
 *   install manifest are filled from these values at build time (vite.config.ts); the icons
 *   are drawn by scripts/make-icons.mjs.
 * - Campuses are data, not code (CLAUDE.md, Positioning). This list mirrors the `campuses`
 *   and `campus_email_domains` tables and will be loaded from the API once it exists.
 */
import type { MemberType } from './lib/email';

export const APP_NAME = 'Hatua';
/** Lower-case form used for the wordmark and storage keys. */
export const APP_SLUG = APP_NAME.toLowerCase();
/** Shown in the install manifest and the page description. */
export const APP_TAGLINE = 'Your campus community, in one place.';
/**
 * The site's public address, for link previews (WhatsApp, Telegram, Facebook need full image URLs).
 * A PLACEHOLDER domain like the name: change it here when the final domain is chosen.
 */
export const PUBLIC_URL = 'https://hatua.nextup.co.ke';
/**
 * Where members send privacy questions and data requests (shown on the privacy policy and terms).
 * Set this to the team's real address before inviting people; empty shows "ask the team" instead.
 */
export const CONTACT_EMAIL = '';
/** Last time the privacy policy and terms changed (shown at the top of both). */
export const LEGAL_UPDATED = '25 November 2026';
/** Browser and phone status-bar colour (violet, same as --violet in styles/tokens.css). */
export const THEME_COLOR = '#6A3DF5';
/** Background of the dark theme, the default look (DECIDED 25 Nov 2026): status bar and launch screen. */
export const DARK_SURFACE = '#121119';

export type Campus = {
  slug: string;
  name: string;
  /** Email domain → member type. Exact match only. */
  emailDomains: Record<string, MemberType>;
  /** Registration number format (regular expression on the normalised number) and an example; null = no check. */
  regNumberPattern?: string | null;
  regNumberExample?: string | null;
};

/* The campus list is loaded from the server (lib/campuses.ts); nothing here names a campus. */
