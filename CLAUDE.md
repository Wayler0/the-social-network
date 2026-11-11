# Project Brief: Hatua — Campus Social Network ("Local Facebook")

Working name "Hatua" (Swahili: "step") is a placeholder.
Read this whole brief before writing code. Ask the team before changing any decision marked DECIDED.

## 1. What we're building

A local, campus-centred social network for Kenya, starting at Tharaka University (Marimanti, Tharaka Nithi).
Think "local Facebook": people connect with others in their area and campus, and the platform is also useful (Q&A, marketplace, events, jobs, student tools), so it beats WhatsApp groups.

**DECIDED:** social network is the core. Tools and jobs are features inside it, not separate sites.

## 2. Who it's for (users)

One journey, three stages — a user picks their stage at sign-up and can change it later:
1. Joining tertiary — KCSE leavers (KUCCPS, HELB, choosing courses and campuses).
2. Tertiary students — at a university or college.
3. Job seekers — students and graduates looking for attachments, internships, part-time and full-time work.

**DECIDED:** location is by area (town / county) for everyone. Campus is an optional extra for students. (A campus-only picker does not work for KCSE leavers or job seekers.)

## 3. Who pays (customers)

- Local businesses near campuses (ads) — e.g. driving schools, eateries, cyber cafés, hostels.
- Employers (featured job posts, casual job posts).
- Landlords / hostels (listings).
- Colleges, training centres, course providers (reach school leavers).
- Users (small premium features, e.g. CV boost) — paid via M-Pesa.
- Google AdSense as a background bonus only (Kenyan traffic pays low RPM, roughly $0.50–$2).

## 4. MVP features (build in this order)

1. Accounts & profiles — sign up (phone or email), stage, area, optional campus, profile photo, delete-account option.
2. Area/campus feed — posts (text + image), likes, comments, report button.
3. Campus Q&A — questions with answers that stay searchable (e.g. "Which hostel near campus has water?").
4. Comrade marketplace — buy/sell listings (books, phones, furniture), hostel room swaps.
5. Events board — club and campus events (IEEE, ISACA, freshers, etc.).
6. Jobs near me — employers post jobs tagged with location; filters: attachment, internship, part-time, casual, full-time; featured slot at top.
7. Search — across posts, Q&A, listings, jobs, events. Search terms drive contextual ads.
8. Ads system — see section 5.

Later (not MVP): unit/course groups with notes and past papers, reviews of hostels/eateries/landlords, KUCCPS course checker, HELB guide, CV builder, direct messaging.

## 5. Ads system

- Targeting (in order of priority):
  1. Contextual — match ad keywords to what the user searches or views (e.g. search "Tharaka University" → Tharaka Driving School ad).
  2. User's chosen area / campus.
  3. Approximate location from IP (rough town/county).
  4. Precise GPS — opt-in only ("Show deals near me" button). Never track in the background.
- Self-serve ad page: business picks area(s), uploads image + text, sets dates, pays with M-Pesa (Daraja API), ad goes live after admin approval.
- Labels: every ad clearly marked "Sponsored".
- Reporting: log every ad view and click in our own database (ad blockers can block GA4), so each advertiser gets a report: views, clicks, by area and date.

## 6. Trust & safety (non-negotiable)

- Report button on every post, comment, listing, job and profile; admin moderation queue.
- Jobs: verify employers; ban any listing that asks applicants to pay. Show the banner "Verified employers only. Never pay anyone to apply."
- Under-18 users exist (some KCSE leavers are 17): no private messaging between strangers for under-18s, safer defaults, age-appropriate content.
- Rules page / community guidelines; ability to suspend accounts.

## 7. Privacy & legal (Kenya)

- Kenya Data Protection Act 2019: clear consent, privacy policy, cookie notice, account + data deletion.
- Location is personal data — collect the minimum, precise location only with opt-in consent.
- Check registration requirements with the Office of the Data Protection Commissioner (ODPC) before launch.
- (Team to confirm details with ODPC — not legal advice.)

## 8. Analytics

- Google Analytics 4 on every page + Google Search Console.
- Custom events: ad_view, ad_click (with ad_id, area), post_create, job_apply, signup (with stage).
- Goal: produce a media kit with real monthly numbers for big advertisers later.

## 9. Suggested tech stack (confirm with team before starting)

- Hosting: Render (team already uses it) — web service + Render Postgres.
- App: a full-stack TypeScript framework (e.g. Next.js) with an ORM (e.g. Prisma) — suggestion only.
- Images: object storage (e.g. S3-compatible / Cloudinary) — suggestion only.
- Payments: M-Pesa Daraja API (STK Push).
- Mobile-first, works well on slow data and cheap Android phones.

## 10. Draft data model (starting point, refine as needed)

- users — id, name, phone/email, stage (joining | student | job_seeker), area_id, campus_id (nullable), is_under_18, created_at
- areas — id, town, county
- campuses — id, name, area_id
- posts — id, user_id, area_id, campus_id, type (post | question | listing | event), body, image_url, created_at
- comments — id, post_id, user_id, body, created_at
- jobs — id, employer_id, title, type, area_id, salary_text, is_featured, status, created_at
- employers — id, name, verified, contact
- ads — id, advertiser_id, title, body, image_url, keywords[], area_ids[], start_date, end_date, status
- ad_events — id, ad_id, type (view | click), area_id, created_at
- payments — id, payer, amount_kes, mpesa_receipt, purpose, status, created_at
- reports — id, reporter_id, target_type, target_id, reason, status

## 11. Design reference

Two mobile screens (Home, Jobs near me) were mocked up: one column, big tap targets, bottom nav (Home, Jobs, Campus, Tools, Profile), area chip at the top, search bar, journey buttons (Joining campus / At campus / Job hunting), clearly labelled sponsored cards. Accent colour: green #0A7B54.

## 12. Launch plan

1. Launch at Tharaka University only; seed with IEEE and ISACA student members, class reps, freshers.
2. Sell first ads in person to businesses in Marimanti.
3. Add self-serve ads + campus ambassadors (commission) to grow to new areas.
4. Approach big advertisers (colleges, banks/saccos, telcos) once real traffic numbers exist.

## 13. Open questions for the team

- Final name and domain.
- Exact tech stack.
- Sign-up method (phone OTP vs email).
- Who moderates, and response time.
- Ad prices (placeholder: e.g. KSh 500/week to test).
