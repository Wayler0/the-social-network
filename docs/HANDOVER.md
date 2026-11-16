# Handover — where v0.1 stands (15 Nov 2026)

Written at the end of the Claude sprint (Claude Pro ends 16 Nov), so the team can continue without it.
Plan and dates: `ROADMAP.md`. Every endpoint: `docs/api-contract.md`. Screens: `apps/web/README.md`.

## Run it locally (about 5 minutes)

```
npm install                      # after every pull
cp .env.example .env             # first time only; then fill POSTGRES_PASSWORD and DATABASE_URL
npm run db:up                    # PostgreSQL + PostGIS in Docker
npm run migrate -w apps/api
npm run seed -w apps/api         # test members, see docs/dev-seed.md
npm run dev:api                  # :3000 — sign-in codes are printed in THIS console
npm run dev:web                  # :5180 — open http://localhost:5180
```

Sign in as `seed.grace@student.tharaka.ac.ke` (moderator), `seed.hassan@…` (admin), `seed.felix@tharaka.ac.ke`
(staff, can post Today board announcements) and so on; the code appears in the API console.

Tests: `npm test` (unit), `npm run test:db -w apps/api` (needs `TEST_DATABASE_URL` in `.env`; without it 185
API tests are **skipped silently**). CI runs all of them on every PR. `main` is protected: a PR, 1 approval,
and the 3 CI checks.

If the web page is blank after a pull: stop the dev server and start it again (Vite keeps old dependencies).

## Done

| Area | Backend (Kim, Peter) | Screens (Solomon) |
|---|---|---|
| Sign-in with campus email code, sessions, rate limits | ✅ | ✅ |
| Onboarding, profile, edit profile, settings, delete account | ✅ | ✅ (no profile photo upload screen yet) |
| Interests on profiles; download my data (`GET /api/me/export`, Data Protection Act) | ✅ | ❌ no screens yet |
| v0.2: follows (people, offices, public clubs), stories (personal, office, club; close friends, hide from, viewers), club announcements (feed + Announcements/Discussion tabs) | ✅ (branch `kim-v0.2`) | ❌ no screens yet |
| Feed, posts with one photo, likes, comments | ✅ | ✅ |
| Report (8 reasons) and block on posts, comments, groups, questions, answers | ✅ | ✅ |
| Groups: create, join/request, leave, members, requests, group posts, class groups | ✅ | ✅ (no admin tools for roles/removing members yet) |
| Today board: pins, urgent, pin limit; offices post and delete | ✅ | ✅ |
| Ask a Senior: ask (name hidden), answer, helpful, search | ✅ | ✅ |
| Admin: moderation queue, hide, suspend, roles, offices, CLUB badge, log | ✅ | ✅ (reg-number disputes screen not built: may be dropped) |
| Images: upload, resize, strip location, serve to members only | ✅ | ✅ |
| Email sending (SMTP), backups (restic scripts) | ✅ code | ❌ not tested on the real server |

## Left before launch (in order of risk)

1. **Server (#10, #38).** Nothing runs on a server yet. ICT access by **Sun 29 Nov**; if late, a temporary VPS.
   The web server must forward `/api` and `/media` to the API, allow 10 MB bodies on `/api/images`
   (nginx: `client_max_body_size 10m;`), and set `TRUST_PROXY_HOPS` to the number of proxies (normally 1).
   Production needs `CODE_PEPPER` (`openssl rand -base64 48`) or the API refuses to start.
2. **Sign-in email delivery (#35).** Test that codes reach real `student.tharaka.ac.ke` inboxes, not spam
   (`npm run email:test -w apps/api -- you@…`). If codes don't arrive, nobody can join.
3. **Moderators.** The queue (Settings → Moderation) only helps if someone checks it daily. Make the first admin
   on the server (`docs/api-contract.md` section 11), then give the Moderator role in Admin → Members.
4. **Legal pages (#14):** privacy policy, community guidelines, terms. The sign-up screen already links to them.
5. **HTTPS, backups restore test, monitoring (#33, #36, #39, #40).**
6. **User testing (#41–#46)** — see ROADMAP "User involvement".

Smaller gaps in the web app: profile photo upload, interests on edit profile, a "Download my data" button in Settings, group admin tools (make admin, remove member), unblock list
in Settings, posting as an office in the feed, a shared "loading/error" component (#3 is done screen by screen).

## Decisions waiting for the team

- **Stop collecting reg/staff numbers** (proposed 15 Nov, emailed to Kim and Peter). Until decided, the
  profile can't be completed without one. If agreed: one migration dropping `member_number*` and
  `member_number_disputes`, remove the field from onboarding and the API, update CLAUDE.md sections 5 and 13.
- Kim's questions from PR #48: reg-number dashes vs slashes (moot if the above passes), Today board limits
  (5 normal pins, 14 days), a group left without an admin, who sees hidden Ask a Senior names.
- Who moderates, and how fast for urgent reports.

## Rules that are easy to break

- **Never show a member's email to another member.** Student emails contain the reg number, staff emails the
  full name. Only `GET /api/me` and admin endpoints return it.
- **No hard-coded app name or campus.** Name: `apps/web/src/config.ts` and `APP_NAME` in `.env`. Campuses and
  email domains: the `campuses` tables.
- **Every list goes through `apps/api/src/visibility.ts`** (campus, blocks, hidden, group membership,
  student-only groups). Forgetting it in one query is a privacy bug.
- **No browser `alert()`/`confirm()`** in the web app: use the bottom sheet (`components/Sheet.tsx`).
