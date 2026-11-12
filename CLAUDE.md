# Project Brief: Hatua — Tharaka University Social Network

Working name "Hatua" (Swahili: "step") is a placeholder.
Read this whole brief before writing code. Ask the team before changing any decision marked DECIDED.

## 1. What we're building

A free, members-only social network for the Tharaka University community: freshers, continuing students, alumni and staff.
A place to network, learn and have fun — posts, groups, one-to-one chat, short videos (reels), campus news and a campus map — student-first.

Why it matters:
- **Know first:** campus news (good and bad) reaches the community quickly, with official confirmation.
- **Find your way:** freshers and shy/introverted students can learn the university (places, people, how things work) before they have to ask anyone face to face.
- **Stay connected:** alumni network with and help current students.

Decisions:
- **DECIDED:** strictly Tharaka University. Only verified members can join or see content (closed to the outside, open inside).
- **DECIDED:** free for users. No payments in the app.
- **DECIDED:** social network is the core; education, news and fun live side by side.
- **DECIDED:** self-hosted on the university's campus (KENET) server. Not Render.

## 2. Who it's for

Member types (chosen at sign-up, verified, updated over time):
1. **Freshers** — newly admitted students (some may be 17).
2. **Continuing students** — current students in any year.
3. **Alumni** — graduates; network with and mentor students.
4. **Staff** — lecturers and university staff (student-first rules, see section 6).

Profiles show member type, course/school, year of study or graduation year, interests, and any role badges.

Expected size: ~20,000 members at launch, growing with each intake and as alumni join (plan for 50,000+).

## 3. Roles and accounts

- **Personal accounts:** everyone has one and uses it normally.
- **Role badges (verified, time-bound):** Staff, Student Leader, Club Leader, Moderator. Shown on the personal profile so nobody can impersonate them. Student/club leader roles expire at the end of the term of office.
- **Office accounts:** official pages run by people with a role, e.g. "Student Council", "Academic Rep – School of Science", "Registrar", "Library", "Dean of Students", "IEEE Tharaka", "ISACA Tharaka". Used for official announcements. On handover, the office account (history and followers) passes to the next holder; personal accounts stay with the person.
- **Verified office accounts** can post to the Today board and send push notifications (section 4.7).

## 4. Features

### MVP (build in this order)

1. **Accounts, verification & profiles** — sign up, prove Tharaka membership (section 5), member type, course, year, profile photo, delete account (in app and on the web), data export.
2. **Feed & posts** — text, images, likes, comments. Report and block on everything. Anyone verified can post; all members see feed posts (including staff posts).
3. **Groups** — any member can create one: public (any member can join) or private (approval/invite). Students can make **student-only** groups that staff cannot see or join. Auto-created groups per course and year. Group admins moderate their group.
4. **One-to-one chat** — direct messages, message requests from strangers, block, report a conversation.
5. **Ask a Senior** — freshers ask anything (hostels, offices, lecturers, where things are); continuing students and alumni answer; answers stay searchable. Askers may hide their name from other students (moderators can still see who asked). No fully anonymous posting anywhere else.
6. **Campus map & places search** — see section 7.
7. **Today board & official announcements** — when a member opens the app for the first time each day, they see pinned announcements from verified office accounts (departments, offices, student council). Each has an expiry date; limit on how many can be pinned at once; urgent vs normal (urgent always shows, normal can be collapsed).
8. **Emergency / Urgent button** — alerts moderators and official safety accounts (security, health centre, dean of students) directly, and shows emergency numbers (campus security, ambulance, police). A normal feed post can still be made too.
9. **Reels** — short vertical videos (education and fun), likes, comments, report. Data-saver mode (no autoplay on mobile data).
10. **Search** — people, groups, posts, Ask a Senior answers, places, reels.
11. **Sponsored content** — section 8.
12. **Push notifications** — replies, messages, group activity, urgent announcements.

### Club pages (DECIDED 12 Nov 2026)

Clubs and societies use **groups, not a separate channels feature**. Fun groups stay ordinary groups.

| | Societies & clubs | Fun groups | Offices |
|---|---|---|---|
| Set up as | Group with **Announcements** (admins only) + **Discussion** (members) tabs | Ordinary group | Office account |
| Follow without joining | Yes: announcements appear in followers' feeds | No, members only | Yes |
| Stories on the Today row | Yes, to followers, after official stories | No | Yes, first, for everyone |
| Badge | CLUB, given by an admin after checking the Dean of Students' list of registered societies | None | OFFICIAL |
| Handover to next leaders | Yes, like office accounts | Admins add new admins | Yes |

- **Follow** = announcements in your feed. **Join** = you can also post in Discussion.
- **v0.1:** "only admins can post" setting on groups + CLUB badge. **v0.2:** Follow, club stories, handover.

### Stories / status (DECIDED 12 Nov 2026)

Any verified member can post a story. The stories row at the top of Home shows, in order: **your own ("Your story +") → official accounts (always first among others, everyone sees them) → clubs you follow → people you follow**.

| Rule | Why |
|---|---|
| Disappears after 24 h | Standard; keeps storage small |
| Default audience: followers. Options: Close friends, hide from specific people | Privacy |
| Under-18 members: only people they follow back see their stories | Child safety |
| Staff can't see a student's story unless the student follows them | Student-first staff rule (section 6) |
| Viewer list for the author | Expected; discourages lurking |
| Replies go to chat as a message request | Reuses chat |
| Report on every story; reported stories kept for moderators like deleted messages (section 6) | Moderation |
| Photo and text only; video stories later with Reels | Data cost and storage |

- **v0.1:** official accounts only. **v0.2:** personal and club stories (needs chat for replies, 24 h expiry jobs, viewer lists). **Later:** video stories.

### Later (not MVP)

Group chats, events calendar, notes and past papers, alumni mentorship matching, own walking directions on campus (section 7), offline reading.

## 5. Membership verification (Tharaka University only)

Keep outsiders out while staying easy for real members.

### Identifier

- **Registration number** is the membership identifier for students and alumni; **staff number** for staff.
- It is a unique field, **not** the database primary key (use an internal ID). Reg numbers can be mistyped, change format, or change for a person (e.g. diploma → degree).
- It is personal data (Data Protection Act): never shown on profiles or in search; visible only to the member and admins.
- One account per reg/staff number, plus a "someone has claimed my reg number" dispute button.

### The real problem: ownership, not existence

Knowing a reg number exists is not enough. Reg numbers appear on exam lists, notice boards and ID cards, so anyone can type a friend's. Verification must prove the person **owns** the number.

### Options (weakest to strongest)

| Method | Proves it exists | Proves it's theirs | Needs the school |
|---|---|---|---|
| Format check only (matches the reg number pattern) | No | No | No |
| Upload student ID / admission letter, moderator checks | Partly | Mostly | No — but manual work and sensitive data (delete after checking) |
| Class rep / classmate vouching (class reps already have class lists) | Yes | Yes | No |
| University email one-time code (if students have university email, especially if built from the reg number) | Yes | Yes | No — uses email the university already provides |
| ERP lookup (read-only "does this reg number exist, does the name match?") | Yes | Needs a second step | Yes — formal data-sharing agreement |

### DECIDED: one-time code to a university email

- Sign-up requires an email ending in **`tharaka.ac.ke`**. A one-time code is sent there; entering it proves the person controls a university mailbox.
- The domain sets the member type:
  - `@student.tharaka.ac.ke` → student (fresher or continuing; the member picks which, and gives their reg number).
  - `@tharaka.ac.ke` (no student subdomain) → staff (gives staff number; Staff badge after admin approval).
- Match the domain exactly (the part after `@` must be `tharaka.ac.ke` or `student.tharaka.ac.ke`), so look-alikes such as `tharaka.ac.ke.evil.com` or `faketharaka.ac.ke` are rejected.
- Reg number is still collected, format-checked and unique per account.
- Re-verify periodically (e.g. yearly) so access ends when someone leaves.
- **Open:** do alumni keep their student email after graduating? If not, alumni verify by reg number + graduation year + vouching/admin review, ideally verifying before their student email is closed (prompt final-year students to link a personal email).
- **Fallback for edge cases** (no university email yet, e.g. a brand-new fresher): class-rep vouching or ID upload checked by a moderator.
- **Alumni:** reg number + graduation year + vouching by verified members or admin review.
- **Staff:** staff email or staff number + admin approval.
- **Roles** (Student Leader, office accounts, etc.) are granted by admins, never self-claimed.
- **In parallel:** when asking the university for hosting approval, also ask for an official ERP verification link and a data-sharing agreement. This is the long-term answer.
- **Never** probe the student portal or ERP to test whether reg numbers exist without written permission. That is unauthorised access under the Computer Misuse and Cybercrimes Act 2018 and would destroy trust with university ICT.

Unverified accounts cannot see or post anything.

## 6. Trust & safety (non-negotiable)

- Report and block on every post, comment, reel, group, chat and profile; admin moderation queue; group admins moderate their groups.
- Community guidelines page; warn, suspend and ban accounts.
- **Student-first staff rules:** staff posts are visible to everyone, but staff cannot send message requests to students (students may message staff), and staff cannot see student-only groups.
- **Under-18 members** (some freshers are 17): no DMs from strangers by default, safer defaults, age-appropriate content.
- **Breaking news and sensitive events** (e.g. a student's death or an accident):
  - Do not name someone who has died or been seriously hurt until it is officially confirmed or the family has been told.
  - No photos or videos of injured or dead people.
  - Moderators can hide such posts in one tap, and label or pin confirmed information from official accounts.
- Chat: message requests from strangers, easy block, report a conversation.
- **Deleting and disappearing messages (chat, v0.2):**

  Chats are end-to-end encrypted (section 12, Security & encryption), so the server only ever holds ciphertext. Deleted content is kept on the **recipient's device**, not the server.

  | Situation | The other person sees | What is kept, and where |
  |---|---|---|
  | Delete for me | No change | The message stays on their device |
  | Delete for everyone | "This message was deleted" (no content) | Their app keeps the content hidden for **7 days** so they can still report it, then erases it |
  | Reported (before or after deletion) | "This message was deleted" if deleted | The reporter's app sends the reported messages to moderators with a **franking tag** proving the sender really sent them; kept until the report is closed |
  | Disappearing messages (24 h after seen, both people turned on) | No notice | Erased on both devices after 24 h unless reported; the server's ciphertext is deleted once delivered |

  Why the notice: the other person may already have seen it, replies to it must still make sense, and it stops "send then delete" harassment. Keeping deleted content only for reports, for a fixed time, follows DPA data minimisation.
- Reels/images: moderation tools for nudity, violence and harassment.

## 7. Campus map, places search & directions

Coverage: Tharaka University campus and the surrounding area — Marimanti, Gatunga, Mukothima and the perimeter.

- **Base map:** OpenStreetMap (OSM) data. The team and clubs add missing campus buildings, footpaths, gates and local places to OSM (trace from satellite imagery in the OSM web editor; walk with StreetComplete / Every Door / OsmAnd). Organise a mapping day with clubs.
- **Rendering:** MapLibre GL JS with a self-hosted Protomaps (PMTiles) file for the area — cheap, fast, can work offline.
- **Our own places database:** library, lecture halls, offices (with opening hours), hostels, health centre, security, matatu/boda stages, shops, cyber cafés, banks/M-Pesa agents. Our search bar searches this first.
- **Directions v1:** show the place on our map + "Open in Google Maps" for walking/driving directions.
- **Directions v2 (later):** our own walking directions on campus using OSM footpaths and an open-source routing engine (e.g. GraphHopper or Valhalla).
- Do not use the paid Google Maps API.
- Private details (room numbers, people's homes) stay in our app only, never on OSM.

## 8. Sponsored content (how we make money)

- **DECIDED:** the team runs three kinds of ads: **jobs**, **courses** and **products**.
- Ad deals and payment happen outside the app (no in-app payments, no self-serve ad checkout).
- Admins create ads in an admin panel: title, text, image/video, link, category (job | course | product), target member types/courses/years, start and end dates.
- Every ad is clearly labelled "Sponsored" and never disguised as a member post.
- Targeting uses what members tell us (member type, course, year, interests) and what they search/view in the app. No GPS or location tracking for ads.
- Log every ad view and click in our own database to report results to advertisers (views, clicks, by audience and date).
- Job ads: verified employers only; reject any job that asks applicants to pay. Show "Never pay anyone to apply."

## 9. Distribution & platform goals

- **DECIDED:** no reliance on Google Play Store or Apple App Store, but built to meet their guidelines so we can list later.
- Primary: a **Progressive Web App** (installable from the browser on Android, iPhone and desktop).
- Optional: an Android **APK** downloadable from our website (thin wrapper around the PWA, e.g. Trusted Web Activity or Capacitor).
- Store-readiness from day one: UGC moderation (report, block, filter), in-app + web account deletion, privacy policy, honest data disclosures, age gate, clearly labelled ads, no in-app payments.
- Mobile-first, light on data, fast on cheap Android phones.

## 10. Privacy & legal (Kenya)

- Kenya Data Protection Act 2019: clear consent, privacy policy, cookie notice, account + data deletion, data export.
- Collect the minimum. No precise location tracking; the map shows places, not people.
- Private chats are personal data: protect them, limit staff/admin access, say so in the privacy policy.
- Data is hosted on campus in Kenya.
- Check registration requirements with the Office of the Data Protection Commissioner (ODPC) before launch.
- Get written approval from the university (ICT and administration) for hosting, use of the university name/logo, and official office accounts.
- (Team to confirm details with ODPC — not legal advice.)

## 11. Analytics

- Self-hosted, privacy-friendly analytics (e.g. Umami or Plausible self-hosted) to keep data on our server.
- Events: signup (member type), verify_success, post_create, reel_upload, group_join, message_send, ask_senior_question, place_search, emergency_alert, ad_view, ad_click (ad_id, category).
- Goal: real monthly numbers to show advertisers and the university.

## 12. Tech stack (self-hosted on the campus KENET server)

**Principle:** the requirements choose the stack. Team familiarity is only a tie-breaker between options that all fit. Status: **proposed** — the team challenges each row, then we mark it DECIDED.

### Requirements that drive the choice

At 20k–50k members, almost any modern stack handles the basic load, so the deciding factors are:
1. **Members-only, behind login** — search engines never index it, so server-side rendering for SEO has no value.
2. **Installable PWA** — works offline, fast on cheap Android phones and slow data.
3. **Real-time chat and notifications** — thousands of open connections at once.
4. **Reels** — video transcoding and streaming over a limited university uplink.
5. **Maps and places** — geographic data and "near me" queries.
6. **One self-hosted campus server**, run by students, with backups and a clean handover.
7. **Privacy and security** — Kenya Data Protection Act, under-18 members, private chats.

### Proposed stack

| Need | Choice | Why it fits |
|---|---|---|
| App (PWA) | **React + Vite single-page app**, Workbox for offline | No SEO need (req. 1), so SSR (Next.js) adds server load for no benefit. An app-shell PWA caches and works offline well (req. 2). Mature libraries for virtualised feeds, video players and MapLibre. |
| API | **Node.js + TypeScript** (Fastify or Express) | Holds thousands of WebSocket connections cheaply on one server (req. 3, 6). One language end to end: the same validation schemas (e.g. zod) on app and server. |
| Database | **PostgreSQL + PostGIS** | Relational data (members, groups, follows) is its strength; built-in full-text search for launch; PostGIS for places and map queries (req. 5). |
| Real-time | **WebSockets + Redis pub/sub** | The proven pattern for chat and live notifications (req. 3); Redis lets us run a second API process later. |
| Background jobs | **Redis + BullMQ** | Video transcoding, emails and push run in the background so users don't wait. |
| Reels | **ffmpeg → HLS at 360p/480p/720p, stored in MinIO** | Adaptive quality for a small uplink and cheap phones (req. 2, 4); stays on our server. Cap length and file size. |
| Login | **Passwordless one-time code to the university email** | Matches the verification decision (section 5). No passwords to leak or reset; sessions in secure httpOnly cookies (req. 7). |
| Search | Postgres full-text at launch → **Meilisearch** if it gets slow | Lightweight, self-hosted, typo-tolerant. |
| Maps | **MapLibre GL JS + self-hosted Protomaps (PMTiles) + PostGIS** | Works offline, no API fees, data stays on our server (section 7). |
| Push notifications | **Web Push (VAPID)** | Works in installed PWAs on Android and iPhone. |
| Analytics | **Umami or Plausible (self-hosted)** | Data stays on our server (section 11). |
| Server | **Docker Compose + Caddy** (automatic HTTPS), **restic** backups, **Uptime Kuma** + logs | Simple to run and rebuild on one machine; off-server backups (req. 6). |

### Considered and ruled out

| Option | Why not |
|---|---|
| Next.js | Server-side rendering we don't need for a login-only app; more load on one server. |
| Self-hosted Supabase | About a dozen extra services to run and patch on one campus server — heavy operations for a student team. |
| Firebase | Cannot be self-hosted; data leaves Kenya. |
| Django | Capable, but real-time chat is weaker than in Node. |
| Elixir / Phoenix | Best-in-class real-time, but niche — hard to hand over when the team graduates. |

### Build or adopt?

**HumHub** (open-source, self-hosted private social network for organisations, PHP) could run on campus in days. It does not fit our key features — reels, Today board, Ask a Senior, email-domain verification, campus map — without heavy changes, so **building is justified**. The team should still look at it and agree on this.

The hard parts (video pipeline, real-time chat, running our own server) are new to everyone whatever the stack.

### Security & encryption (DECIDED 12 Nov 2026: post-quantum where it matters)

Goal: everything Hatua sends is encrypted, private chats are **end-to-end encrypted**, and key exchange is **hybrid post-quantum** (a classical algorithm plus ML-KEM, NIST FIPS 203), so traffic recorded today can't be decrypted by a future quantum computer ("harvest now, decrypt later").

| Layer | What | Post-quantum how | When |
|---|---|---|---|
| **Every connection** (app ↔ server, all features) | TLS 1.3 only, HSTS | Hybrid key exchange **X25519MLKEM768**. Caddy built on Go 1.24+ offers it by default; current Chrome, Edge and Firefox use it automatically; older browsers fall back to X25519. Verify on the live server in the week-4 security check | v0.1 |
| **Private chats (1-to-1, later group chats)** | **End-to-end encrypted**: only the two phones hold the keys; the server relays ciphertext | Hybrid PQ key agreement (X25519 + ML-KEM-768) for session setup, then a double ratchet (AES-256, forward secrecy). **Use a proven library, never our own crypto:** first choice **libsignal** (Signal's PQXDH; licence AGPL-3.0, so our code must stay open source); alternative **MLS (RFC 9420)** via OpenMLS (MIT) with a hybrid PQ ciphersuite | v0.2, after an external review |
| **Posts, groups, stories, reels, Ask a Senior** | **Not end-to-end** (shared with many people; the server must show them and moderators must review them). Encrypted in transit (above) and at rest | At rest: AES-256 (symmetric 256-bit keys are already considered quantum-safe) | v0.1 |
| **Data at rest** | Encrypted disks/volumes on the VM, MinIO server-side encryption, encrypted database backups (restic, AES-256), secrets never in Git | AES-256 | v0.1 |
| **Sessions and sign-in codes** | Short-lived tokens, codes hashed, rate limits | n/a (no long-term secret to harvest) | v0.1 |

Rules and consequences for the team:
- **No home-made cryptography.** Only audited libraries; one person owns key management; a security review before chat ships.
- **Keys live on the device.** A PWA stores keys in the browser; clearing site data loses chat history. Offer an **encrypted key backup** protected by a passphrase the server never sees, and show a "safety number" to verify contacts.
- **Moderation with E2E:** the server can't read chats, so safety relies on **reporting** (the reporter's device sends the messages, with a franking tag) and on metadata limits (rate limits, message requests from strangers, under-18 defaults). The team accepts this trade-off.
- **Email sign-in codes** travel over email, which we don't control; codes are single-use and expire in 10 minutes.
- **Honest labels:** call chats "end-to-end encrypted" only once E2E is actually shipped; until then say "encrypted in transit and at rest".

### Operations (must have before launch)

- **Nightly backups off the server** (database + files) to a second location, encrypted, with a tested restore.
- **Power:** UPS/generator plan; who restarts the server out of hours.
- **Uplink:** off-campus users (alumni, students at home) depend on the university's internet link; reels may need a quality cap or a CDN for video.
- **Security:** isolated VM/network segment, only ports 80/443 exposed, regular patching, admin access limited and logged.
- **Continuity:** handover plan and runbook when the founding team graduates.

## 13. Draft data model (starting point, refine as needed)

- users — id, name, email, member_type (fresher | continuing | alumni | staff), course, year_of_study, graduation_year, verified, verified_method, is_under_18, created_at
- roles — id, user_id, role (staff | student_leader | club_leader | moderator | admin), title, starts_at, ends_at
- office_accounts — id, name, type (department | office | student_council | club), verified, created_at
- office_members — office_id, user_id, role (owner | editor), starts_at, ends_at
- follows — follower_id, followee_id (user or office), created_at
- groups — id, name, description, visibility (public | private), student_only, auto_type (course_year | none), created_by, created_at
- group_members — group_id, user_id, role (admin | member), status (pending | active), joined_at
- posts — id, author_user_id, author_office_id (nullable), group_id (nullable), body, media_url, media_type (image | video), is_reel, created_at
- announcements — id, office_id, title, body, urgency (urgent | normal), pinned_until, created_at
- questions — id, user_id, hide_name, body, created_at (Ask a Senior); answers — id, question_id, user_id, body, created_at
- comments — id, post_id, user_id, body, created_at
- likes — user_id, post_id, created_at
- conversations — id, user_a_id, user_b_id, status (request | active | blocked), created_at
- messages — id, conversation_id, sender_id, body, media_url, created_at, read_at
- blocks — blocker_id, blocked_id, created_at
- places — id, name, category, description, lat, lng, opening_hours, building, created_by, verified
- emergency_alerts — id, user_id, message, lat, lng (optional, only if the user shares it), status, created_at
- ads — id, category (job | course | product), advertiser_name, title, body, media_url, link, target (member types, courses, years), start_date, end_date, status
- ad_events — id, ad_id, type (view | click), created_at
- reports — id, reporter_id, target_type, target_id, reason, status

## 14. Design reference

Mobile-first, one column, big tap targets. Bottom nav: Home, Discover, + (create), Reels, Profile (in v0.1 the Reels tab shows a "Coming soon" screen). Discover holds search, Groups, Ask a Senior, Events, Market. Today board = story circles at the top of Home (office accounts). Feed and profile follow Instagram patterns, reels follow TikTok, groups/events/market follow Facebook, camera and chat follow Snapchat — patterns only, own look. Emergency button reachable from the menu. Clearly labelled sponsored cards. Badges for Staff / Student Leader / Official / Club. Colours: violet #6A3DF5 (primary), coral #FF3D71 (likes, alerts), sunshine #FFC83D (highlights), mint #14C8A8, ink #111018. Fonts: Space Grotesk (headings), Inter (body). Screens: Hatua design canvas (Claude artifact).

**User-centred design (DECIDED 12 Nov):** real users are involved every week before the 6 Dec feature freeze — interviews and an anonymous form (week 0), canvas tests (week 1), sign-up/feed tests on real phones (week 2), a beta group (week 3), then the pilot. Findings become `user-feedback` issues. Plan: ROADMAP.md "User involvement"; materials: `docs/research/`.

## 15. Launch plan

1. Get university approval (ICT for hosting; administration for name/logo and office accounts).
2. Mapping day: add campus and Marimanti/Gatunga/Mukothima places to OSM and our places database.
3. Launch at Tharaka University; seed with IEEE and ISACA members, class reps, student council, club leaders and freshers; onboard key offices (registrar, library, dean of students, security).
4. Invite alumni through clubs and alumni networks.
5. Sell first job, course and product ads in person (Marimanti businesses, colleges, employers).
6. Approach bigger advertisers once real numbers exist.

## 16. Open questions for the team

- Final name and domain (e.g. a tharaka.ac.ke subdomain or our own).
- Alumni verification: do students keep their student.tharaka.ac.ke email after graduation? (See section 5.)
- Server details: CPU, RAM, disk (SSD/HDD), OS, whole machine or VM, public IP/port forwarding, bandwidth, who has access, ICT approval.
- Tech stack (section 12): challenge each row, then mark DECIDED. Build vs adopt (HumHub).
- ~~Reels in MVP or second release~~ **DECIDED 12 Nov:** not built in v0.1. The Reels tab stays in the bottom nav and opens a "Coming soon" screen (short line on what Reels will be, no fake content, no upload).
- Who moderates, and response time (especially for urgent/emergency reports).
- Ad prices and how advertisers pay (outside the app).

## 17. Roadmap

Milestones, weekly tasks per person and the 20 Dec launch plan live in **ROADMAP.md**. Weekly briefing: Sundays 8:00 pm.

## 18. Team meeting agenda — 11 Nov 2026 (afternoon)

Goal: agree the open questions above, not add features.

1. **Walk-through of the brief (10 min)** — sections 1–4; Peter and Kim push back.
2. **Verification (section 5)** — DECIDED: one-time code to a tharaka.ac.ke / student.tharaka.ac.ke email. Discuss how alumni verify.
3. **MVP cut** — proposed first release: accounts & verification, feed, groups, one-to-one chat, Today board, Ask a Senior. Later: reels, campus map, ads, emergency button (or keep emergency in v1?).
4. **Tech stack (section 12)** — go through the table row by row; agree or propose a better fit with a reason.
5. **Server** — who asks university ICT for server details (section 16) and written approval? Ask about an ERP verification link in the same meeting.
6. **Team roles** — who owns frontend, backend, server/ops, and university liaison.
7. **Name and domain** — keep "Hatua"? tharaka.ac.ke subdomain or our own domain?
8. **Next steps** — owners and dates for each decision; set up git access for everyone.

Decisions from the meeting: _(record here and mark DECIDED in the relevant section)_
