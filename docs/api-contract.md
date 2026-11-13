# API contract — v0.1

The agreement between the web app (Solomon) and the API (Kim, Peter), so both sides can build at the same time.
**Change it by pull request** and tell the other side; never change a shipped endpoint silently.

Status key: ✅ built · 🔨 in progress · ⬜ not started

| Area | Owner | Issues | Status |
|---|---|---|---|
| Health, campuses | — | — | ✅ |
| Auth (sign-in codes, sessions) | Kim | #17, #18, #19 | ⬜ **start here** |
| Me / profile / delete account | Kim | #20, #21 | ⬜ |
| Posts, comments, likes, feed | Kim | #22, #24 | ⬜ |
| Report and block | Kim | #23 | ⬜ |
| Image upload | Peter | #32 | ✅ |
| Groups | Kim | #25 | ⬜ |
| Today board | Kim | #26 | ⬜ |
| Ask a Senior | Kim | #27 | ⬜ |
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
  "emailDomains": { "student.tharaka.ac.ke": "student", "tharaka.ac.ke": "staff" } }] }
```

---

## 3. Auth — Kim starts here (issues #17, #18, #19)

Sign-in and sign-up are **the same flow**: request a code, enter it. A new email creates an account; a known email signs in. The web screens already call these two endpoints with exactly these shapes (`apps/web/src/lib/api.ts`).

### Tables (migration `002_users_sessions.sql` ✅, CLAUDE.md section 13)
`users` (at least: `id, campus_id, email, member_type, name, member_number, member_number_normalised, member_number_status, course, year_of_study, graduation_year, is_under_18, verified, verified_method, suspended_at, created_at, deleted_at`), `auth_codes`, `sessions`.
Written for #30. Rate limits use the `rate_limit_events` table (one row per counted event). Further columns come as new migrations (003_…), never by editing 002.

### `POST /api/auth/request-code` *(public)*
```json
{ "email": "abc.123@student.tharaka.ac.ke" }
```
`200 { "resendAfterSeconds": 30 }`

1. Trim and lower-case the email. Look up the domain **exactly** in `campus_email_domains` (no `endsWith` — look-alikes like `tharaka.ac.ke.evil.com` must fail). Unknown domain → `400 email_not_allowed`.
2. Rate limits (store in Postgres — there is no Redis):
   - same email: 1 code per 30 s, 5 per hour → `429`
   - same IP: 20 per hour → `429`
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

### `POST /api/auth/verify-code` *(public)*
```json
{ "email": "abc.123@student.tharaka.ac.ke", "code": "482913" }
```
`200 { "newUser": true }` and sets the session cookie.

1. Find the newest unconsumed, unexpired code for the email. Compare hashes with `crypto.timingSafeEqual`.
2. Wrong code → increment `attempts`; at **5** attempts the code is dead. Reply `400 code_wrong` with message "That code is wrong or has expired." (same message for wrong, expired and dead — don't help guessing).
3. Right code → mark it consumed (in the same transaction, so it can't be used twice).
4. No user with that email → create one: `campus_id` and `member_type` from the domain, `verified = true`, `verified_method = 'email_code'`, profile fields empty. `newUser: true`.
   Existing user → `newUser: false`. If `deleted_at` is set, treat as new (the old account stays deleted).
5. Create a session: random 32-byte token (`crypto.randomBytes(32).toString('base64url')`), store **only** `sha256(token)` as `token_hash`, expires in **30 days**.
6. Set the cookie:
   `hatua_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
   (`Secure` off only when `NODE_ENV=development`; read the cookie name from config, not the app name in code).
7. Rate limit: 10 verify attempts per IP per 10 minutes → `429`.

### `POST /api/auth/logout`
Revokes the current session (`revoked_at = now()`), clears the cookie. `204`.

### `POST /api/auth/logout-all`
Revokes all of the member's sessions. `204`.

### Session check (every protected route)
A Fastify `preHandler` that reads the cookie, looks up `sha256(token)`, and rejects if missing, revoked, expired, or the user is deleted (`401`) or suspended (`403 suspended`). Extend `expires_at` (sliding) at most once a day, and update `last_seen_at` at most once every 5 minutes, to save writes.

### `GET /api/me`
```json
{
  "id": "…", "campus": { "slug": "tharaka", "name": "Tharaka University" },
  "email": "abc.123@student.tharaka.ac.ke",
  "memberType": "continuing",
  "name": null, "photoUrl": null, "course": null, "yearOfStudy": null, "graduationYear": null,
  "memberNumber": null, "memberNumberStatus": "unverified",
  "isUnder18": null, "badges": [], "isAdmin": false,
  "profileComplete": false
}
```
`profileComplete` is true once `name`, `memberType`, `memberNumber` and (students) `yearOfStudy` or (alumni) `graduationYear` are set and `isUnder18` is answered. The web app sends incomplete profiles to the onboarding screen; other protected endpoints (posting, joining groups) return `403 profile_incomplete` until it is complete.

### Done when (#17–#19)
- [ ] Tests (vitest + `app.inject`) for: allowed and look-alike domains, rate limits, wrong/expired/reused code, 5-attempt lockout, cookie flags, logout, logout-all, suspended user.
- [ ] Web app works against the real API with `VITE_API_MOCK=false`.
- [ ] No code or token is ever stored or logged in plain text in production.

---

## 4. Me and profile (#20, #21)

### `PATCH /api/me` — onboarding and edit profile
```json
{ "name": "Wanjiru M.", "memberType": "fresher", "course": "BSc Computer Science",
  "yearOfStudy": 1, "memberNumber": "ABT5/09919/23", "isUnder18": false }
```
All fields optional; send only what changes. `200` with the same body as `GET /api/me`.
- `memberType`: students choose `fresher | continuing | alumni`; staff are always `staff`.
- `memberNumber`: normalise (upper-case, remove spaces and `-`, keep `/`), check format, unique per campus → `409 member_number_taken` (the screen offers the "someone has my reg number" dispute).
- `isUnder18` sets safer defaults (CLAUDE.md section 6).
- After saving, in the **same transaction**, put the member in the right class group (Peter's helper):
  ```ts
  import { syncClassGroup } from '../groups/class-groups.js';
  await syncClassGroup(client, user.id);   // → { groupId, created, left }
  ```
  It creates the class group if the member is the first of their class, joins them, and takes them out of their old
  one when course, year or member type changes. Staff, alumni and unfinished profiles get no class group.
  Call it from `DELETE /api/me` too (after setting `deleted_at`) so the account leaves its class group.

### `POST /api/me/member-number-dispute`
`{ "memberNumber": "…", "details": "…" }` → `202`. Goes to the admin queue.

### `GET /api/users/:id` — someone's public profile
`{ id, name, photoUrl, memberType, course, yearOfStudy, graduationYear, badges, isFollowing }` — **no** email or member number. `404` if blocked either way.

### `DELETE /api/me` — delete account
`{ "confirm": "DELETE" }` → `204`. Sets `deleted_at`, revokes all sessions, clears personal fields, removes their posts' images; posts and comments show "Deleted member". Exact rules in #21.

---

## 5. Feed, posts, comments, likes (#22, #24)

| Method & path | Body / query | Response |
|---|---|---|
| `GET /api/feed` | `?limit&cursor` | page of **Post** — campus-wide, newest first |
| `POST /api/posts` | `{ body, imageId?, groupId? }` (body 1–2000 chars; image from §6) | `201` Post |
| `GET /api/posts/:id` | | Post |
| `DELETE /api/posts/:id` | author or admin | `204` |
| `GET /api/posts/:id/comments` | `?limit&cursor` (oldest first) | page of Comment |
| `POST /api/posts/:id/comments` | `{ body }` (1–1000 chars) | `201` Comment |
| `DELETE /api/comments/:id` | author, post author, or admin | `204` |
| `PUT /api/posts/:id/like` | | `200 { liked: true, likeCount }` (idempotent) |
| `DELETE /api/posts/:id/like` | | `200 { liked: false, likeCount }` |

**Post**
```json
{ "id": "…", "author": { "id": "…", "name": "…", "photoUrl": null, "badges": ["Staff"] },
  "office": null, "group": null,
  "body": "…", "image": { "url": "/media/…/1080.webp", "width": 1080, "height": 1350 } ,
  "likeCount": 12, "commentCount": 3, "likedByMe": false, "createdAt": "…" }
```
**Comment** `{ id, author, body, createdAt }`

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

## 7. Report and block (#23)

| Method & path | Body | Response |
|---|---|---|
| `POST /api/reports` | `{ targetType: "post"\|"comment"\|"user"\|"group"\|"question"\|"answer", targetId, reason: "spam"\|"harassment"\|"hate"\|"nudity"\|"violence"\|"self_harm"\|"false_info"\|"other", details? }` | `202` |
| `PUT /api/users/:id/block` | | `204` |
| `DELETE /api/users/:id/block` | | `204` |
| `GET /api/me/blocks` | | `{ items: [{ id, name }] }` |

3 open reports from different members on the same item **auto-hide** it until an admin reviews it.

---

## 8. Groups (#25)

| Method & path | Notes |
|---|---|
| `GET /api/groups?mine=true&limit&cursor` | Discover list, or only mine |
| `POST /api/groups` | `{ name, description, visibility: "public"\|"private", studentOnly }` |
| `GET /api/groups/:id` | Group (private groups show name and description only to non-members) |
| `PUT /api/groups/:id/membership` | Join (public) or request (private) → `{ status: "active"\|"pending" }` |
| `DELETE /api/groups/:id/membership` | Leave |
| `GET /api/groups/:id/requests` | Admins: pending requests |
| `POST /api/groups/:id/requests/:userId` | Admins: `{ approve: true\|false }` |
| `GET /api/groups/:id/posts?limit&cursor` | Members only |

Posting into a group uses `POST /api/posts` with `groupId`; if the group's `posting` is `admins_only` (clubs), non-admins get `403`. Course/year groups are created and joined automatically from the profile (`syncClassGroup`, section 4): one private group per course and year per campus, named `<course> — Year <n>`. Course names match ignoring case and extra spaces, but "BSc CS" and "BSc Computer Science" are different courses — the profile screen should offer a fixed list.

**Group** `{ id, name, description, visibility, studentOnly, kind: "group"|"club", clubVerified, posting, memberCount, myStatus: "none"|"pending"|"active", myRole: "member"|"admin"|null }`

---

## 9. Today board (#26)

| Method & path | Notes |
|---|---|
| `GET /api/announcements?limit&cursor` | Pinned and urgent first, then newest |
| `POST /api/announcements` | Office members only: `{ officeId, title, body, urgency: "normal"\|"urgent", pinnedUntil? }` |
| `DELETE /api/announcements/:id` | Office owner or admin |

---

## 10. Ask a Senior (#27)

| Method & path | Notes |
|---|---|
| `GET /api/questions?limit&cursor` | Newest first |
| `POST /api/questions` | `{ body, hideName }` — `hideName` hides the name from **students**; admins still see it |
| `GET /api/questions/:id` | Question with answers (most helpful first) |
| `POST /api/questions/:id/answers` | `{ body }` |
| `PUT /api/answers/:id/helpful` / `DELETE …` | Toggle "helpful" |

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

## Not in v0.1
Chat, push notifications, reels, map, ads, emergency button, follows (v0.2 with stories). Don't build endpoints for them yet.
