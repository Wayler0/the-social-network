# Hatua web app (PWA)

React 18 + Vite + TypeScript, React Router. Design tokens in `src/styles/tokens.css` come from the design canvas.

```bash
npm install          # from the repo root (npm workspaces)
npm run dev:web      # http://localhost:5180
npm run test:web     # unit tests (vitest)
npm run build:web    # type-check + production build
```

**Mock API:** `apps/web/.env.development` sets `VITE_API_MOCK=true`, so sign-up works before the API exists.
Use any `…@student.tharaka.ac.ke` or `…@tharaka.ac.ke` address; any 6-digit code signs you in except `000000` (shows the error state). The mock keeps your profile in localStorage; the reg number `TAKEN1` (or `taken-1`) shows the "already used" error.
When the API runs on :3000, set `VITE_API_MOCK=false` — Vite forwards `/api` to it.

| Path | Screen | Issue |
|---|---|---|
| `/welcome` | Sign-up (campus email only) | #1 |
| `/verify` | Code entry (paste, autofill, resend cooldown) | #2 |
| `/` | Home (top bar; feed comes later) | #4 |
| `/reels` | Reels — Coming soon | #8 |
| `/onboarding` | First-time profile after the code (name, member type, course, year, reg number, under-18) | #7 |
| `/profile` | Your profile | #7 |
| `/profile/edit` | Edit profile | #7 |
| `/settings` | Log out, delete account | #7 |

**Name and campuses:** the app name is a placeholder and lives in `src/config.ts` (plus `index.html` and `public/manifest.webmanifest`). Allowed email domains come from the campus list in the same file; adding a campus is adding an entry, not changing code.
