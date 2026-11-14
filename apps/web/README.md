# Hatua web app (PWA)

React 18 + Vite + TypeScript, React Router. Design tokens in `src/styles/tokens.css` come from the design canvas.

```bash
npm install          # from the repo root (npm workspaces)
npm run dev:web      # http://localhost:5180
npm run test:web     # unit tests (vitest)
npm run build:web    # type-check + production build
```

**Real API (default):** run the API too: `npm run db:up`, then `npm run dev:api` (port 3000). Vite forwards `/api` and
`/media` to it, so the session cookie works on `localhost:5180`. Sign-up codes are printed in the **API** console.
Seed members to sign in as: `docs/dev-seed.md`.

**Mock API:** set `VITE_API_MOCK=true` in `apps/web/.env.development` to work on screens without the API: any 6-digit
code works except `000000` (error state). Only sign-in and `/api/me` are faked; a refresh signs you out.

**How the app talks to the API** (`src/lib/`):
- `api.ts` — `api(method, path, body)` for every endpoint in `docs/api-contract.md`. Failures throw `ApiError` with
  `status`, `code` (the contract's `error`), `message` (show it) and `retryAfterSeconds`. A 401 anywhere signs the app out.
- `auth.tsx` — `useAuth()` gives `status` (`loading` | `signedIn` | `signedOut`), `me` (GET /api/me), `refresh`, `setMe`, `signOut`.
- Routing: signed-in members with `me.profileComplete === false` are sent to `/onboarding` (the API answers
  `403 profile_incomplete` to posting and joining until then).

| Path | Screen | Issue |
|---|---|---|
| `/welcome` | Sign-up (campus email only) | #1 |
| `/verify` | Code entry (paste, autofill, resend cooldown) | #2 |
| `/onboarding` | Name, member type, course, year, reg number, under-18 (plain form; restyle to the canvas) | #7 |
| `/` | Home (top bar; feed comes later) | #4 |
| `/reels` | Reels — Coming soon | #8 |
| `/profile` | Own profile from the API + log out (basic; designed screen is #7) | #7 |

**Name and campuses:** the app name is a placeholder and lives in `src/config.ts` (plus `index.html` and `public/manifest.webmanifest`). Allowed email domains come from the campus list in the same file; adding a campus is adding an entry, not changing code.
