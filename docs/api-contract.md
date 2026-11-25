# API contract — v0.1

The agreement between the web app (Solomon) and the API (Kim, Peter), so both sides can build at the same time.
**Change it by pull request** and tell the other side; never change a shipped endpoint silently.

Status key: ✅ built · 🔨 in progress · ⬜ not started

| Area | Owner | Issues | Status |
|---|---|---|---|
| Health, campuses | — | — | ✅ |
| Auth (sign-in codes, sessions) | Kim | #17, #18, #19 | ✅ |
| Me / profile / delete account | Kim | #20, #21 | ✅ |
| Posts, comments, likes, feed | Kim | #22, #24 | ✅ |
| Report and block | Kim | #23 | ✅ |
| Image upload | Peter | #32 | ✅ |
| Groups | Kim | #25 | ✅ |
| Today board | Kim | #26 | ✅ |
| Ask a Senior | Kim | #27 | ✅ |
| Admin | Peter | #37 | ✅ |

---

## 1. Conventions (apply to every endpoint)

- **Base path:** everything is under `/api`. In development Vite forwards `/api` from `:5180` to the API on `:3000`; on the server the existing web server does the same.
- **JSON** in and out, `Content-Type: application/json`, UTF-8. Field names are `camelCase` in JSON, `snake_case` in the database.
- **IDs** are UUID strings. **Times** are ISO 8601 UTC strings (`2026-11-14T08:30:00.000Z`).
- **Validation** with zod on every request body and query. Unknown fields are rejected (`.strict()`).
- **Auth:** a session cookie (section 3). Every endpoint except those marked *public* returns `401` without a valid session.
- **Errors** always have this shape (the web app shows `message` to the user):

  ```json
  { "error": "code_wrong", "message": "That code is wrong or has expired." }
  ```

  | Status | When | `error` examples |
  |---|---|---|
  | 400 | Invalid input | `invalid_input`, `email_not_allowed`, `code_wrong` |
  | 401 | No or expired session | `not_signed_in` |
  | 403 | Signed in but not allowed (suspended, not admin, not a group member) | `forbidden`, `suspended` |
  | 404 | Not found **or not visible to you** (don't reveal hidden things exist) | `not_found` |
  | 409 | Conflict | `member_number_taken`, `already_member` |
  | 413 | Upload too big | `too_large` |
  | 429 | Rate limited; include `Retry-After` header and `retryAfterSeconds` in the body | `rate_limited` |
  | 500 | Bug | `internal` (never leak stack traces) |
  | 503 | A service we depend on is down; safe to try again | `email_unavailable` |

- **Pagination** (cursor-based, newest first):
  request `?limit=20&cursor=<opaque>` (limit 1–50, default 20);
  response `{ "items": [...], "nextCursor": "<opaque>" | null }`.
  The cursor encodes `(created_at, id)` of the last item — never use `OFFSET`.
- **Campus scoping:** every read is filtered by the signed-in member's `campus_id`. Members never see another campus's content (CLAUDE.md, Positioning).
- **Privacy:** `email` and `memberNumber` are returned **only** by `GET /api/me` (to the member) and admin endpoints. Never in posts, profiles, search or lists.
- **Blocks and hidden content** are filtered out of every list for the viewer, both ways.

---

## 2. Already built

### `GET /api/health` *(public)* ✅
`200 { "ok": true, "name": "Hatua", "db": "up" }` · `503 { "ok": false, "db": "down" }`

### `GET /api/campuses` *(public)* ✅
```json
{ "campuses": [{ "slug": "tharaka", "name": "Tharaka University",
  "emailDomains": { "student.tharaka.ac.ke": "student", "tharaka.ac.ke": "staff" },
  "regNumberPattern": "^[A-Z]{2,4}[0-9]/[0-9]{5}/[0-9]{2}$", "regNumberExample": "ABT5/09919/23" }] }
```
`regNumberPattern` (migration 017, columns on `campuses`) is a regular expression checked against the normalised registration number (upper-case, spaces and dashes removed) by `PATCH /api/me` for students and alumni; `null` means no format check. Staff numbers are never format-checked. A wrong format answers `400 invalid_input` with the example in the message.

---

## 3. Auth — Kim starts here (issues #17, #18, #19)

Sign-in and sign-up are **the same flow**: request a code, enter it. A new email creates an account; a known email signs in. The web screens already call these two endpoints with exactly these shapes (`apps/web/src/lib/api.ts`).

### Tables (migration `002_users_sessions.sql` ✅, CLAUDE.md section 13)
`users` (at least: `id, campus_id, email, member_type, name, member_number, member_number_normalised, member_number_status, course, year_of_study, graduation_year, is_under_18, verified, verified_method, suspended_at, created_at, deleted_at`), `auth_codes`, `sessions`.
Written for #30. Rate limits use the `rate_limit_events` table (one row per counted event). Further columns come as new migrations (003_…), never by editing 002.

### `POST /api/auth/request-code` *(public)* ✅
Code: `apps/api/src/auth/`. Needs `CODE_PEPPER` on the server (`openssl rand -base64 48`); the API refuses to start in production without it.

```json
{ "email": "abc.123@student.tharaka.ac.ke" }
```
`200 { "resendAfterSeconds": 30 }`

1. Trim and lower-case the email. Look up the domain **exactly** in `campus_email_domains` (no `endsWith` — look-alikes like `tharaka.ac.ke.evil.com` must fail). Unknown domain → `400 email_not_allowed`.
2. Rate limits (store in Postgres — there is no Redis):
   - same email: 1 code per 30 s, 5 per hour → `429`
   - same IP: 300 per hour → `429` (high on purpose: campus Wi-Fi and mobile carriers put hundreds of members behind one address; the per-email limits stop guessing). The client address is read through `TRUST_PROXY_HOPS` proxies only, so a made-up `X-Forwarded-For` does not count
3. Generate a 6-digit code with `crypto.randomInt(0, 1_000_000)`, zero-padded. **Never** `Math.random`.
4. Store only its hash: `code_hash = HMAC-SHA256(CODE_PEPPER, email + ':' + code)` (`CODE_PEPPER` is a new env var). Expires in **10 minutes**. A new code invalidates older unused codes for that email.
5. Send the email with `app.mailer` (Peter's #35 ✅, `docs/email.md`):
   ```ts
   import { EmailError } from '../email/mailer.js';
   try { await app.mailer.sendSignInCode(email, code); }
   catch (err) {
     if (err instanceof EmailError) return reply.code(503).send({ error: 'email_unavailable', message: "We couldn't send your code. Please try again in a few minutes." });
     throw err;
   }
   ```
   In development (`EMAIL_MODE=log`, the default) the code is printed to the API console instead of sent. In production
   `log` mode refuses to send and never prints a code. **Never log the code yourself.** If sending fails, delete or
   consume the code row you just stored, so a code that never arrived cannot be used.
6. Always answer the same way whether or not the email already has an account (don't reveal who is a member).

### `POST /api/auth/verify-code` *(public)* ✅
New students start as `memberType: "continuing"` and pick fresher/continuing/alumni in onboarding. A suspended member gets `403 suspended` and no session.

```json
{ "email": "abc.123@student.tharaka.ac.ke", "code": "482913" }
```
`200 { "newUser": true }` and sets the session cookie.

1. Find the newest unconsumed, unexpired code for the email. Compare hashes with `crypto.timingSafeEqual`.
2. Wrong code → increment `attempts`; at **5** attempts the code is dead. Reply `400 code_wrong` with message "That code is wrong or has expired." (same message for wrong, expired and dead — don't help guessing).
3. Right code → mark it consumed (in the same transaction, so it can't be used twice).
4. No user with that email → create one: `campus_id` and `member_type` from the domain, `verified = true`, `verified_method = 'email_code'`, profile fields empty. `newUser: true`.
   Existing user → `newUser: false`. If `deleted_at` is set, treat as new (the old account stays deleted).
5. Create a session: random 32-byte token (`crypto.randomBytes(32).toString('base64url')`), store **only** `sha256(token)` as `token_hash`, expires in **180 days**, moved forward each day the session is used (members sign in once per device; changed 25 Nov 2026 from 30 days).
6. Set the cookie:
   `hatua_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=15552000`
   (`Secure` off only when `NODE_ENV=development`; read the cookie name from config, not the app name in code).
7. Rate limit: 200 verify attempts per IP per 10 minutes → `429` (see above: shared addresses).

### `POST /api/auth/logout` ✅
Revokes the current session (`revoked_at = now()`), clears the cookie. `204`.

### `POST /api/auth/logout-all` ✅
Revokes all of the member's sessions. `204`.

### Session check (every protected route) ✅
Code: `apps/api/src/auth/session-check.ts`. Every route is protected unless it says `{ config: { public: true } }`. Handlers read the member from `req.auth` (`{ userId, campusId, sessionId }`); Peter's `requireUser(req)` keeps working. Suspended members can still reach routes marked `allowSuspended` (logout).
A Fastify `preHandler` that reads the cookie, looks up `sha256(token)`, and rejects if missing, revoked, expired, or the user is deleted (`401`) or suspended (`403 suspended`). Extend `expires_at` (sliding) at most once a day, and update `last_seen_at` at most once every 5 minutes, to save writes.

### `GET /api/me`
```json
{
  "id": "…", "campus": { "slug": "tharaka", "name": "Tharaka University" },
  "email": "abc.123@student.tharaka.ac.ke",
  "memberType": "continuing",
  "name": null, "photoUrl": null, "course": null, "yearOfStudy": null, "graduationYear": null,
  "memberNumber": null, "memberNumberStatus": "unverified",
  "isUnder18": null, "interests": [], "badges": [], "isAdmin": false,
  "profileComplete": false
}
```
`profileComplete` is true once `name` and `memberType` are set, `isUnder18` is answered, staff have a `memberNumber` (staff number), and (students) `yearOfStudy` or (alumni) `graduationYear` is set. The registration number is **optional** for students and alumni (decided 25 Nov 2026): `PATCH /api/me` with `memberNumber: ""` or `null` removes it (staff get `400`). It is also false while `memberNumberNeedsFix` is true: a student's or alumnus's saved reg number doesn't match the campus format (`regNumberPattern`, migration 017), e.g. one saved before the check existed. The web app then shows "Update your registration number". The web app sends incomplete profiles to the onboarding screen; other protected endpoints (posting, joining groups) return `403 profile_incomplete` until it is complete.

### Done when (#17–#19)
- [ ] Tests (vitest + `app.inject`) for: allowed and look-alike domains, rate limits, wrong/expired/reused code, 5-attempt lockout, cookie flags, logout, logout-all, suspended user.
- [ ] Web app works against the real API with `VITE_API_MOCK=false`.
- [ ] No code or token is ever stored or logged in plain text in production.

---

## 4. Me and profile (#20, #21)

### `GET /api/me` ✅ · `PATCH /api/me` ✅ — onboarding and edit profile
```json
{ "name": "Wanjiru M.", "memberType": "fresher", "course": "BSc Computer Science",
  "yearOfStudy": 1, "memberNumber": "ABT5/09919/23", "isUnder18": false, "interests": ["Football", "Web development"] }
```
All fields optional; send only what changes. `200` with the same body as `GET /api/me`.
- `memberType`: students choose `fresher | continuing | alumni`; staff are always `staff`.
- `memberNumber`: normalise (upper-case, remove spaces and `-`, keep `/`), check format, unique per campus → `409 member_number_taken` (the screen offers the "someone has my reg number" dispute).
- `isUnder18` sets safer defaults (CLAUDE.md section 6).
- `interests`: replaces the whole list; up to 10, each up to 40 characters; spaces tidied, duplicates (ignoring case) dropped. Shown on the public profile. Migration 010.
- `photoImageId`: the `imageId` from `POST /api/images` sets the profile photo (`photoUrl` is its 320 px thumbnail); `null` removes it. A replaced photo's files are deleted. Migration 008 adds `users.photo_image_id`.
- `yearOfStudy` is kept only for freshers and continuing students, `graduationYear` only for alumni; the other is cleared.
- A changed `memberNumber` goes back to `memberNumberStatus: "unverified"`.
- Routes that need a finished profile call `requireCompleteProfile(db, req, reply)` (`apps/api/src/me/routes.ts`).
- After saving, in the **same transaction**, put the member in the right class group (Peter's helper):
  ```ts
  import { syncClassGroup } from '../groups/class-groups.js';
  await syncClassGroup(client, user.id);   // → { groupId, created, left }
  ```
  It creates the class group if the member is the first of their class, joins them, and takes them out of their old
  one when course, year or member type changes. Staff, alumni and unfinished profiles get no class group.
  Call it from `DELETE /api/me` too (after setting `deleted_at`) so the account leaves its class group.

### `POST /api/me/member-number-dispute` ✅
`{ "memberNumber": "…", "details": "…" }` → `202 { received: true }`, the same whether or not anyone holds the number. Goes to the admin queue and marks an *unverified* holder `disputed`. `400` for your own number; 3 a day per member (`429`).

### Feedback ✅ (migration 021)

`GET /api/me` counts the different days (Nairobi time) a member opens the app and returns `askFeedback: true` from the **third day** until they answer.
- `POST /api/feedback` `{ rating: 1–5, body? (≤ 2000) }` → `201`; never asks again. 5 a day (`429`). Also reachable any time from Settings → Send feedback.
- `POST /api/feedback/later` → `204`: "Not now" asks again three active days later.
- `GET /api/admin/feedback?limit&cursor` (admins) → `{ count, average, items: [{ id, rating, body, createdAt }], nextCursor }`, newest first — **never who wrote it**, so members can be honest. Deleted with the account; in the data export. Code: `apps/api/src/feedback/routes.ts`.

### `GET /api/users/:id` ✅ — someone's public profile
`{ id, name, photoUrl, memberType, course, yearOfStudy, graduationYear, interests, badges, isFollowing, followsYou, followerCount, followingCount }` — **no** email or member number. `404` if blocked either way, deleted, or on another campus. Follows: section 12 (v0.2).

### `GET /api/me/export` ✅ — download my data (Data Protection Act)
A JSON file (`Content-Disposition: attachment`) of everything held about the member: profile (with email and member number), account dates and suspension, roles and offices (history too), groups, posts, comments, questions and answers (also deleted or hidden ones, which we still keep), likes, helpful votes, announcements they posted, people they blocked, reports and disputes they made, sessions, and uploaded images. **Not** included: reports about them (protects reporters) and who blocked them. Works while suspended; 5 a day (`429`). Code: `apps/api/src/me/export.ts` — add any new table that holds personal data there.

### `DELETE /api/me` ✅ — delete account
`{ "confirm": "DELETE" }` → `204`, cookie cleared. Works for suspended members too.
- **Removed:** email, name, photo, course, years, member number, under-18 answer, interests; every image they uploaded (profile and post photos, files included); sessions (signed out everywhere), sign-in codes, likes, helpful votes, blocks, group memberships. Roles and office memberships are ended (rows kept as history).
- **Kept, shown as "Deleted member":** posts, comments, questions, answers; reports and the admin log (moderation needs them).
- The email and member number are free again; signing up with that email makes a new account.

---

## 5. Feed, posts, comments, likes (#22, #24) ✅

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/feed` | `?limit&cursor` | page of **Post** — campus-wide posts plus announcements of clubs you follow or belong to (v0.2), newest first |
| `POST /api/posts` | `{ body, imageId?, groupId?, officeId?, announcement? }` (body 1–2000 chars after trimming; image from §6; `officeId` posts as an office you currently belong to; `announcement: true` only in a club, by its admins — `400` outside clubs, `403` for non-admins) | `201` Post |
| `GET /api/posts/:id` | | Post |
| `DELETE /api/posts/:id` | author or admin | `204` |
| `GET /api/posts/:id/comments` | `?limit&cursor` (oldest first) | page of Comment |
| `POST /api/posts/:id/comments` | `{ body }` (1–1000 chars) | `201` Comment |
| `DELETE /api/comments/:id` | author, post author, or admin | `204` |
| `PUT /api/posts/:id/like` | | `200 { liked: true, likeCount }` (idempotent; v0.1 — the reaction "like", never replaces another reaction) |
| `DELETE /api/posts/:id/like` | | `200 { liked: false, likeCount }` |
| `PUT /api/posts/:id/reaction` | `{ reaction: "like"\|"love"\|"haha"\|"wow"\|"sad"\|"support" }` (v0.2) | `200 { myReaction, likeCount, reactions: { love: 3, … } }` — one per member per post; PUT changes it |
| `DELETE /api/posts/:id/reaction` | | `200 { myReaction: null, likeCount, reactions }` |
| `PUT /api/posts/:id/save` | | `200 { saved: true }` (idempotent; private to the member) |
| `DELETE /api/posts/:id/save` | | `200 { saved: false }` (works even if the post is now hidden) |
| `GET /api/me/saved` | `?limit&cursor` | page of **Post** — posts I saved, newest save first; ones I can no longer see are left out |
| `GET /api/users/:id/posts` | `?limit&cursor` | page of **Post** — that member's own posts (not office posts), newest first, including group posts only where the viewer is a member. `404` like `GET /api/users/:id` |

**Post**
```json
{ "id": "…", "author": { "id": "…", "name": "…", "photoUrl": null, "badges": ["Staff"] },
  "office": null, "group": { "id": "…", "name": "Chess Club", "kind": "club" }, "announcement": false,
  "body": "…", "image": { "url": "/media/…/1080.webp", "width": 1080, "height": 1350 } ,
  "likeCount": 12, "commentCount": 3, "likedByMe": false, "myReaction": null, "reactions": { "like": 9, "love": 3 },
  "savedByMe": false, "createdAt": "…" }
```
**Comment** `{ id, author, body, createdAt }`

Rules (code: `apps/api/src/posts/`):
- The feed is campus-wide posts only; group posts appear in their group (`GET /api/groups/:id/posts`).
- `office` is `{ id, name, photoUrl, verified }` or null; `group` is `{ id, name }` or null.
- An author who deleted their account shows as `{ "id": null, "name": "Deleted member", "photoUrl": null, "badges": [] }`.
- Posting and commenting need a finished profile (`403 profile_incomplete`). Limits: 20 posts and 60 comments per member per hour (`429`).
- Group posts: active members only (`403 forbidden`); clubs with `posting: "admins_only"` only by group admins. A group the member may not see is `404`.
- Deleting a post deletes its image too, unless a report about it is still open (moderators need the evidence).
- Anything the viewer may not see (hidden, deleted, blocked either way, group they are not in) is `404`, including for likes and comments.

---

## 6. Images (Peter, #32) ✅

### `POST /api/images`
`multipart/form-data`, one file field `file`, JPEG/PNG/WebP, max **8 MB** → `413 too_large`.
Server re-encodes to WebP (max 1080 px wide + a 320 px thumbnail), turns sideways phone photos the right way up,
**strips EXIF and location**, never enlarges, and saves to the media folder on disk (no MinIO in v0.1).
`201 { "imageId": "…", "url": "/media/2026/11/<uuid>/1080.webp", "width": 1080, "height": 1350 }`
The thumbnail is the same address ending `320.webp`.

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_input` | Not multipart, no `file` field, or an empty file |
| 400 | `invalid_image` | Not a JPEG/PNG/WebP (checked by content, not file name), or over 50 megapixels |
| 400 | `heic_not_supported` | iPhone HEIC photo — see note below |
| 413 | `too_large` | Over 8 MB |
| 429 | `rate_limited` | More than 30 upload attempts by one member in an hour (rejected files count too) |

**HEIC is not accepted in v0.1** (the image library's standard build cannot read it). On the web app use
`<input type="file" accept="image/jpeg,image/png,image/webp">` — iPhones then hand over a JPEG automatically.

An image not attached to a post or profile within 24 h is deleted (hourly job).

### `GET /media/<path>/1080.webp` and `…/320.webp`
Members only (`401` without a session), `image/webp`, cached by the browser for a year (the address never changes).
In development Vite forwards `/media` to the API; **on the server the web server must forward `/media` to the API too**, like `/api`.
The web server must also let request bodies of 8 MB through to `/api/images`: nginx stops at 1 MB by default
(`client_max_body_size 10m;`), which would reject most phone photos before they reach the API.

### Using an image from other endpoints (Kim)
```ts
import { attachImage, deleteImage } from './images/store.js';
// inside the transaction that saves the post (or the profile photo):
const image = await attachImage(client, imageId, user.id);   // null → 400 invalid_input
// image = { id, url, thumbUrl, width, height }  → Post.image is { url, width, height }
await deleteImage(db, config.MEDIA_DIR, imageId);             // when a post or account is deleted
```
`attachImage` returns null if the image does not exist, belongs to another member, or is already used.

### Session check hook
Protected routes get the member from `requireUser(req)` (`apps/api/src/guard.ts`). Until the session check
(#17–#19) is built it always answers "nobody", so these routes return `401`. Kim: pass yours in —
`buildApp(config, db, { requireUser })` — returning `{ id }` or `null`.

---

## 7. Report and block (#23) ✅

| Method & path | Body | Response |
|---|---|---|
| `POST /api/reports` | `{ targetType: "post"\|"comment"\|"user"\|"group"\|"question"\|"answer", targetId, reason: "spam"\|"harassment"\|"hate"\|"nudity"\|"violence"\|"self_harm"\|"false_info"\|"other", details? }` | `202` |
| `PUT /api/users/:id/block` | | `204` |
| `DELETE /api/users/:id/block` | | `204` |
| `GET /api/me/blocks` | | `{ items: [{ id, name }] }` |

3 open reports from different members on the same item **auto-hide** it until an admin reviews it (posts, comments, questions, answers; `hidden_by` stays null to mark it as hidden by reports). People and groups are never auto-hidden.

Rules (code: `apps/api/src/safety/`):
- Members report only what they can see; anything else is `404`. A person can be reported after being blocked. You cannot report or block yourself.
- Reporting the same item again while your report is open changes nothing (`202`). 20 reports per member per hour (`429`).
- `POST /api/reports` answers `202 { "received": true }`. Block and unblock are idempotent.

---

## 8. Groups (#25) ✅

| Method & path | Notes |
|---|---|
| `GET /api/groups?mine=true&limit&cursor` | Discover list, or only mine |
| `POST /api/groups` | `{ name, description, visibility: "public"\|"private", studentOnly }` |
| `GET /api/groups/:id` | Group (private groups show name and description only to non-members) |
| `PUT /api/groups/:id/membership` | Join (public) or request (private) → `{ status: "active"\|"pending" }` |
| `DELETE /api/groups/:id/membership` | Leave |
| `GET /api/groups/:id/requests` | Admins: pending requests |
| `POST /api/groups/:id/requests/:userId` | Admins: `{ approve: true\|false }` |
| `GET /api/groups/:id/posts?channel=all\|announcements\|discussion&limit&cursor` | Members see every post (`channel` picks the tab). Anyone who may see a **public club** reads its announcements (`channel=all` gives them announcements only; `discussion` is `403`). Other groups: members only |
| `GET /api/groups/:id/members?limit&cursor` | Active members only: `{ items: [{ id, name, photoUrl, memberType, role, joinedAt }] }`, longest-standing first |
| `PUT /api/groups/:id/members/:userId/role` | Admins: `{ role: "admin"\|"member" }` → `{ role }`. `409 last_admin` if it would leave no admin |
| `DELETE /api/groups/:id/members/:userId` | Admins remove a member → `204`. Not other admins (demote first), not in class groups |

Posting into a group uses `POST /api/posts` with `groupId`; if the group's `posting` is `admins_only` (clubs), non-admins get `403`. Course/year groups are created and joined automatically from the profile (`syncClassGroup`, section 4): one private group per course and year per campus, named `<course> — Year <n>`. Course names match ignoring case and extra spaces, but "BSc CS" and "BSc Computer Science" are different courses — the profile screen should offer a fixed list.

**Group** `{ id, name, description, visibility, studentOnly, kind: "group"|"club", clubVerified, posting, isClassGroup, memberCount, myStatus: "none"|"pending"|"active", myRole: "member"|"admin"|null, canFollow, following, followerCount }` — `canFollow` only for public clubs (v0.2, section 12); `followerCount` is `null` otherwise

Rules (code: `apps/api/src/groups/routes.ts`):
- `memberCount` is `null` for a private group you are not in. `isClassGroup` is true for the automatic course/year groups.
- Discover (`GET /api/groups`) leaves out other people's class groups; `mine=true` lists groups you are in or asked to join.
- `POST /api/groups` body: `{ name, description?, visibility, studentOnly? }`; the creator becomes its admin. Only freshers and continuing students may set `studentOnly`. Finished profile needed; 5 groups a day.
- `PUT …/membership` answers `{ status }` and changes nothing if you are already in or waiting. Class groups cannot be joined or left by hand (`403`).
- When the last admin leaves or deletes their account, the longest-standing member becomes admin.
- `GET …/requests` answers `{ items: [{ id, name, photoUrl, memberType, requestedAt }] }`, oldest first. `POST …/requests/:userId` answers `{ status: "active" | "none" }`; `404` if there is no such request.
- `GET …/posts`: `403` if you are not an active member, `404` if you cannot see the group.

---

## 9. Today board (#26) ✅

| Method & path | Notes |
|---|---|
| `GET /api/announcements?limit&cursor` | First page: every current pin (urgent first, then newest), then unpinned newest first. Later pages: unpinned only |
| `POST /api/announcements` | Current owners/editors of a **verified** office: `{ officeId, title, body, urgency: "normal"\|"urgent", pinnedUntil? }` → `201` Announcement |
| `DELETE /api/announcements/:id` | Office owner or admin → `204` |
| `GET /api/me/offices` | Offices the member can post for: `{ items: [{ id, name, photoUrl, verified, role: "owner"\|"editor" }] }` |

**Announcement** `{ id, office: { id, name, photoUrl, verified }, title, body, urgency, pinned, pinnedUntil, createdAt }` — who typed it is not shown.

Rules (code: `apps/api/src/announcements/`):
- `pinnedUntil` must be in the future and at most 14 days ahead. After it passes, the announcement drops into the unpinned list.
- At most **5 normal pinned** announcements per campus at once → `409 pin_limit`. Urgent ones are never blocked by the limit.
- The web app shows `urgent` pins always, and lets members collapse `normal` ones (CLAUDE.md section 4.7).
- 10 announcements per office per day (`429`). Title 1–140 characters, body 1–5000.

---

## 10. Ask a Senior (#27) ✅

| Method & path | Notes |
|---|---|
| `GET /api/questions?q&limit&cursor` | Newest first. `q` (2–200 chars) searches questions **and their answers** (English stemming: "registering" finds "register") |
| `POST /api/questions` | `{ body, hideName? }` → `201` Question. Finished profile; 10 an hour |
| `GET /api/questions/:id` | Question plus `answers` (most helpful first, then oldest; up to 200) |
| `POST /api/questions/:id/answers` | `{ body }` (1–5000 chars) → `201` Answer. Finished profile; 30 an hour |
| `DELETE /api/questions/:id` · `DELETE /api/answers/:id` | The author or an admin → `204`. Kept as `deleted_at` (migration 009) for reports; a deleted question hides its answers. Someone else's: `403`, or `404` if you cannot see it |
| `PUT /api/answers/:id/helpful` / `DELETE …` | Toggle "helpful" → `{ helpful, helpfulCount }`; idempotent; not on your own answer (`400`) |

**Question** `{ id, body, author, nameHidden, isMine, answerCount, createdAt }`
**Answer** `{ id, body, author, byAsker, isMine, helpfulCount, helpfulByMe, createdAt }`

- **Hidden names:** with `hideName: true`, `author` is `null` for every member except the asker, **moderators and admins** (staff and alumni included, CLAUDE.md section 4.5). The same applies to answers the anonymous asker writes on their own question (`byAsker: true`), so they cannot give themselves away.
- Hidden questions and answers, and those between members who blocked each other, are left out (`404` for a question).

---

## 11. Admin (Peter, #37) ✅

Code: `apps/api/src/admin/`. Everything is limited to the staff member's own campus (anything else is `404`).
`401` without a session; `403 forbidden` without the role.

- **Moderators** (role `moderator`): the report queue and hiding content.
- **Admins** (role `admin`): everything.
- A role counts only while it is in force, and never for a suspended or deleted account.
- **The first admin** of a campus is made on the server, after that person has signed in once:
  `docker compose --profile server exec api node dist/admin/grant-admin.js <email>`
  (development: `npm run admin:grant -w apps/api -- <email>`).

### Moderation (moderators and admins)

| Method & path | Notes |
|---|---|
| `GET /api/admin/reports?status=open\|hidden\|dismissed&limit&cursor` | Open reports oldest first (a queue); closed ones newest first. Each item: `{ id, targetType, targetId, reason, details, status, createdAt, resolvedAt, reporter, resolvedBy, reportCount, target }`. `target` is the reported item as it is now (`body`, `author`, `hiddenAt`, `autoHidden`, … or a member's/group's name), or `null` if it no longer exists |
| `POST /api/admin/reports/:id/resolve` | `{ action: "hide"\|"dismiss" }` → `{ status, resolved }`. Decides **every** open report on the same item. `dismiss` also lifts an automatic hide. `hide` is for posts, comments, questions and answers only (`400` for members and groups: suspend the member instead). `409 already_resolved` if done |
| `POST /api/admin/content/:type/:id/hide` | `type`: `post\|comment\|question\|answer`. Optional `{ reason }`. Closes open reports on the item → `{ hidden: true, resolved }` |
| `POST /api/admin/content/:type/:id/unhide` | → `{ hidden: false, resolved: 0 }` |

### Management (admins only)

| Method & path | Notes |
|---|---|
| `GET /api/admin/users?q=` | Find members by name, email or member number (2+ characters, max 20 results). Returns **AdminUser** |
| `POST /api/admin/users/:id/suspend` | `{ reason, until? }` — `until` is an ISO time in the future; leave it out for "until an admin lifts it". Signs the member out everywhere. Not yourself. → **AdminUser** |
| `POST /api/admin/users/:id/unsuspend` | → **AdminUser** |
| `POST /api/admin/users/:id/roles` | `{ role: "staff"\|"student_leader"\|"club_leader"\|"moderator"\|"admin", title?, endsAt? }` → `201` **AdminUser**. `staff` only for accounts that signed up with a staff email. `409 already_has_role` |
| `DELETE /api/admin/roles/:id` | Ends the role now (kept as history) → `204`. You cannot end your own admin role |
| `GET /api/admin/offices` | `{ items: [{ id, name, type, verified, createdAt, members: [{ id, name, role, since }] }] }` |
| `POST /api/admin/offices` | `{ name, type: "department"\|"office"\|"student_council"\|"club" }` → `201`. Offices made here are official (`verified`). `409 office_name_taken` |
| `POST /api/admin/offices/:id/members` | `{ userId, role: "owner"\|"editor" }` → `204`. Adds, changes the role, or brings someone back |
| `DELETE /api/admin/offices/:id/members/:userId` | Handover: the person leaves, the office and its history stay → `204` |
| `POST /api/admin/groups/:id/verify-club` / `…/unverify-club` | The CLUB badge → `{ clubVerified }`. Not for class groups |
| `GET /api/admin/disputes?status=open\|resolved` | `{ items: [{ id, memberNumber, details, status, createdAt, resolvedAt, reporter: { id, name, email }, holder: { id, name, email, memberSince } \| null }] }` |
| `POST /api/admin/disputes/:id/resolve` | `{ releaseNumber: true\|false }` → `{ status, numberReleased }`. `true` takes the number off the account holding it so its owner can claim it |
| `GET /api/admin/log?limit&cursor` | Who did what, newest first: `{ id, action, targetType, targetId, details, createdAt, by }` |

**AdminUser** `{ id, name, email, memberType, memberNumber, memberNumberStatus, course, yearOfStudy, graduationYear, isUnder18, verified, createdAt, deleted, suspended: { since, until, reason } | null, roles: [{ id, role, title, endsAt }] }` — includes email and member number; admin endpoints only.

Every action is written to `admin_log` (who, what, on what, when, and the reason where one is given).

### What other endpoints must respect (Kim)

- **Suspended** means `suspended_at is not null and (suspended_until is null or suspended_until > now())`. The session check should answer `403 suspended` for such a member.
- **Hidden** content has `hidden_at` set. `hidden_by is null` means the three-reports rule hid it (section 7): set `hidden_at = now()` and leave `hidden_by` empty when the third open report from a different member arrives.
- **Active role / office member** means `starts_at <= now() and (ends_at is null or ends_at > now())`. Use it for badges, `isAdmin`, and "office members only" in section 9.
- **Pagination** helper for all lists: `apps/api/src/paging.ts`. **Transactions:** `inTransaction(db, async (tx) => { … })` in `apps/api/src/db.ts`.

---

## 12. Follows (v0.2) ✅

Follow people, verified office accounts and public clubs. No approval step: privacy rules live on what followers get (stories, v0.2).

| Endpoint | Answer |
|---|---|
| `PUT /api/follows/:type/:id` | `type`: `user\|office\|group`. → `{ following: true, followerCount }`; idempotent; 200 an hour |
| `DELETE /api/follows/:type/:id` | → `{ following: false, followerCount }`; idempotent |
| `GET /api/me/following?type&limit&cursor` | `{ items: [{ type, id, name, photoUrl, since }] }`, newest first |
| `GET /api/me/followers?limit&cursor` | Members who follow me: `{ items: [{ id, name, photoUrl, followsBack, since }] }`, newest first |

Rules (code: `apps/api/src/follows/routes.ts`, table `follows`, migration 011):
- `404` unless the target is: another live member of your campus with no block either way; a **verified** office of your campus; a **public club** you may see (staff never see student-only groups). Ordinary and private groups are joined, not followed.
- Blocking ends follows both ways; deleting an account removes its follows (both ways). The hourly housekeeping removes follows whose target is gone or no longer followable (`target_id` is polymorphic: no foreign key).
- Counts leave out deleted accounts. Profiles (section 4) show `isFollowing`, `followsYou`, `followerCount`, `followingCount`; groups (section 8) show `canFollow`, `following`, `followerCount`.

---

### 12a. Who to follow ✅

`GET /api/suggestions` → `{ people: [{ id, name, photoUrl, memberType, course, yearOfStudy, badges, reason, mutualCount }], clubs: [{ id, name, description, clubVerified, followerCount }] }` — up to 20 people and 6 clubs, for the onboarding "follow classmates" step and "People in your course" on Discover. Code: `apps/api/src/suggestions/routes.ts`.

- People: live, verified, finished profiles on your campus that you don't follow, no block either way, not suspended. Ranked same class (students, same course and year) → same course → mutual follows → followers. Only people in your course, with mutual follows, or staff are suggested.
- **Privacy:** staff are never shown students (student-first rule). An **under-18** member is suggested only to their own classmates. `reason` is only "Same class", "Same course", "Staff" and/or "N mutual" — never where someone lives or anything else personal. No email or member number.
- Clubs: public clubs you may see and are neither in nor following; CLUB-badged first, then most followed.

## 13. Stories (v0.2) ✅

Photo or text, gone after 24 hours (CLAUDE.md section 4, "Stories / status").

| Endpoint | Answer |
|---|---|
| `GET /api/stories` | The stories row: `{ items: [{ author: { type: "user"\|"office"\|"group", id, name, photoUrl, badges }, isMine, allSeen, stories: [Story] }] }` — your own first, then official accounts, then clubs, then people; within each, unseen before seen, then newest. Stories oldest first |
| `POST /api/stories` | `{ body?, imageId?, audience?: "followers"\|"close_friends", officeId? \| groupId? }` → `201` Story. Photo or text needed (body up to 500). Finished profile; 30 a day |
| `POST /api/stories/:id/view` | Mark seen → `204` (idempotent; your own views are not counted) |
| `GET /api/stories/:id/viewers` | `{ count, items: [{ id, name, photoUrl, viewedAt }] }` — only whoever manages the story (author, office members, club admins); `403` otherwise |
| `DELETE /api/stories/:id` | Author, the office or club managing it, or an admin → `204` |
| `GET /api/me/close-friends` · `PUT\|DELETE …/:userId` | Close friends list (up to 200; `409 list_full`) |
| `GET /api/me/story-hidden` · `PUT\|DELETE …/:userId` | "Hide my stories from" list (up to 200) |

**Story** `{ id, body, image: { url, thumbUrl, width, height } | null, audience, createdAt, expiresAt, seen, viewCount? }` — `viewCount` only on stories you posted.

Who sees a story (`visibleStory` in `apps/api/src/visibility.ts`; anything else is `404`):
- **Personal:** your followers (section 12), except people you hide your stories from; close-friends stories only to your close friends. An **under-18** author's stories only reach people they follow back. **Staff** see a student's (fresher/continuing) story only if the student follows them.
- **Office** (posted by a current member of a **verified** office with `officeId`): everyone on the campus.
- **Club** (posted by a club admin with `groupId`; `kind = club`): the club's active members and followers.
- Never across a block, never once hidden, deleted or expired.

Reports: `POST /api/reports` takes `targetType: "story"`; three open reports hide it; moderators hide/unhide it like other content (`/api/admin/content/story/:id/hide`). Hourly housekeeping deletes expired or deleted stories with their views and photos, **except** stories with an open report, which stay for moderators until the report is closed. Replies to stories come with chat. Migration 012.

---

## 14. Events (v0.2) ✅

Events with Going / Interested. Places on the map come with v0.3; until then `location` is text.

| Endpoint | Answer |
|---|---|
| `GET /api/events?when=upcoming\|past&groupId&limit&cursor` | Upcoming (not yet ended) soonest first; past latest first |
| `GET /api/me/events?limit&cursor` | Upcoming events I am going to or interested in |
| `POST /api/events` | `{ title, description?, location?, startsAt, endsAt?, imageId?, officeId? \| groupId? }` → `201` Event. Not in the past, at most a year ahead. Finished profile; 10 a day |
| `GET /api/events/:id` | Event |
| `PATCH /api/events/:id` | Host only: `{ title?, description?, location?, startsAt?, endsAt?, cancelled? }` → Event |
| `DELETE /api/events/:id` | Host or admin → `204` |
| `PUT /api/events/:id/rsvp` | `{ status: "going"\|"interested" }` → `{ myRsvp, goingCount, interestedCount }`; `409 event_cancelled` / `event_over` |
| `DELETE /api/events/:id/rsvp` | → the same with `myRsvp: null` |
| `GET /api/events/:id/attendees?status=going\|interested&limit&cursor` | `{ items: [{ id, name, photoUrl, since }] }`, first to answer first |

**Event** `{ id, title, description, location, startsAt, endsAt, cancelled, createdBy, office, group: { id, name, kind } | null, image, goingCount, interestedCount, myRsvp, canManage, createdAt }`

Rules (code: `apps/api/src/events/routes.ts`, `visibleEvent` in `visibility.ts`, migration 015):
- **Hosts:** the creator, current members of the hosting office, or the group's admins (`canManage`). Anyone with a finished profile creates campus events; `officeId` needs current office membership; `groupId` needs active membership, and admin for clubs and "only admins post" groups.
- **Who sees:** campus events everyone on the campus; group events members only, except a **public club's** events, which anyone who may see the club sees. Never across a block with the creator; staff never see student-only groups.
- Cancelled events stay listed (`cancelled: true`) so people who planned to go find out.
- Reports take `targetType: "event"` (3 hide it; moderators see title and description). Deleting an account removes its RSVPs; events it created stay, like posts.

## 15. Notifications and push (v0.2) ✅

An in-app inbox plus Web Push (VAPID). The inbox always records; push follows each member's settings.

| Endpoint | Answer |
|---|---|
| `GET /api/notifications?limit&cursor` | `{ items: [Notification], unreadCount, nextCursor }`, newest first |
| `POST /api/notifications/read` | `{ ids: [...] }` (1–100) or `{ all: true }` → `{ unreadCount }` |
| `GET /api/push/key` | `{ publicKey }`, or `null` when push is off on this server |
| `PUT /api/push/subscriptions` | The browser's `PushSubscription.toJSON()` (`https://` endpoint only) → `204`; `503 push_unavailable` when push is off |
| `DELETE /api/push/subscriptions` | `{ endpoint }` → `204` (idempotent) |
| `GET /api/me/notification-settings` | `{ comments, answers, follows, groups, events, urgent }` (all `true` by default) |
| `PATCH /api/me/notification-settings` | Any of those booleans → the full settings |

**Notification** `{ id, type, text, count, actor: { id, name, photoUrl } | null, target: { type, id }, url, read, createdAt }`

| `type` | Sent to | When | `url` |
|---|---|---|---|
| `comment` | post author | someone comments | `/post/:id` |
| `answer` | asker (even with a hidden name) | someone answers | `/ask/:id` |
| `follow` | the member followed | someone follows them (not offices or clubs) | `/notifications` |
| `group_request` | the group's admins | someone asks to join a private group | `/groups/:id` |
| `group_approved` | the member | their request is approved (a refusal sends nothing) | `/groups/:id` |
| `event_cancelled` | everyone Going or Interested | the host cancels | `/events/:id` |

Rules (code: `apps/api/src/notifications/`, migration 018):
- **Never** about your own action, to deleted members, or across a block. An actor who is deleted or blocked later shows as `actor: null`.
- **Collapsing:** one unread notification per member, type and thing; more of the same raise `count` and set the latest actor. After it is read, the next one starts fresh. Admins' `group_request` is marked read once nobody is waiting.
- **Push:** one per *new* unread notification (a burst of comments is one push), only to members with a subscription who did not turn that kind off. Text is generic ("New comment on your post"): no names or content, because it shows on lock screens.
- **Urgent announcements** push to everyone on the campus who is not suspended and did not turn `urgent` off, with the announcement title (official public information). Normal ones never push.
- **Worker:** the API sends due pushes every 5 s (`push_outbox`, `SKIP LOCKED`). It retries with back-off (1, 2, 4, 8 min, at most 5 tries) only when no device got the push. Subscriptions the browser dropped (`404`/`410`) are deleted; one that fails 10 times is dropped. Each member keeps at most their 10 newest subscriptions.
- **Housekeeping:** outbox rows are deleted after a day; read notifications after 90 days; any after a year. Export includes notifications, devices and settings; deleting an account removes them all and clears the member as an actor.
- **Setup:** `npm run push:keys -w apps/api` once per server, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a team address, never a personal one). Changing the keys unsubscribes every browser.

---

## Not built yet
Chat, reels, map, ads, emergency button. Order for v0.2 (backend): follows ✅ → stories ✅ → club announcements ✅ → reactions ✅ → events ✅ → push ✅ → chat (end-to-end encrypted, after the library choice and an external review).
