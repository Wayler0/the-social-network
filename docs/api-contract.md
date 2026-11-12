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
| Image upload | Peter | #32 | ⬜ |
| Groups | Kim | #25 | ⬜ |
| Today board | Kim | #26 | ⬜ |
| Ask a Senior | Kim | #27 | ⬜ |
| Admin | Peter | #37 | ⬜ |

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

### Tables (migration `002_auth.sql`, CLAUDE.md section 13)
`users` (at least: `id, campus_id, email, member_type, name, member_number, member_number_normalised, member_number_status, course, year_of_study, graduation_year, is_under_18, verified, verified_method, suspended_at, created_at, deleted_at`), `auth_codes`, `sessions`.
Coordinate with Peter (#30) so there is one users migration, not two.

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
5. Send the email (Peter's #35 builds the sender; until then, in development **log the code to the console**, never in production).
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

## 6. Images (Peter, #32)

### `POST /api/images`
`multipart/form-data`, one file field `file`, JPEG/PNG/WebP/HEIC, max **8 MB** → `413`.
Server re-encodes to WebP (max 1080 px wide + a 320 px thumbnail), **strips EXIF and location**, saves to the media folder on disk (no MinIO in v0.1).
`201 { "imageId": "…", "url": "/media/…/1080.webp", "width": 1080, "height": 1350 }`
An image not attached to a post within 24 h is deleted.

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

Posting into a group uses `POST /api/posts` with `groupId`; if the group's `posting` is `admins_only` (clubs), non-admins get `403`. Course/year groups are created and joined automatically from the profile.

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

## 11. Admin (Peter, #37) — admins only, `403` otherwise

| Method & path | Notes |
|---|---|
| `GET /api/admin/reports?status=open&limit&cursor` | Queue, with the reported item and report count |
| `POST /api/admin/reports/:id/resolve` | `{ action: "hide"\|"dismiss" }` |
| `POST /api/admin/content/:type/:id/hide` / `…/unhide` | Posts, comments, questions, answers |
| `POST /api/admin/users/:id/suspend` | `{ reason, until? }` — also revokes sessions |
| `POST /api/admin/users/:id/unsuspend` | |
| `POST /api/admin/offices` | `{ name, type }` |
| `POST /api/admin/offices/:id/members` | `{ userId, role: "owner"\|"editor" }` |
| `POST /api/admin/groups/:id/verify-club` | Sets the CLUB badge |
| `GET /api/admin/disputes` | Member-number disputes |

Every admin action is written to an `admin_log` table (who, what, when).

---

## Not in v0.1
Chat, push notifications, reels, map, ads, emergency button, follows (v0.2 with stories). Don't build endpoints for them yet.
