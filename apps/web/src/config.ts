/**
 * The one place for the app's name and campus list.
 *
 * - The name is a PLACEHOLDER. To rename the app, change APP_NAME here, plus the two
 *   static files a browser reads before any code runs: index.html and public/manifest.webmanifest.
 * - Campuses are data, not code (CLAUDE.md, Positioning). This list mirrors the `campuses`
 *   and `campus_email_domains` tables and will be loaded from the API once it exists.
 */
import type { MemberType } from './lib/email';

export const APP_NAME = 'Hatua';
/** Lower-case form used for the wordmark and storage keys. */
export const APP_SLUG = APP_NAME.toLowerCase();

export type Campus = {
  slug: string;
  name: string;
  /** Email domain → member type. Exact match only. */
  emailDomains: Record<string, MemberType>;
};

export const CAMPUSES: Campus[] = [
  {
    slug: 'tharaka',
    name: 'Tharaka University',
    emailDomains: {
      'student.tharaka.ac.ke': 'student',
      'tharaka.ac.ke': 'staff',
    },
  },
];
