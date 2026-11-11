# Hatua — Roadmap to the 20 December launch

**Goal:** deploy a working first version by **Sun 20 Dec 2026**, so the community can use it over the Christmas holiday and adoption grows when Semester 2 starts.

- **Project manager:** Solomon (also frontend lead)
- **Backend lead:** Kim
- **Data, media & deployment:** Peter
- **Weekly briefing:** every **Sunday, 8:00 pm, 30 min** (online or in person). Agenda: demo what works → done / blocked → next week's tasks. The PM updates this file after each briefing.

> Assumptions to confirm at the first meeting: exams run about **30 Nov – 12 Dec** (adjust weeks 3–4 if not); Claude Pro ends **16 Nov** (heavy scaffolding happens before then); everyone can give the hours below.

---

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

**Not in v0.1** (planned, see "After launch"): one-to-one chat, push notifications, reels, campus map, ads, emergency button, search beyond basics.

---

## Milestones

| # | Milestone | Due | Owner |
|---|---|---|---|
| M0 | Decisions made, repo skeleton, Docker setup, DB schema, auth design, backlog | Sun 15 Nov | All (+ Claude sprint) |
| M1 | Sign-up/login with university email code works end to end; profiles | Sun 22 Nov | Kim + Solomon |
| M2 | Feed (posts, images, likes, comments, report/block) works | Sun 29 Nov | Peter + Kim + Solomon |
| M3 | Server access confirmed by university ICT; domain and email sending ready | Sun 6 Dec | Solomon + Peter |
| M4 | Groups, Today board, Ask a Senior, admin panel | Sun 13 Dec (light, exams) → finish Wed 16 Dec | All |
| M5 | Deployed on the server, tested with 10–20 pilot users, bugs fixed | Sat 19 Dec | All |
| 🚀 | **Public launch (v0.1)** | **Sun 20 Dec** | Solomon announces |

---

## Week-by-week plan

Hours are per person. Exam weeks are deliberately light.

### Week 0 — Wed 11 to Sun 15 Nov (setup + Claude sprint)

| Day | Solomon | Kim | Peter |
|---|---|---|---|
| Wed 11 | Run team meeting; record decisions in CLAUDE.md; finish GitHub SSH | Meeting; accept repo invite | Meeting; accept repo invite |
| Thu 12 | **COSC 464 CAT** — no Hatua work | Read brief (sections 5, 12, 13) | Read brief (sections 12, 13); list server questions for ICT |
| Fri 13 – Sun 15 | Claude sprint: repo skeleton, Docker Compose, DB schema + migrations, auth (email code), PWA shell + design tokens, CI, docs, GitHub issue backlog | Review the auth design and API structure from the sprint; set up locally | Review schema + Docker setup; set up locally |
| Sun 15 | **Briefing #1:** walk through the skeleton, assign week-1 issues | | |

**Also this week (Solomon):** email university ICT asking for the server (specs, VM, public IP or port forwarding, domain such as a `tharaka.ac.ke` subdomain, SMTP relay for sending emails). This is the critical path — the launch depends on it.

### Week 1 — Mon 16 to Sun 22 Nov (build: ~2 h/day on weekdays)

- **Solomon:** sign-up and code-entry screens, profile and edit-profile screens, app layout (bottom nav, top bar), loading/empty/error states. Follow up with ICT.
- **Kim:** auth API (request code, verify code, sessions, logout, rate limits), domain rules (student vs staff), profile API, delete account.
- **Peter:** finish schema for users, profiles, groups, posts; seed data (courses, years, test users); image upload to MinIO (resize/compress); run the stack on a test machine.
- **Briefing #2 (Sun 22):** demo sign-up → profile. **M1.**

### Week 2 — Mon 23 to Sun 29 Nov (build: ~2 h/day on weekdays)

- **Solomon:** feed screen, post composer (text + image), post card (likes, comments), report and block menus.
- **Kim:** posts, comments, likes API; report and block API; feed query (newest first, paginated).
- **Peter:** image pipeline finished; feed performance (indexes); start deployment scripts (Caddy, HTTPS, backups with restic).
- **Briefing #3 (Sun 29):** demo the feed. **M2.**

### Week 3 — Mon 30 Nov to Sun 6 Dec (exams: ~3 h for the whole week)

- **Solomon:** confirm server access with ICT; write privacy policy, community guidelines and terms (drafts).
- **Kim:** groups API (create, join, leave, private approval, group posts).
- **Peter:** deploy a test copy to the campus server (or a temporary VPS if ICT isn't ready); set up email sending (SPF/DKIM) and test that codes reach `student.tharaka.ac.ke` inboxes, not spam.
- **Briefing #4 (Sun 6):** short. **M3.**

### Week 4 — Mon 7 to Sun 13 Dec (exams: ~3 h for the whole week)

- **Solomon:** groups screens; Today board screen.
- **Kim:** Today board / announcements API; Ask a Senior API.
- **Peter:** admin API (moderation queue, hide, suspend); monitoring (Uptime Kuma).
- **Briefing #5 (Sun 13):** short; agree launch-week plan.

### Week 5 — Mon 14 to Sun 20 Dec (launch week: 4–6 h/day, exams over)

| Day | Focus |
|---|---|
| Mon 14 – Tue 15 | Finish M4: Ask a Senior screens (Solomon), admin panel screens (Solomon + Kim), auto course/year groups (Kim), seed office accounts (Peter) |
| Wed 16 | **Feature freeze.** Only bug fixes from now |
| Thu 17 | Deploy to the campus server (Peter); backups tested with a real restore (Peter); security check: only ports 80/443 open, rate limits, admin access (Solomon) |
| Fri 18 | **Pilot:** 10–20 users (IEEE, ISACA, class reps) sign up and use it; collect bugs (Solomon) |
| Sat 19 | Fix pilot bugs (Kim, Peter, Solomon). **M5** |
| Sun 20 | 🚀 **Launch:** announce in class groups, clubs and student council (Solomon). Team watches the server and moderation queue |

---

## After launch

- **Holiday (21 Dec – Jan):** fix bugs, respond to feedback, moderate. Build **one-to-one chat** and **push notifications** (v0.2, aim mid-January).
- **Semester 2 start:** adoption push with freshers, class reps and clubs; **v0.3:** campus map and places search, emergency button.
- **Later:** reels (needs bandwidth and storage planning), ads, events.

---

## Risks to watch every briefing

| Risk | Impact | Plan |
|---|---|---|
| University ICT doesn't give server access in time | No launch | Ask this week; fallback: temporary VPS, move to campus later |
| Verification emails land in spam or are blocked | Nobody can sign up | Use the university SMTP relay if ICT allows, else a sending service with SPF/DKIM; test early (week 3) |
| Exams eat more time than planned | Launch slips | Scope is already minimal; cut Ask a Senior to a group if needed, never cut report/block |
| Claude Pro ends 16 Nov | Slower coding | Do scaffolding and auth in the sprint; apply for the GitHub Student Developer Pack (Copilot) with student emails |
| Too few early users | App feels empty | Seed groups and Today board before launch; invite clubs and class reps first |
