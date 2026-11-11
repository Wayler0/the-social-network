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

Everything runs in **Docker Compose** so it is easy to rebuild or move.

- **App:** Next.js (TypeScript), set up as a PWA.
- **Database:** PostgreSQL. Full-text search in Postgres to start.
- **Auth, realtime chat, storage API:** self-hosted Supabase (preferred), or an auth library + Socket.IO + Redis.
- **Files (images, video):** MinIO (S3-compatible) on the server's disks.
- **Reels:** background worker using ffmpeg to transcode uploads into small HLS renditions for cheap phones. Cap length and file size.
- **Maps:** MapLibre GL JS + self-hosted Protomaps file.
- **Web server / HTTPS:** Caddy (or Nginx) with Let's Encrypt.
- **Push notifications:** Web Push.
- **Monitoring:** Uptime Kuma + logs/metrics (e.g. Grafana).

Operations (must have before launch):
- **Nightly backups off the server** (database + files) to a second location, encrypted, with a tested restore.
- **Power:** UPS/generator plan; who restarts the server out of hours.
- **Uplink:** off-campus users (alumni, students at home) depend on the university's internet link; reels may need a quality cap or a CDN for video.
- **Security:** isolated VM/network segment, only ports 80/443 exposed, regular patching, admin access limited and logged.
- **Continuity:** handover plan when the founding team graduates.

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

Mobile-first, one column, big tap targets. Bottom nav: Home, Reels, Groups, Chat, Profile. Search bar at top (people, posts, places). Today board at the top of Home on first open each day. Emergency button reachable from the menu. Clearly labelled sponsored cards. Badges for Staff / Student Leader / Official. Accent colour: green #0A7B54.

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
- Self-hosted Supabase vs plain Postgres + auth library + Socket.IO.
- Reels in MVP or second release (bandwidth/storage).
- Who moderates, and response time (especially for urgent/emergency reports).
- Ad prices and how advertisers pay (outside the app).

## 17. Team meeting agenda — 11 Nov 2026 (afternoon)

Goal: agree the open questions above, not add features.

1. **Walk-through of the brief (10 min)** — sections 1–4; Peter and Kim push back.
2. **Verification (section 5)** — DECIDED: one-time code to a tharaka.ac.ke / student.tharaka.ac.ke email. Discuss how alumni verify.
3. **MVP cut** — proposed first release: accounts & verification, feed, groups, one-to-one chat, Today board, Ask a Senior. Later: reels, campus map, ads, emergency button (or keep emergency in v1?).
4. **Server** — who asks university ICT for server details (section 16) and written approval? Ask about an ERP verification link in the same meeting.
5. **Team roles** — who owns frontend, backend, server/ops, and university liaison.
6. **Name and domain** — keep "Hatua"? tharaka.ac.ke subdomain or our own domain?
7. **Next steps** — owners and dates for each decision; set up git access for everyone.

Decisions from the meeting: _(record here and mark DECIDED in the relevant section)_
