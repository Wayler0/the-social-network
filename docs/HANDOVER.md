# Handover — where the app stands (updated 25 Nov 2026; first written 15 Nov)

## ⏸ Paused 26 Nov → building resumes Thu 18 Dec → launch Sun 20 Dec

**Murphy's law review (26 Nov):** what can go wrong while nobody is coding, and on launch day.

**Checked and fine:**
- The site and database are up.
- **Certificates:** the Cloudflare certificate runs to 24 Jan 2027 and the server's Let's Encrypt certificate to 19 Feb 2027. Caddy renews automatically.
- **Domain:** `nextup.co.ke` is paid until 20 Aug 2027.
- **Dependencies:** `npm audit` finds 0 vulnerabilities.
- **CI:** every CI step passes locally. No test depends on today's date, so CI will still pass on the 18th.
- **Merge:** `feat/dark-mode` merges cleanly into `main`.

### Before you leave (today or this week)
| # | What can go wrong | Fix | Who |
|---|---|---|---|
| 1 | The site goes down during exams and **nobody notices** for weeks (#39) | A free uptime monitor on `https://hatua.nextup.co.ke/api/health` (Uptime Kuma or UptimeRobot), alerting two people | Kim |
| 2 | The server or disk dies and **everything is lost**: backups sit on the same machine, and a restore has never been tested (#36) | Copy the nightly dumps off the server (restic, `deploy/backup/`), and do one test restore | Kim |
| 3 | **Only Kim** can reach the server. If he's unreachable, nobody can restart it | Give a second person server access, and keep the KENET key backed up (one passphrase was already lost) | Kim + Solomon |
| 4 | Something merged to `main` **deploys by itself** while nobody is watching | Merge nothing to `main` until 18 Dec, except today's PR with a backup and a 10-minute check after (below) | everyone |
| 5 | Today's PR (migrations 027–029) deploys and breaks, with **nobody around** | Merge it today only if someone can check after the deploy (sign in, post, repost, the Emergency screen). Otherwise merge it first thing on the 18th | Solomon + Kim |
| 6 | Testers on the live site report abuse or press Emergency, and **nobody sees it** | At least two moderators with the role on the live site. Someone checks Admin → Reports and Alerts every few days during exams | team |

### On 18 Dec, in this order (each item stops launch if it fails)
1. **Back up the database**, then merge and deploy anything waiting. Check the site the same day.
2. **Email limits:** Resend's daily cap is shared with the other site. Launch day means thousands of sign-in codes, and once the cap is hit **nobody can sign in**. Move to a paid plan, or a plan with no low daily cap, and send a test to a student inbox (`docs/email.md`).
3. **Cloudflare real addresses** (`deploy/KENET.md`, To do 1): today, sign-in limits per address count Cloudflare's addresses. On launch day most of campus would share one limit (300 codes an hour) and **get locked out**. Fix (a), (b) and (c) before the 20th.
4. **Manual settings:** the emergency numbers on the campus row, safety offices (`safety = true`), and `CONTACT_EMAIL`. Commands are under "Manual settings" below.
5. **Push notifications:** check that the VAPID keys are set in `/opt/nextup/env/hatua.env`. Without them, the emergency push and urgent pushes never arrive.
6. **Phone test results** (#44): if code emails land in spam or students get signed out, fix that before anything else.
7. `npm audit --omit=dev`, then a final restore test (#40).

### Launch day (20 Dec)
- One person watches the API log (`docker compose logs -f hatua-api`) for `EMAIL IS NOT WORKING` and for `rate_limited`.
- One person handles Reports and Alerts.
- Server restart, if needed: `cd /opt/nextup && docker compose restart hatua-api`. Roll back with `deploy/kenet.sh <older commit>` after pausing auto-deploy (see `deploy/KENET.md`).
- **Approvals:** university written approval (hosting and email verification) and ODPC registration need checking with the university and ODPC. This is not legal advice.


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

## GitHub issues (reviewed 25 Nov)

**Done; close with a note:**
- **Screens:** #1 sign-up, #2 code entry, #7 profile, #8 layout.
- **Server:** #10 ICT server access, #33 Caddy/HTTPS, #35 email, #38 deploy (follow-up: Cloudflare, above).
- **Data and API:** #30 schema, #31 seed, #32 images (stored on a disk volume, not MinIO), #34 thumbnails and indexes, #37 admin API.
- **Legal:** #14 legal pages (follow-up: `CONTACT_EMAIL`).

**Partly done:**
- #36 backups: nightly, but on the same server.
- #39 Uptime Kuma: the backup scripts can ping a monitor; no monitor is set up.
- #29 Peter's review: ask him.

**Still ahead:**
- UX rounds #41–#46. #44, the real-phone test, is due Sun 29 Nov; script in `docs/research/round2-phone-test.md`.
- Launch: #15, #28, #40 (18–20 Dec).

## Left before launch (in order of risk)

- **Manual settings still empty:**
  - `CONTACT_EMAIL` in `apps/web/src/config.ts`: the team address, shown in the privacy policy.
  - **Emergency numbers** (built 25 Nov, migration 028): they live on the campus row and start as 999 and 112. On the server (vm-app, in `/opt/nextup`), replace the list with the real numbers:
    ```sh
    docker compose exec hatua-api node -e "const pg=require('pg');const c=new pg.Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\`update campuses set emergency_contacts = '[{\"label\":\"Campus security\",\"phone\":\"+2547XXXXXXXX\"},{\"label\":\"Health centre\",\"phone\":\"+2547XXXXXXXX\"},{\"label\":\"Police, fire and ambulance\",\"phone\":\"999\"},{\"label\":\"Emergency (any network)\",\"phone\":\"112\"}]'\`)).then(()=>c.end())"
    ```
    Or in `psql` on vm-db:
    ```sql
    update campuses set emergency_contacts = '[{"label":"Campus security","phone":"+2547XXXXXXXX"},{"label":"Health centre","phone":"+2547XXXXXXXX"},{"label":"Police, fire and ambulance","phone":"999"},{"label":"Emergency (any network)","phone":"112"}]';
    ```
    The order is the order shown in the app.
  - **Who gets emergency alerts:** moderators and admins always. To add a safety office (security, health centre, Dean of Students), create it in Admin → Offices, add its members, then mark it: `update office_accounts set safety = true where name = 'Security office';`.
- **Alumni:** linking a personal email is built (migration 027). Alumni who already graduated without one still need the reg number plus vouching or admin route.

0. **Cloudflare (decided 25 Nov): keep the proxy** for attack protection, and fix what it breaks (Kim; details in `deploy/KENET.md`, To do 1).
   - Pass the member's real address (Caddy trusts Cloudflare's `CF-Connecting-IP`; `TRUST_PROXY_HOPS=3`).
   - The server accepts traffic only from Cloudflare.
   - SSL mode Full (strict).
   - The privacy policy names Cloudflare.
   - Also still open: backups are on the same server with no restore test (#36), and `vm-db` has no PostGIS.
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
