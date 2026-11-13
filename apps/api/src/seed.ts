/**
 * Development seed: fills an empty local database with realistic test members, groups, posts,
 * announcements and questions, so every screen has something to show.
 *
 *   npm run seed -w apps/api             (from the repo root, after `npm run migrate -w apps/api`)
 *   npm run seed -w apps/api -- --campus=<slug>
 *
 * Safe to run again: every row has a fixed id and existing rows are left alone.
 * It refuses to run with NODE_ENV=production, and refuses on a database that already has
 * members it did not create (pass --force only on a throwaway database).
 * Nothing here names a campus: the campus and its email domains are read from the database.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import { loadConfig } from './config.js';
import { processImage } from './images/process.js';
import { imageUrls } from './images/store.js';

/** The same name always gives the same UUID, which is what makes the seed repeatable. */
export function seedId(name: string): string {
  const h = createHash('sha256').update(`hatua-seed:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Why the seed must not run here, or null when it may. */
export function refusal(nodeEnv: string, membersNotFromSeed: number, force: boolean): string | null {
  if (nodeEnv === 'production') return 'Refusing to seed: NODE_ENV is production. The seed is for development only.';
  if (membersNotFromSeed > 0 && !force) {
    return `Refusing to seed: this database already has ${membersNotFromSeed} member(s) the seed did not create. `
      + 'If it really is a throwaway database, run again with --force.';
  }
  return null;
}

type Row = Record<string, unknown>;

/** Inserts rows, skipping any that already exist. Table and column names are constants in this file. */
async function insert(db: pg.Client, table: string, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]!);
  const values: unknown[] = [];
  const tuples = rows.map((row) => `(${columns.map((c) => { values.push(row[c] ?? null); return `$${values.length}`; }).join(', ')})`);
  const result = await db.query(
    `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')} on conflict do nothing`,
    values,
  );
  return result.rowCount ?? 0;
}

/** Every member the seed creates. The safety check counts members that are not in this list. */
type Member = { key: string; name: string | null; type: string; staff?: boolean; course?: string; year?: number; grad?: number;
  under18?: boolean | null; verified?: boolean; suspended?: boolean; deleted?: boolean };
const members: Member[] = [
  { key: 'amina',   name: 'Amina Wanjiru (seed)',  type: 'fresher',    course: 'BSc Computer Science', year: 1, under18: true },
  { key: 'brian',   name: 'Brian Otieno (seed)',   type: 'fresher',    course: 'Bachelor of Commerce', year: 1, under18: false },
  { key: 'cynthia', name: 'Cynthia Mwende (seed)', type: 'continuing', course: 'BSc Computer Science', year: 3, under18: false },
  { key: 'david',   name: 'David Kiprop (seed)',   type: 'continuing', course: 'Bachelor of Education (Arts)', year: 2, under18: false },
  { key: 'esther',  name: 'Esther Njeri (seed)',   type: 'alumni',     course: 'BSc Computer Science', grad: 2023, under18: false },
  { key: 'felix',   name: 'Dr Felix Mutua (seed)', type: 'staff',      staff: true, under18: false },
  { key: 'grace',   name: 'Grace Achieng (seed)',  type: 'continuing', course: 'Bachelor of Commerce', year: 4, under18: false },   // moderator
  { key: 'hassan',  name: 'Hassan Ali (seed)',     type: 'continuing', course: 'BSc Computer Science', year: 4, under18: false },   // admin
  { key: 'ivy',     name: 'Ivy Chebet (seed)',     type: 'continuing', course: 'Bachelor of Commerce', year: 2, under18: false, suspended: true },
  { key: 'newbie',  name: null,                    type: 'fresher',    under18: null, verified: false },                             // profile not completed
  { key: 'gone',    name: null,                    type: 'continuing', course: 'BSc Computer Science', year: 3, deleted: true },     // deleted account
];

export const seedUserIds = () => members.map((m) => seedId(`user:${m.key}`));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Draws a simple two-colour picture, so the seed needs no image files in the repository. */
async function drawPicture(file: string, width: number, height: number, from: number[], to: number[]) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      for (let c = 0; c < 3; c++) pixels[(y * width + x) * 3 + c] = Math.round(from[c]! + (to[c]! - from[c]!) * t);
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toFile(file);
}

export async function seed(db: pg.Client, opts: { mediaDir: string; campusSlug?: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ahead = (ms: number) => new Date(now.getTime() + ms);

  // ---- campus and its email domains (data, never hard-coded)
  const campuses = await db.query<{ id: string; slug: string; name: string }>(
    `select id, slug, name from campuses where status = 'active' and ($1::text is null or slug = $1) order by created_at limit 1`,
    [opts.campusSlug ?? null],
  );
  const campus = campuses.rows[0];
  if (!campus) throw new Error(opts.campusSlug ? `No active campus with slug "${opts.campusSlug}".` : 'No active campus. Run the migrations first.');
  const domains = await db.query<{ domain: string; member_type: string }>(
    'select domain, member_type from campus_email_domains where campus_id = $1 order by domain', [campus.id]);
  const studentDomain = domains.rows.find((d) => d.member_type === 'student')?.domain;
  const staffDomain = domains.rows.find((d) => d.member_type === 'staff')?.domain;
  if (!studentDomain || !staffDomain) throw new Error(`Campus "${campus.slug}" needs a student and a staff email domain.`);

  // ---- members
  const U = (key: string) => seedId(`user:${key}`);
  const userRows = members.map((m, i) => {
    const number = m.deleted ? null : m.name === null ? null : m.staff ? `SEEDSTAFF/${String(i + 1).padStart(4, '0')}` : `SEED/${String(i + 1).padStart(4, '0')}/26`;
    return {
      id: U(m.key), campus_id: campus.id,
      email: m.deleted ? null : `seed.${m.key}@${m.staff ? staffDomain : studentDomain}`,
      member_type: m.type, name: m.name, course: m.course ?? null, year_of_study: m.year ?? null, graduation_year: m.grad ?? null,
      member_number: number, member_number_normalised: number, member_number_status: number ? 'verified' : 'unverified',
      is_under_18: m.under18 ?? null, verified: m.verified ?? true, verified_method: m.verified === false ? null : 'email_code',
      suspended_at: m.suspended ? ago(DAY) : null, suspended_until: m.suspended ? ahead(6 * DAY) : null,
      suspended_reason: m.suspended ? 'Seed data: repeated spam in groups.' : null,
      created_at: ago(30 * DAY - i * HOUR), deleted_at: m.deleted ? ago(2 * DAY) : null,
    };
  });
  const counts: Record<string, number> = {};
  counts.users = await insert(db, 'users', userRows);

  counts.roles = await insert(db, 'roles', [
    { id: seedId('role:felix'),   user_id: U('felix'),   role: 'staff',          title: 'Lecturer, Computer Science', granted_by: U('hassan') },
    { id: seedId('role:grace'),   user_id: U('grace'),   role: 'moderator',      title: 'Moderator',                  granted_by: U('hassan') },
    { id: seedId('role:hassan'),  user_id: U('hassan'),  role: 'admin',          title: 'Admin',                      granted_by: null },
    { id: seedId('role:cynthia'), user_id: U('cynthia'), role: 'club_leader',    title: 'Chair, Chess Club',          granted_by: U('hassan') },
    { id: seedId('role:david'),   user_id: U('david'),   role: 'student_leader', title: 'Class Rep, Education Year 2', granted_by: U('hassan') },
  ]);

  // ---- images (made with the real upload pipeline, so they look exactly like uploaded ones)
  const mediaDir = path.resolve(opts.mediaDir);
  const pictures = [
    { key: 'sunset', owner: 'cynthia', w: 1600, h: 1200, from: [106, 61, 245], to: [255, 200, 61] },
    { key: 'pitch',  owner: 'brian',   w: 1200, h: 1500, from: [20, 200, 168], to: [17, 16, 24] },
    { key: 'avatar', owner: 'amina',   w: 600,  h: 600,  from: [255, 61, 113], to: [106, 61, 245] },
  ];
  const imageRows: Row[] = [];
  const imagePath = (key: string) => `2026/01/${seedId(`image-files:${key}`)}`;
  await mkdir(path.join(mediaDir, 'tmp'), { recursive: true });
  for (const p of pictures) {
    const outDir = path.join(mediaDir, imagePath(p.key));
    const full = path.join(outDir, '1080.webp');
    if (!(await access(full).then(() => true, () => false))) {
      const tmp = path.join(mediaDir, 'tmp', `seed-${p.key}.jpg`);
      await drawPicture(tmp, p.w, p.h, p.from, p.to);
      try { await processImage(tmp, outDir); } finally { await rm(tmp, { force: true }); }
    }
    const meta = await sharp(full).metadata();
    imageRows.push({ id: seedId(`image:${p.key}`), user_id: U(p.owner), path: imagePath(p.key),
      width: meta.width, height: meta.height, bytes: (await stat(full)).size, attached_at: ago(DAY), created_at: ago(DAY) });
  }
  counts.images = await insert(db, 'images', imageRows);
  await db.query('update users set photo_url = $2 where id = $1 and photo_url is null', [U('amina'), imageUrls(imagePath('avatar')).thumbUrl]);

  // ---- office accounts
  const O = (key: string) => seedId(`office:${key}`);
  counts.office_accounts = await insert(db, 'office_accounts', [
    { id: O('council'), campus_id: campus.id, name: 'Student Council (seed)',   type: 'student_council', verified: true },
    { id: O('library'), campus_id: campus.id, name: 'Library (seed)',           type: 'office',          verified: true },
    { id: O('dean'),    campus_id: campus.id, name: 'Dean of Students (seed)',  type: 'office',          verified: true },
  ]);
  counts.office_members = await insert(db, 'office_members', [
    { office_id: O('council'), user_id: U('hassan'), role: 'owner' },
    { office_id: O('council'), user_id: U('david'),  role: 'editor' },
    { office_id: O('library'), user_id: U('felix'),  role: 'owner' },
    { office_id: O('dean'),    user_id: U('felix'),  role: 'owner' },
  ]);

  // ---- groups: one class group per course and year, a club, and three ordinary groups
  const G = (key: string) => seedId(`group:${key}`);
  const classes = new Map<string, { course: string; year: number }>();
  for (const m of members) if (m.course && m.year && !m.deleted) classes.set(`${m.course}|${m.year}`, { course: m.course, year: m.year });
  const groupRows: Row[] = [...classes.entries()].map(([key, c]) => ({
    id: G(`class:${key}`), campus_id: campus.id, name: `${c.course} — Year ${c.year}`,
    description: `Class group for ${c.course}, year ${c.year}.`, visibility: 'private', student_only: false,
    kind: 'group', posting: 'everyone', auto_type: 'course_year', auto_course: c.course, auto_year: c.year,
    club_verified_at: null, club_verified_by: null, created_by: null,
  }));
  const group = (key: string, name: string, description: string, extra: Row = {}): Row => ({
    id: G(key), campus_id: campus.id, name, description, visibility: 'public', student_only: false, kind: 'group',
    posting: 'everyone', auto_type: 'none', auto_course: null, auto_year: null, club_verified_at: null, club_verified_by: null,
    created_by: U('cynthia'), ...extra,
  });
  groupRows.push(
    group('chess', 'Chess Club (seed)', 'Official club page. Only the committee posts here.',
      { kind: 'club', posting: 'admins_only', club_verified_at: ago(20 * DAY), club_verified_by: U('hassan') }),
    group('football', 'Weekend Football (seed)', 'Five-a-side every Saturday morning. Everyone is welcome.', { created_by: U('brian') }),
    group('roommates', 'Room-mates Wanted (seed)', 'Find someone to share a room with. Ask to join.', { visibility: 'private', created_by: U('david') }),
    group('study', 'Late-night Study Buddies (seed)', 'Students only. Staff cannot see this group.', { student_only: true, created_by: U('grace') }),
  );
  counts.groups = await insert(db, 'groups', groupRows);

  const memberRows: Row[] = [];
  for (const m of members) {
    if (m.course && m.year && !m.deleted) memberRows.push({ group_id: G(`class:${m.course}|${m.year}`), user_id: U(m.key), role: 'member', status: 'active' });
  }
  memberRows.push(
    { group_id: G('chess'),     user_id: U('cynthia'), role: 'admin',  status: 'active' },
    { group_id: G('chess'),     user_id: U('amina'),   role: 'member', status: 'active' },
    { group_id: G('chess'),     user_id: U('esther'),  role: 'member', status: 'active' },
    { group_id: G('football'),  user_id: U('brian'),   role: 'admin',  status: 'active' },
    { group_id: G('football'),  user_id: U('david'),   role: 'member', status: 'active' },
    { group_id: G('football'),  user_id: U('hassan'),  role: 'member', status: 'active' },
    { group_id: G('roommates'), user_id: U('david'),   role: 'admin',  status: 'active' },
    { group_id: G('roommates'), user_id: U('brian'),   role: 'member', status: 'pending' },   // waiting for approval
    { group_id: G('study'),     user_id: U('grace'),   role: 'admin',  status: 'active' },
    { group_id: G('study'),     user_id: U('cynthia'), role: 'member', status: 'active' },
  );
  counts.group_members = await insert(db, 'group_members', memberRows);

  // ---- posts: enough on the campus feed to need a second page (the page size is 20)
  const P = (key: string) => seedId(`post:${key}`);
  const feedLines = [
    'Anyone know what time the library opens on Saturdays?',
    'Lost a blue water bottle near the lecture halls. Please DM if you find it.',
    'CAT timetable for next week is out. Check with your class rep.',
    'The cafeteria has chapati today. You are welcome.',
    'Looking for two more people for a study group on data structures.',
    'Reminder: fees clearance deadline is this Friday.',
    'Who else is stuck on the statistics assignment?',
    'Matatus to town are filling up early today because of the rain.',
    'Free tutoring for first years in programming, Tuesdays at 4 pm.',
    'Power is back in the hostels.',
    'Graduation gowns can be collected from next Monday.',
    'Selling a second-hand scientific calculator, barely used.',
    'Great turnout at the tech talk yesterday. Slides coming soon.',
    'The Wi-Fi near the computer lab is finally working again.',
    'Is the health centre open on public holidays?',
    'Internship tip: update your CV before the career fair.',
    'Found a student ID near the gate. Handed in at security.',
    'Which lecturer is taking Operating Systems this semester?',
    'Chess tournament sign-ups close tomorrow.',
    'Morning run group meets at 6 am by the main gate.',
    'Printing is cheaper at the shop next to the cyber cafe.',
    'Exam cards are ready for collection.',
    `Proud to be part of ${campus.name}.`,
    'Any alumni working in software who can review a CV?',
  ];
  const authors = ['cynthia', 'brian', 'david', 'esther', 'grace', 'hassan', 'amina', 'felix'];
  const postRows: Row[] = feedLines.map((body, i) => ({
    id: P(`feed:${i}`), campus_id: campus.id, author_user_id: U(authors[i % authors.length]!), author_office_id: null,
    group_id: null, body, image_id: null, hidden_at: null, hidden_by: null, created_at: ago((i + 2) * 3 * HOUR), deleted_at: null,
  }));
  const post = (key: string, author: string, body: string, hoursAgo: number, extra: Row = {}): Row => ({
    id: P(key), campus_id: campus.id, author_user_id: U(author), author_office_id: null, group_id: null, body, image_id: null,
    hidden_at: null, hidden_by: null, created_at: ago(hoursAgo * HOUR), deleted_at: null, ...extra,
  });
  postRows.push(
    post('photo',    'cynthia', 'Sunset from the hostel roof this evening.', 1, { image_id: seedId('image:sunset') }),
    post('photo2',   'brian',   'New pitch markings are done. See you Saturday!', 4, { image_id: seedId('image:pitch'), group_id: G('football') }),
    post('office',   'hassan',  'Student Council elections: nominations open on Monday.', 2, { author_office_id: O('council') }),
    post('spam',     'ivy',     'Earn money fast from your phone, message me now!!!', 26, { hidden_at: ago(25 * HOUR), hidden_by: null }), // auto-hidden by 3 reports
    post('modhide',  'ivy',     'This post was hidden by a moderator (seed).', 50, { hidden_at: ago(49 * HOUR), hidden_by: U('grace') }),
    post('deleted',  'david',   'This post was deleted by its author (seed).', 30, { deleted_at: ago(29 * HOUR) }),
    post('gone',     'gone',    'Posted by a member who later deleted their account.', 80),
    post('chess1',   'cynthia', 'Tournament draw is out. First round is on Friday at 5 pm.', 6, { group_id: G('chess') }),
    post('chess2',   'cynthia', 'Welcome to all new members. Boards are in the common room.', 100, { group_id: G('chess') }),
    post('study1',   'grace',   'Who is revising in the library tonight?', 3, { group_id: G('study') }),
    post('class1',   'cynthia', 'Lab moved to room 12 tomorrow.', 5, { group_id: G('class:BSc Computer Science|3') }),
  );
  counts.posts = await insert(db, 'posts', postRows);

  counts.comments = await insert(db, 'comments', [
    { id: seedId('comment:1'), post_id: P('photo'),  user_id: U('brian'),  body: 'Beautiful!',                           created_at: ago(50 * 60_000), hidden_at: null, deleted_at: null },
    { id: seedId('comment:2'), post_id: P('photo'),  user_id: U('esther'), body: 'I miss that view.',                    created_at: ago(40 * 60_000), hidden_at: null, deleted_at: null },
    { id: seedId('comment:3'), post_id: P('feed:0'), user_id: U('felix'),  body: '9 am to 4 pm on Saturdays.',           created_at: ago(5 * HOUR),    hidden_at: null, deleted_at: null },
    { id: seedId('comment:4'), post_id: P('feed:0'), user_id: U('gone'),   body: 'Comment from a deleted member.',       created_at: ago(4 * HOUR),    hidden_at: null, deleted_at: null },
    { id: seedId('comment:5'), post_id: P('feed:4'), user_id: U('amina'),  body: 'Count me in.',                         created_at: ago(13 * HOUR),   hidden_at: null, deleted_at: null },
    { id: seedId('comment:6'), post_id: P('feed:4'), user_id: U('ivy'),    body: 'A rude comment hidden by a moderator (seed).', created_at: ago(12 * HOUR), hidden_at: ago(11 * HOUR), deleted_at: null },
    { id: seedId('comment:7'), post_id: P('office'), user_id: U('david'),  body: 'Where do we pick the forms?',          created_at: ago(HOUR),        hidden_at: null, deleted_at: null },
  ]);

  const likeRows: Row[] = [];
  const liking = ['amina', 'brian', 'cynthia', 'david', 'esther', 'grace', 'hassan'];
  liking.forEach((who) => likeRows.push({ user_id: U(who), post_id: P('photo') }));
  liking.slice(0, 4).forEach((who) => likeRows.push({ user_id: U(who), post_id: P('office') }));
  feedLines.forEach((_, i) => { if (i % 3 === 0) likeRows.push({ user_id: U(liking[i % liking.length]!), post_id: P(`feed:${i}`) }); });
  counts.likes = await insert(db, 'likes', likeRows);

  // ---- Today board
  counts.announcements = await insert(db, 'announcements', [
    { id: seedId('ann:water'),   campus_id: campus.id, office_id: O('dean'),    created_by: U('felix'),  title: 'Water shortage in the hostels today',
      body: 'Water will be off from 10 am to 4 pm for repairs. Please store enough beforehand.', urgency: 'urgent', pinned_until: ahead(2 * DAY), created_at: ago(2 * HOUR) },
    { id: seedId('ann:library'), campus_id: campus.id, office_id: O('library'), created_by: U('felix'),  title: 'Library open until 10 pm during exams',
      body: 'Extended hours start on Monday. Bring your student ID.', urgency: 'normal', pinned_until: ahead(7 * DAY), created_at: ago(DAY) },
    { id: seedId('ann:council'), campus_id: campus.id, office_id: O('council'), created_by: U('hassan'), title: 'Council office hours',
      body: 'We are in the student centre every weekday from 2 pm to 4 pm.', urgency: 'normal', pinned_until: null, created_at: ago(3 * DAY) },
    { id: seedId('ann:old'),     campus_id: campus.id, office_id: O('council'), created_by: U('david'),  title: 'Clean-up day (finished)',
      body: 'Thank you to everyone who came. This pin has expired.', urgency: 'normal', pinned_until: ago(3 * DAY), created_at: ago(10 * DAY) },
  ]);

  // ---- Ask a Senior
  const Q = (key: string) => seedId(`question:${key}`);
  const A = (key: string) => seedId(`answer:${key}`);
  counts.questions = await insert(db, 'questions', [
    { id: Q('id'),      campus_id: campus.id, user_id: U('amina'), hide_name: true,  body: 'Where do I collect my student ID, and what do I need to bring?', created_at: ago(20 * HOUR), hidden_at: null },
    { id: Q('hostel'),  campus_id: campus.id, user_id: U('brian'), hide_name: false, body: 'Which hostels are closest to the library?',                      created_at: ago(2 * DAY),   hidden_at: null },
    { id: Q('units'),   campus_id: campus.id, user_id: U('amina'), hide_name: false, body: 'How many units can a first year register for in one semester?', created_at: ago(5 * DAY),   hidden_at: null },
    { id: Q('open'),    campus_id: campus.id, user_id: U('brian'), hide_name: true,  body: 'Is it normal to feel lost in the first month? Nobody has answered this yet.', created_at: ago(3 * HOUR), hidden_at: null },
    { id: Q('hidden'),  campus_id: campus.id, user_id: U('ivy'),   hide_name: false, body: 'A question hidden by a moderator (seed).',                       created_at: ago(6 * DAY),   hidden_at: ago(5 * DAY) },
  ]);
  counts.answers = await insert(db, 'answers', [
    { id: A('id1'),     question_id: Q('id'),     user_id: U('cynthia'), body: 'At the registry, ground floor. Bring your admission letter and national ID or birth certificate.', created_at: ago(19 * HOUR) },
    { id: A('id2'),     question_id: Q('id'),     user_id: U('esther'),  body: 'Go early in the morning, the queue is short before 9 am.',                 created_at: ago(18 * HOUR) },
    { id: A('hostel1'), question_id: Q('hostel'), user_id: U('david'),   body: 'The two blocks behind the dining hall. About three minutes on foot.',       created_at: ago(40 * HOUR) },
    { id: A('units1'),  question_id: Q('units'),  user_id: U('grace'),   body: 'Check your programme guide, and confirm with your class rep before registering.', created_at: ago(4 * DAY) },
    { id: A('units2'),  question_id: Q('units'),  user_id: U('felix'),   body: 'Your academic adviser signs off on your units, so ask them first.',         created_at: ago(4 * DAY - HOUR) },
  ]);
  counts.answer_helpful = await insert(db, 'answer_helpful', [
    { answer_id: A('id1'),     user_id: U('amina') },
    { answer_id: A('id1'),     user_id: U('brian') },
    { answer_id: A('id2'),     user_id: U('amina') },
    { answer_id: A('hostel1'), user_id: U('brian') },
    { answer_id: A('units2'),  user_id: U('amina') },
  ]);

  // ---- safety: a block, reports in every state, and the admin log
  counts.blocks = await insert(db, 'blocks', [{ blocker_id: U('brian'), blocked_id: U('ivy') }]);
  const report = (key: string, by: string, type: string, target: string, reason: string, hoursAgo: number, extra: Row = {}): Row => ({
    id: seedId(`report:${key}`), campus_id: campus.id, reporter_id: U(by), target_type: type, target_id: target, reason,
    details: null, status: 'open', resolved_by: null, resolved_at: null, created_at: ago(hoursAgo * HOUR), ...extra,
  });
  counts.reports = await insert(db, 'reports', [
    report('spam1', 'amina',   'post',     P('spam'), 'spam', 25.5),          // three open reports: the post is auto-hidden
    report('spam2', 'brian',   'post',     P('spam'), 'spam', 25.4),
    report('spam3', 'cynthia', 'post',     P('spam'), 'spam', 25.2, { details: 'Same message posted in three groups.' }),
    report('rude',  'amina',   'comment',  seedId('comment:6'), 'harassment', 11.5, { status: 'hidden', resolved_by: U('grace'), resolved_at: ago(11 * HOUR) }),
    report('modhide', 'david', 'post',     P('modhide'), 'false_info', 49.5, { status: 'hidden', resolved_by: U('grace'), resolved_at: ago(49 * HOUR) }),
    report('fine',  'ivy',     'post',     P('office'), 'other', 1.5, { details: 'I just do not like it.', status: 'dismissed', resolved_by: U('hassan'), resolved_at: ago(HOUR) }),
    report('user',  'brian',   'user',     U('ivy'), 'harassment', 30),
    report('q',     'grace',   'question', Q('hidden'), 'spam', 5 * 24 + 1, { status: 'hidden', resolved_by: U('grace'), resolved_at: ago(5 * DAY) }),
  ]);
  counts.admin_log = await insert(db, 'admin_log', [
    { id: seedId('log:1'), campus_id: campus.id, admin_user_id: U('grace'),  action: 'post.hide',     target_type: 'post',    target_id: P('modhide'),        details: JSON.stringify({ reason: 'false_info' }), created_at: ago(49 * HOUR) },
    { id: seedId('log:2'), campus_id: campus.id, admin_user_id: U('grace'),  action: 'comment.hide',  target_type: 'comment', target_id: seedId('comment:6'), details: JSON.stringify({ reason: 'harassment' }), created_at: ago(11 * HOUR) },
    { id: seedId('log:3'), campus_id: campus.id, admin_user_id: U('hassan'), action: 'user.suspend',  target_type: 'user',    target_id: U('ivy'),            details: JSON.stringify({ days: 7, reason: 'Repeated spam in groups.' }), created_at: ago(DAY) },
    { id: seedId('log:4'), campus_id: campus.id, admin_user_id: U('hassan'), action: 'office.create', target_type: 'office',  target_id: O('library'),        details: null, created_at: ago(29 * DAY) },
  ]);

  return { campus, counts, emails: userRows.map((u) => u.email).filter((e): e is string => e !== null) };
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const campusSlug = args.find((a) => a.startsWith('--campus='))?.slice('--campus='.length);
  const unknown = args.filter((a) => a !== '--force' && !a.startsWith('--campus='));
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(' ')}. Options: --campus=<slug>, --force`);

  const db = new pg.Client({ connectionString: config.DATABASE_URL });
  await db.connect();
  try {
    const others = await db.query<{ n: number }>('select count(*)::int as n from users where id <> all($1::uuid[])', [seedUserIds()]);
    const no = refusal(config.NODE_ENV, others.rows[0]!.n, force);
    if (no) throw new Error(no);

    await db.query('begin');
    try {
      const result = await seed(db, { mediaDir: config.MEDIA_DIR, campusSlug });
      await db.query('commit');
      const added = Object.entries(result.counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ');
      console.log(`Seeded campus "${result.campus.slug}". ${added ? `Added: ${added}.` : 'Nothing new: the seed was already there.'}`);
      console.log(`Test members (sign in with a one-time code):\n  ${result.emails.join('\n  ')}`);
    } catch (err) {
      await db.query('rollback');
      throw err;
    }
  } finally {
    await db.end();
  }
}

// Run only when started directly (`npm run seed`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
