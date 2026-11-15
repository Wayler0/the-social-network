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
| `/ask`, `/ask/:id` | Ask a Senior: search, ask (name can be hidden from students), answers, "helpful" | #12, #27 |
| `/reels` | Reels — Coming soon | #8 |
| `/onboarding` | First-time profile after the code (name, member type, course, year, reg number, under-18) | #7 |
| `/profile` | Your profile | #7 |
| `/profile/edit` | Edit profile | #7 |
| `/settings` | Log out, delete account | #7 |

Every post and comment has a "…" menu: report (8 reasons), block the author, and delete (own content; admins and the post's author can delete comments). It opens as a bottom sheet and asks before anything destructive.

**Name and campuses:** the app name is a placeholder and lives in `src/config.ts` (plus `index.html` and `public/manifest.webmanifest`). Allowed email domains come from the campus list in the same file; adding a campus is adding an entry, not changing code.
