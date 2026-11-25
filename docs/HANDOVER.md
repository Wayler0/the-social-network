# Handover — where the app stands (updated 25 Nov 2026; first written 15 Nov)

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

Tests: `npm test` (unit), `npm run test:db -w apps/api` (needs `TEST_DATABASE_URL` in `.env`; without it ~270
API tests are **skipped silently**). CI runs all of them on every PR, against a fresh database. `main` is protected:
a PR, 1 approval from someone else, and all CI checks. **Never merge on red** ("bypass rules"): `main` deploys itself.

**Run the database tests on an empty database**, not your dev one: your own test data (follows, reports, posts) makes
some tests fail for no real reason. Create one: `docker exec the-social-network-db-1 psql -U hatua -d hatua -c "create database hatua_clean_test owner hatua"`,
then `create extension postgis` in it, migrate with `DATABASE_URL=…/hatua_clean_test npx tsx src/migrate.ts`, and
run `DATABASE_URL=… TEST_DATABASE_URL=… npx vitest run` in `apps/api`. With a test database, test files run one at a
time (`vitest.config.ts`), so they can't deadlock.

If the web page is blank after a pull: stop the dev server and start it again (Vite keeps old dependencies).

## Done

| Area | Backend (Kim, Peter) | Screens (Solomon) |
|---|---|---|
| Sign-in with campus email code, sessions, rate limits | ✅ | ✅ |
| Onboarding, profile, edit profile, settings, delete account; profile photo (tap your initials); optional reg number with campus format check; moving up a year on 1 Sep (branch `feat/year-rollover`) | ✅ | ✅ |
| Interests on profiles; download my data (`GET /api/me/export`, Data Protection Act) | ✅ | ✅ Download my data in Settings |
| v0.2: follows (people, offices, public clubs), stories (personal, office, club; close friends, hide from, viewers), club announcements (feed + Announcements/Discussion tabs), reactions, events (going / interested), notifications + push | ✅ | ✅ profiles + Follow, follower lists, who-to-follow (onboarding + Discover), stories row/viewer/composer, club pages, reactions, events, notifications. Branches waiting: story likes, story backgrounds, Follow button on posts |
| Saved posts, share a post's link, link previews (logo card only), no zoom except photos, feed kept in memory, install banner | ✅ | ✅ |
| Day-3 feedback prompt, admin Feedback tab (anonymous) | ✅ | ✅ (branch `feat/feedback-prompt`) |
| Privacy policy, terms and community guidelines (`/privacy`, `/terms`) | — | ✅ (branch `feat/legal-pages-real`; set `CONTACT_EMAIL`) |
| Feed, posts with one photo, likes, comments | ✅ | ✅ |
| Report (8 reasons) and block on posts, comments, groups, questions, answers | ✅ | ✅ |
| Groups: create, join/request, leave, members, requests, group posts, class groups | ✅ | ✅ (no admin tools for roles/removing members yet) |
| Today board: pins, urgent, pin limit; offices post and delete | ✅ | ✅ |
| Ask a Senior: ask (name hidden), answer, helpful, search | ✅ | ✅ |
| Admin: moderation queue, hide, suspend, roles, offices, CLUB badge, log | ✅ | ✅ (reg-number disputes screen not built: may be dropped) |
| Images: upload, resize, strip location, serve to members only | ✅ | ✅ |
| Email sending (Resend over HTTPS; KENET blocks mail ports), backups (restic scripts) | ✅ live | backups: ❌ not confirmed on the server |

## Left before launch (in order of risk)

1. **Server (#10, #38).** ✅ Live on KENET since 24 Nov; `main` deploys itself after CI (`deploy/KENET.md`). Still to do: a **database backup before each deploy** (deploy runs migrations on restart), confirm nightly off-server backups and a restore test. Original notes: Target: the campus **KENET** server (ICT access by **Sun 29 Nov**).
   Production setup and runbook: `deploy/README.md` (Caddy does HTTPS, or `deploy/behind-proxy.yml` if the server
   already has a web server).
   The web server must forward `/api` and `/media` to the API, allow 10 MB bodies on `/api/images`
   (nginx: `client_max_body_size 10m;`), and set `TRUST_PROXY_HOPS` to the number of proxies (normally 1).
   Serve `/sw.js` and `/index.html` with `Cache-Control: no-cache` (the installable app checks them for updates).
   Production needs `CODE_PEPPER` (`openssl rand -base64 48`) or the API refuses to start.
2. **Sign-in email delivery (#35).** Test that codes reach real `student.tharaka.ac.ke` inboxes, not spam
   (`npm run email:test -w apps/api -- you@…`). If codes don't arrive, nobody can join.
3. **Moderators.** The queue (Settings → Moderation) only helps if someone checks it daily. Make the first admin
   on the server (`docs/api-contract.md` section 11), then give the Moderator role in Admin → Members.
4. **Legal pages (#14):** ✅ written (branch `feat/legal-pages-real`). Set `CONTACT_EMAIL` in `apps/web/src/config.ts`; have someone check the privacy policy against ODPC guidance.
5. **HTTPS, backups restore test, monitoring (#33, #36, #39, #40).**
6. **User testing (#41–#46)** — see ROADMAP "User involvement".

Smaller gaps in the web app: interests on edit profile, personal-email sign-in for alumni (student email closes at graduation), search, group admin tools (make admin, remove member), unblock list
in Settings, posting as an office in the feed, a shared "loading/error" component (#3 is done screen by screen).

## Decisions waiting for the team

- ~~Stop collecting reg/staff numbers~~ **Decided 25 Nov:** reg number optional for students and alumni (format-checked when
  given, migration 017); staff numbers still required.
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
