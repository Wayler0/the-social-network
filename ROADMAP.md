# Hatua — Roadmap to the 20 December launch

**Goal:** deploy a working first version by **Sun 20 Dec 2026**, so the community can use it over the Christmas holiday and adoption grows when Semester 2 starts.

- **Project manager:** Solomon (also frontend lead)
- **Backend lead:** Kim
- **Data, media & deployment:** Peter
- **Weekly briefing:** every **Sunday, 8:00 pm, 30 min** (online or in person). Agenda: demo what works → done / blocked → next week's tasks. The PM updates this file after each briefing.

**Key dates:** Claude Pro ends **16 Nov**. Exams run **Mon 7 – Thu 17 Dec**. Only **Fri 18 – Sun 20 Dec** are free after exams, so the app must be **feature-complete and deployed before exams start (Sun 6 Dec)**. Exam time is for small fixes only.

---

## Status — Wed 25 Nov 2026, evening

**Merged today after the morning status:** moving up a year (019), story likes (020), story backgrounds (022), Follow button on posts, privacy policy and terms pages, link previews, profile photo + photo editor. Feedback prompt (021) is in PR #73.

**Fixed: class groups split by spelling.** Classmates who typed their course differently ("BSc Computer Science" vs "Bsc. Computer Science") landed in separate one-person class groups. The course box now suggests courses classmates already use (`fix/course-suggestions`). Existing members: open Edit profile and pick the course from the list.

**New branches waiting for review** (merge in this order; each tested on a clean database):
1. `fix/course-suggestions` — course suggestions (`GET /api/courses`).
2. `feat/story-notifications` (023) — notifications for new stories from people you follow and official accounts; Stories switch in notification settings.
3. `feat/story-sharing` (024, built on 2) — add someone's story to yours (only seen by people who may see the original; gone with it) or share its link.
4. `feat/event-posts` (025) — share an event to the feed as a post with an event card.

**Photo editor for posts and stories** (`feat/edit-post-story-photos`): crop, zoom, rotate before uploading; posts choose Original / Square / Portrait 4:5 / Landscape 16:9, stories are 9:16, profile photos stay a circle. Only the edited photo is uploaded (never enlarged).

**Usability review (Nielsen's 10 heuristics), 25 Nov** (`fix/heuristics`, migration 026):
- **Search:** people, groups and clubs, posts, Ask a Senior, with the usual privacy rules. Opens from the search icon on Home and the search box in Discover.
- **Edit post:** text only, shown as "Edited". Earlier text is kept for moderators.
- **Fewer dead ends:** the Messages icon (chat isn't built yet) and the Market tile are gone.
- **Offline banner.**
- **Drafts:** post and story text is kept on the phone until posted, and cleared on sign-out.
- **Clearer error messages.**
- **Help page:** a short FAQ, linked from Settings.

**Reposts** (migration 029):
- **Feed:** anyone can repost a campus post, or repost it with a comment. The repost shows the original inside it, or "no longer available" once it's gone. One Share button holds Repost, Repost with your comment, and Share link, like stories (group posts get Share link only). Undo from the same button.
- **Stories:** like WhatsApp, others can add your story to theirs only if you tick "Let others add this to their story" (off by default).

**Chat: January 2027** (DECIDED 26 Nov). Until then there's no Messages icon; the Help page says chat is coming.

**Emergency button** (migration 028): Settings → Emergency help, or the Discover tile.
- **Numbers:** tap-to-call, stored on the campus row (999 and 112 until the real campus numbers are added; see `docs/HANDOVER.md`).
- **Alert campus safety:** an optional message, a confirm step, then an alert to moderators, admins and safety offices (notification and push). They handle it in Admin → Alerts.
- **No location is sent.**

**Keep access after graduating** (`feat/dark-mode` branch, migration 027): Settings → "Keep access after graduating" links a personal email (with a code). After graduating, the sign-in screen offers "Graduated? Sign in with your linked personal email".
- It never creates accounts.
- Students who answer "I've graduated" in the year check are sent to link one.
- Help and the privacy policy explain it.
- Not built yet: alumni who already graduated without linking one still need reg number plus vouching or admin review (CLAUDE.md section 5).

**Dark mode** (`feat/dark-mode`, stacked on `fix/heuristics`):
- **Dark is the default look** (DECIDED 25 Nov, testers love it). Settings → Appearance still offers Light and System (follow the phone). The choice is remembered on the phone.
- **Dark from the first frame:** the status bar and the installed app's launch screen are dark too.
- **Sheets and pop-ups** sit a step lighter than the page, as on the canvas.
- **Colours** are from the dark design canvas. Filled buttons stay violet, and the status bar turns dark too.
- **Checked:** 16 screens in the browser. No leftover white backgrounds, and all text meets readable contrast (4.5:1) in both themes.
- **Checked:** signed-out screens (welcome, code entry) too.

**Still to check by hand on a phone** (the browser tool was down): story sharing sheet, course suggestions, event card in the feed.

**Open:** APK — wait for the final domain, or build a Trusted Web Activity now? · team contact email for the privacy policy · next graduation date (alumni sign-in).

## Status — Wed 25 Nov 2026

**Live:** the app runs at hatua.nextup.co.ke on the KENET server (first live 24 Nov). `main` deploys itself once CI passes (Kim, PR #62), when `DEPLOY_ENABLED` is set. `main` is protected: CI must pass and one other person must approve each PR.

**Ahead of plan.** M1 and most of M2–M3 are done, and several "after launch" items are built (v0.2 backend by Kim, frontend in the 25 Nov sprint):

| Area | Done (on `main`) |
|---|---|
| Accounts | Email-code sign-in (Resend), sign in once per device (180-day sessions), remembered email, profile photo, optional reg number with format check, "Make Home yours" follow step, download my data, delete account |
| Social | Follows (people, offices, clubs), other members' profiles, reactions, saved posts, share a post's link, stories (row, viewer, who viewed), club pages (Follow, Announcements / Discussion), events, notifications + push |
| Feel | Feed kept in memory (no reload when you come back), no zoom except photos, photo viewer and download, install banner, link previews (Hatua logo card, never post content) |

**Waiting for review (PRs, CI green or pending):** moving up a year on 1 September (`feat/year-rollover`, migration 019) · story likes (`feat/story-likes`, 020) · story backgrounds (`feat/story-backgrounds`, 022, merge after story likes) · day-3 feedback prompt + admin Feedback tab (`feat/feedback-prompt`, 021) · Follow button on posts (`feat/follow-from-post`) · **privacy policy and terms pages** (`feat/legal-pages-real`).

**Decisions made 25 Nov** (also in CLAUDE.md): reg number optional (format-checked when given) · student email closes at graduation, so alumni need a personal-email sign-in · students move up a year on 1 September and confirm it · link previews show only the Hatua logo card · stories: people you follow, official accounts, clubs you follow or belong to.

**Before inviting the beta group (week 3):**
1. Merge `feat/legal-pages-real` (the sign-up links to Terms and Privacy policy went nowhere) and set `CONTACT_EMAIL` in `apps/web/src/config.ts`. Have someone read the privacy policy against ODPC guidance.
2. Merge `feat/feedback-prompt` so testers can send feedback in the app.
3. **Back up the database**, then deploy (migrations 019–022 run on live data). `deploy.sh` has no backup step yet: add one.
4. Confirm on the server: disk encryption and nightly off-server backups (the privacy policy only promises HTTPS and limited access until then).
5. Invite 15–20 testers aged 18+ (class reps, IEEE, ISACA, student council, 1–2 staff).

**Still to build:** personal-email sign-in for alumni (before the next graduation) · search (MVP item 10) · "followed by people you know", post count and bio on profiles · backup step in the deploy · phone test on Android + iPhone (Peter).

**Open questions:** next graduation date (decides how urgent alumni sign-in is) · team contact email for privacy requests · club stories: keep, or only people + official accounts? · photo previews for official posts (option B) — not now.

## What ships on 20 Dec (v0.1 "Holiday preview")

Only what a member needs to join and use it daily:

1. **Sign-up and login:** one-time code to `@student.tharaka.ac.ke` / `@tharaka.ac.ke`, profile (name, photo, course, year, member type), delete account.
2. **Feed:** text and image posts, likes, comments, report and block.
3. **Groups:** public and private, join and leave, group posts, auto groups per course and year.
4. **Today board:** pinned announcements from office accounts (admins create them).
5. **Ask a Senior:** questions and answers, with "hide my name from students".
6. **Admin panel (minimal):** moderation queue, hide content, suspend user, create office accounts and announcements.
7. **Installable PWA** on Android, iPhone and desktop.
8. **Legal basics:** privacy policy, community guidelines, terms.

**Not in v0.1** (planned, see "After launch"): one-to-one chat, push notifications, reels, campus map, ads, emergency button, search beyond basics. The Reels tab is in the nav from v0.1 but shows a "Coming soon" screen.

---

## Milestones

| # | Milestone | Due | Owner |
|---|---|---|---|
| M0 | Decisions made, repo skeleton, Docker setup, DB schema, auth design, backlog | Sun 15 Nov | All (+ Claude sprint) |
| M1 | Sign-up/login with university email code works end to end; profiles | Sun 22 Nov | Kim + Solomon |
| M2 | Feed works (posts, images, likes, comments, report/block); **server access confirmed by ICT**; email sending works | Sun 29 Nov | All |
| M3 | Groups, Today board, Ask a Senior, admin panel; **deployed on the server; feature freeze** | Sun 6 Dec | All |
| M4 | Small pilot during exams (team + a few friends); bugs logged and the worst fixed | Thu 17 Dec | All (light) |
| M5 | Final fixes, backup restore tested, security check, groups and Today board seeded | Sat 19 Dec | All |
| 🚀 | **Public launch (v0.1)** | **Sun 20 Dec** | Solomon announces |

---

## User involvement (user-centred design) — DECIDED 12 Nov

Users are involved **every week before the feature freeze**, so their feedback can still change the design, not just fix bugs. Five people per round is enough to find most usability problems; many small rounds beat one big one.

| When | Who takes part | What we learn | Owner |
|---|---|---|---|
| **Week 0 (now – Sun 15 Nov)** | 8–10 short interviews (10 min): freshers (18+ only), continuing students, 1–2 staff, an alumnus. Plus a short anonymous Google Form shared in class groups | Real needs and pain points; checks the v0.1 feature list and priorities | Everyone (3 interviews each); Solomon runs the form |
| **Week 1 (by Sun 22 Nov)** | 5 students try the design canvas on a phone (tasks: "find the ISACA club", "ask a senior a question") | Do navigation and screens make sense before we code them? | Solomon |
| **Week 2 (by Sun 29 Nov)** | 5 students test real sign-up and feed on their own phones, on campus Wi-Fi and mobile data | Do code emails arrive? Speed on cheap phones? Confusing steps? | Solomon + Peter |
| **Week 3 (by Sun 6 Dec)** | Beta group of 15–20 (class reps, IEEE/ISACA members) uses it for real; in-app feedback link | Do people come back the next day? What's missing? | Solomon |
| **Exams (7–17 Dec)** | Pilot (below) + a 3-question survey at the end | Launch blockers | All |
| **After launch** | Monthly feedback form + analytics (sign-ups, return visits) | What to build in v0.2 | Solomon |

**Rules:** say what we're testing and get verbal consent; anonymous notes only ("Year 1, BSc CS") — no names, faces or recordings; under-18s are not interviewed unless the university approves. Every finding becomes a GitHub issue labelled `user-feedback` and is discussed at the Sunday briefing. Interview guide and form questions: `docs/research/`.

---

## Week-by-week plan

Hours are per person.

### Week 0 — Wed 11 to Sun 15 Nov (setup + Claude sprint)

| Day | Solomon | Kim | Peter |
|---|---|---|---|
| Wed 11 | Run team meeting; record decisions in CLAUDE.md; finish GitHub SSH | Meeting; accept repo invite | Meeting; accept repo invite |
| Thu 12 | **COSC 464 CAT** — no Hatua work | Read brief (sections 5, 12, 13) | Read brief (sections 12, 13); list server questions for ICT |
| Fri 13 – Sun 15 | Claude sprint: repo skeleton, Docker Compose, DB schema + migrations, auth (email code), PWA shell + design tokens, CI, docs, GitHub issue backlog | Review the auth design and API structure; set up locally | Review schema + Docker setup; set up locally |
| Sun 15 | **Briefing #1:** walk through the skeleton, assign week-1 issues | | |

**Server request to university ICT: DONE (made in person).** Follow up for the server (specs, VM, public IP or port forwarding, a `tharaka.ac.ke` subdomain, an SMTP relay for sending emails). We need access by **Sun 29 Nov** — this is the critical path.

### Week 1 — Mon 16 to Sun 22 Nov (build: ~2 h/day on weekdays)

- **Solomon:** sign-up and code-entry screens, profile and edit-profile screens, app layout (bottom nav, top bar), loading/empty/error states. Chase ICT.
- **Kim:** auth API (request code, verify code, sessions, logout, rate limits), domain rules (student vs staff), profile API, delete account.
- **Peter:** schema for users, profiles, groups, posts; seed data (courses, years, test users); image upload to MinIO (resize/compress); deployment scripts started (Caddy, HTTPS).
- **Briefing #2 (Sun 22):** demo sign-up → profile. **M1.**

### Week 2 — Mon 23 to Sun 29 Nov (build: ~2–3 h/day on weekdays)

- **Solomon:** feed screen, post composer (text + image), post card (likes, comments), report and block menus. Get server access from ICT.
- **Kim:** posts, comments, likes API; report and block API; feed query (newest first, paginated); start groups API.
- **Peter:** image pipeline finished; feed indexes; email sending (university relay or a sending service with SPF/DKIM) — test that codes reach `student.tharaka.ac.ke` inboxes, not spam; backups with restic.
- **Briefing #3 (Sun 29):** demo the feed. **M2.**

### Week 3 — Mon 30 Nov to Sun 6 Dec (last build week before exams: ~3 h/day)

- **Solomon:** groups screens, Today board screen, Ask a Senior screens, admin panel screens; privacy policy, guidelines and terms.
- **Kim:** groups API finished (private approval, group posts, auto course/year groups); Today board / announcements API; Ask a Senior API.
- **Peter:** admin API (moderation queue, hide, suspend, office accounts); **deploy to the campus KENET server** (runbook: `deploy/README.md`); monitoring (Uptime Kuma).
- **Sun 6 Dec:** **feature freeze** and **Briefing #4**. Everything is on the server. **M3.**

### Week 4 — Mon 7 to Thu 17 Dec (EXAMS: ~2–3 h for the whole week, max)

- **Everyone:** exams first. Use the app normally on the server; log bugs as GitHub issues.
- **Pilot:** the team plus a few friends use it. No big changes; fix only what blocks sign-up or posting.
- **Briefing #5 (Sun 13):** 15 minutes; triage the bug list, agree what gets fixed on 18–19 Dec.

### Launch — Fri 18 to Sun 20 Dec (exams over: 4–6 h/day)

| Day | Focus |
|---|---|
| Fri 18 | Fix the pilot bug list (everyone); test a real backup restore (Peter); security check: only ports 80/443 open, rate limits, admin access (Solomon) |
| Sat 19 | Final deploy (Peter); seed groups, office accounts and Today board posts so the app isn't empty (Solomon); last fixes (Kim). **M5** |
| Sun 20 | 🚀 **Launch:** announce in class groups, clubs (IEEE, ISACA) and student council (Solomon). Team watches the server and moderation queue |

---

## After launch

- **Holiday (21 Dec – Jan):** fix bugs, respond to feedback, moderate. Build **v0.2** (aim mid-January):
  - **Chat** with optional **disappearing messages** (24 h after seen; reported messages are kept for moderators) and view-once photos.
  - **Push notifications.** Built early, on `main`; turned on per server with the Web Push keys (deploy/KENET.md, "Push notifications").
  - **Camera-first create** with **campus frames** (Freshers Week, Graduation, Sports, Clubs) and stickers.
  - **Events** with Going / Interested.
  - **Reactions** beyond like.
- **Semester 2 start:** adoption push with freshers, class reps and clubs; **v0.3:** campus map and places search (places and events only, never live location of people), emergency button, **Campus Market** (verified members only, meet in person, no payments in the app; sponsored listings).
- **Later:** reels (needs bandwidth and storage planning), ads.
- **Deliberately not doing:** live location sharing, streaks (pressure on under-18s and during exams), fully disappearing posts (moderators need evidence).

**Design:** screens for v0.1 and v0.2 are on the Hatua design canvas (Claude artifact, shared from the canvas's Share menu). Look: Instagram-style feed and profile, TikTok-style reels, Facebook-style groups/events/market, Snapchat-style camera and chat; own colours (violet `#6A3DF5`, coral `#FF3D71`, sunshine `#FFC83D`, mint `#14C8A8`).

---

## Risks to watch every briefing

| Risk | Impact | Plan |
|---|---|---|
| University ICT doesn't give server access to the KENET server by 29 Nov | No deploy before exams | Ask this week and follow up every few days. **DECIDED 16 Nov:** no personal droplet or VPS as a fallback; if access is late, the pilot moves and the dates are re-planned at the next briefing |
| Verification emails land in spam or are blocked | Nobody can sign up | University SMTP relay if ICT allows, else a sending service with SPF/DKIM; test in week 2 |
| Week 3 is overloaded (last week before exams) | Features unfinished at freeze | Start groups API in week 2; if needed, launch Ask a Senior as a special group; never cut report/block |
| Exams (7–17 Dec) | No time for fixes | Feature freeze 6 Dec; only 18–19 Dec for final fixes |
| Claude Pro ends 16 Nov | Slower coding | Do scaffolding and auth in the sprint; apply for the GitHub Student Developer Pack (Copilot) with student emails |
| Too few early users | App feels empty | Seed groups and Today board on 19 Dec; invite clubs and class reps first |
