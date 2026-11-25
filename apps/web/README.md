# Hatua web app (PWA)

React 18 + Vite + TypeScript, React Router. Design tokens in `src/styles/tokens.css` come from the design canvas.

```bash
npm install          # from the repo root (npm workspaces)
npm run dev:web      # http://localhost:5180
npm run test:web     # unit tests (vitest)
npm run build:web    # type-check + production build
```

**Real API (default):** also run `npm run db:up` and `npm run dev:api` (port 3000). Vite forwards `/api` and `/media`
to it, so the session cookie works on `localhost:5180`. Sign-in codes are printed in the **API** console; seed members
to sign in as are in `docs/dev-seed.md`. A 401 from any request (session ended) returns the app to sign-in.

**Mock API:** set `VITE_API_MOCK=true` in `apps/web/.env.development` to work on screens without the API.
Use any `…@student.tharaka.ac.ke` or `…@tharaka.ac.ke` address; any 6-digit code signs you in except `000000` (shows the error state). The mock keeps your profile in localStorage; the reg number `TAKEN1` (or `taken-1`) shows the "already used" error. The mock covers sign-in and profile only: the feed, posts and photos always need the real API.

| Path | Screen | Issue |
|---|---|---|
| `/welcome` | Sign-up (campus email only) | #1 |
| `/verify` | Code entry (paste, autofill, resend cooldown) | #2 |
| `/` | Home: Today board (urgent always shown, normal pins collapsible), then the campus feed | #4, #11, #22 |
| `/create` | New post: text and one photo (JPEG/PNG/WebP, 8 MB) | #22, #32 |
| `/post/:id` | One post with its comments; add and delete comments | #22 |
| `/discover` | Ways into Groups, Ask a Senior and the Today board (Events and Market: later) | |
| `/today` | Today board: all announcements, pinned first; offices you belong to can post and delete | #11, #26 |
| `/groups`, `/groups/new`, `/groups/:id` | Your groups and Discover; create; a group's posts, members, join/leave, join requests for admins | #6, #25 |
| `/admin` | Moderators: report queue (hide, keep, unhide). Admins also: find members (suspend, roles), official accounts and who can post for them, the admin log. From Settings | #13 |
| `/ask`, `/ask/:id` | Ask a Senior: search, ask (name can be hidden from students), answers, "helpful" | #12, #27 |
| `/reels` | Reels — Coming soon | #8 |
| `/onboarding` | First-time profile after the code (name, member type, course, year, reg number, under-18) | #7 |
| `/profile` | Your profile | #7 |
| `/profile/edit` | Edit profile | #7 |
| `/settings` | Install the app (Android/desktop dialog, or iPhone Share-menu steps), log out, delete account | #7 |

Every post and comment has a "…" menu: report (8 reasons), block the author, and delete (own content; admins and the post's author can delete comments). It opens as a bottom sheet and asks before anything destructive.

**Name and campuses:** the app name is a placeholder and lives in `src/config.ts`; `index.html` and the install manifest are filled from it at build time (`vite.config.ts`). Allowed email domains come from the campus list in the same file; adding a campus is adding an entry, not changing code.

**Installable app (PWA):** `vite-plugin-pwa` writes the manifest and a service worker (`sw.js`) on `npm run build:web`.
The service worker caches only the app itself (so it opens on a bad connection or offline), never API answers or photos.
A new version shows a "Reload" bar instead of reloading by itself. Install only works over HTTPS (or `localhost`):
try it with `npm run build:web && npm run preview -w apps/web`. Icons: change the logo in `scripts/make-icons.mjs`, then
run `node apps/web/scripts/make-icons.mjs`. The web server must not cache `sw.js` (send `Cache-Control: no-cache`),
or members get stuck on an old version.
