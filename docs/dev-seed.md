# Development seed data

Fills an empty **local** database with test members and content so every screen has something to show.
Owner: Peter. Code: `apps/api/src/seed.ts`.

```
npm run migrate -w apps/api
npm run seed -w apps/api
```

- **Safe to run again.** Every row has a fixed id; a second run adds nothing.
- **Never runs in production** (`NODE_ENV=production` is refused), and refuses on a database that already
  has members it did not create. `--force` overrides the second check only; use it on throwaway databases.
- **Campus-neutral.** The campus and its email domains are read from the database (`--campus=<slug>` to pick one).
- Images are generated and passed through the real upload pipeline into `MEDIA_DIR`.

## Test members

All emails are `seed.<name>@<the campus's student or staff domain>`. Sign in with a one-time code.

| Name | What they are for |
|---|---|
| `amina` | Fresher, **under 18**, has a profile photo, asked a question with her name hidden |
| `brian` | Fresher; waiting for approval in a private group; has blocked `ivy` |
| `cynthia` | Continuing; chair of the Chess Club (club leader badge); posted a photo |
| `david` | Continuing; class rep (student leader badge); editor of the Student Council office |
| `esther` | Alumna |
| `felix` | **Staff**; owner of the Library and Dean of Students offices |
| `grace` | **Moderator** |
| `hassan` | **Admin**; owner of the Student Council office |
| `ivy` | **Suspended** for 7 days; her posts and comment are hidden |
| `newbie` | Signed up but **has not completed the profile** |
| (no email) | A **deleted account** whose post and comment remain ("Deleted member") |

## What to look for

| Screen | Seeded cases |
|---|---|
| Feed | 27 visible posts (two pages), a post with a photo, a post made as an office, plus one auto-hidden, one hidden by a moderator and one deleted post that must **not** appear |
| Groups | A class group per course and year, a verified club where only admins post, a public group, a private group with a pending request, a students-only group staff must not see |
| Today board | One urgent and one normal pinned announcement, one unpinned, one whose pin has expired |
| Ask a Senior | Answered questions with "helpful" marks, one with the asker's name hidden, one unanswered, one hidden |
| Admin | Open reports (three on one post), resolved and dismissed reports, a suspended member, admin log entries |
