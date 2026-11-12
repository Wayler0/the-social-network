# Hatua database (`db/`)

Owner: Peter (data, media & deployment). PostgreSQL 16 + PostGIS.
Source of truth for the design: `CLAUDE.md` section 13.

## Layout

| Path | What |
|---|---|
| `db/migrations/` | Numbered SQL files, applied in order, each in one transaction |
| `db/seeds/reference/` | Schools, courses, auto groups — needed everywhere |
| `db/seeds/dev/` | Fake users and content — development only |
| `db/migrate.sh` | Runner (plain `psql`, no Node or Python needed) |

## Commands

With Docker (works the same on Windows, macOS and Linux), from `infra/`:

```
docker compose up -d
docker compose run --rm migrate up
docker compose run --rm migrate seed-dev
docker compose run --rm migrate status
```

Without Docker (needs `psql` and bash):

```
DATABASE_URL=postgresql://hatua:PASSWORD@localhost:5432/hatua db/migrate.sh up
```

## Rules

1. **Never edit a migration that has been applied anywhere.** Add a new
   numbered file instead. The runner stops if an applied file has changed.
2. One change per file; name it `NNNN_what_it_does.sql`.
3. No `DROP` of a column or table without agreeing it at the Sunday briefing.
4. `seed-dev` refuses to run when `APP_ENV=production`.

## v0.1 tables

`schools`, `courses`, `users`, `auth_codes`, `sessions`,
`member_number_disputes`, `roles`, `office_accounts`, `office_members`,
`follows`, `groups`, `group_members`, `posts`, `comments`, `likes`,
`announcements`, `questions`, `answers`, `blocks`, `reports`.

Not built yet (later versions): chat, devices, places, emergency alerts, ads.

## Differences from the brief (for the team to confirm)

| Change | Why |
|---|---|
| New `schools` and `courses` tables; `users.course_id` instead of a free-text course | Auto groups per course and year need a fixed list; avoids "BSc CS" vs "Bsc Comp Sci" |
| `groups.course_id` + `groups.year_of_study` | Guarantees exactly one auto group per course and year |
| `users.name` and `users.member_type` may be NULL | The row is created when the email code is verified, before the profile is filled in |
| `users.member_number_normalised` is computed by the database | It can never disagree with `member_number` |
| Email and reg number are unique among **live** accounts only | A deleted account does not block the same person from signing up again |
| `users.avatar_key`, `bio`, `interests`, `verified_at` | Profile fields named in sections 2 and 4.1 |
| `users.suspended_until`, `suspended_reason` | The v0.1 admin panel must suspend users |
| `hidden_by` on posts/comments/questions/answers; `hidden_at` on questions/answers | Moderators hide content in every feature; record who did it |
| `announcements.created_by`, `roles.granted_by`, `reports.resolved_by/resolved_at` | Audit trail for admin actions |
| Auto groups are **private** | Only that class should be inside; the API adds members by course and year |

Kept exactly as the brief lists them: the five link tables (`follows`,
`likes`, `blocks`, `group_members`, `office_members`) have no `id` column.
Their primary key is the pair or triple of columns that identifies the row,
as section 13 spells out for `follows`. Every other table has a UUID `id`.

## Notes for the API (Kim)

- `users.member_number*` are private: never select them in public queries.
- Store only hashes in `auth_codes.code_hash` and `sessions.token_hash`.
- Feed pagination: `WHERE group_id IS NULL AND hidden_at IS NULL
  ORDER BY created_at DESC, id DESC` with a `(created_at, id)` cursor —
  this matches the `posts_feed_idx` index.
- `follows.target_id` and `reports.target_id` have no foreign key
  (they point at different tables); check the target exists before inserting.
- Deleting a `users` row removes that member's posts, comments, likes,
  sessions and memberships; reports they filed are kept with no reporter.
- Call `SELECT ensure_course_year_groups();` after adding a course.
