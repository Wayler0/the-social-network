import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db.js';
import { normaliseMemberNumber, profileComplete } from './profile.js';
import { requireCompleteProfile } from './routes.js';

describe('member numbers', () => {
  it('normalises: upper-case, no spaces or dashes, slashes kept', () => {
    expect(normaliseMemberNumber(' abt5 / 09919-23 ')).toBe('ABT5/0991923');
    expect(normaliseMemberNumber('ABT5/09919/23')).toBe('ABT5/09919/23');
    expect(normaliseMemberNumber('ts-1042')).toBe('TS1042');
  });
  it('refuses what cannot be a number', () => {
    for (const bad of ['', 'ab', 'ABCDEF', 'ABT5/0991<23', 'é123', '1'.repeat(41)]) expect(normaliseMemberNumber(bad), bad).toBeNull();
  });
});

describe('profileComplete', () => {
  const base = { name: 'A', member_type: 'continuing', member_number: 'X1', is_under_18: false, year_of_study: 2, graduation_year: null };
  it('needs name, number, the under-18 answer, and a year for students or a graduation year for alumni', () => {
    expect(profileComplete(base)).toBe(true);
    expect(profileComplete({ ...base, name: null })).toBe(false);
    expect(profileComplete({ ...base, member_number: null })).toBe(false);
    expect(profileComplete({ ...base, is_under_18: null })).toBe(false);
    expect(profileComplete({ ...base, year_of_study: null })).toBe(false);
    expect(profileComplete({ ...base, member_type: 'alumni', year_of_study: null })).toBe(false);
    expect(profileComplete({ ...base, member_type: 'alumni', year_of_study: null, graduation_year: 2023 })).toBe(true);
    expect(profileComplete({ ...base, member_type: 'staff', year_of_study: null })).toBe(true);
  });
});

/** Against a real PostgreSQL (npm run test:db -w apps/api); each test is rolled back. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('GET and PATCH /api/me (real database)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  let campusId: string;
  let studentDomain: string;
  let staffDomain: string;

  function rollbackPool(): Db {
    const tx = {
      query: (sql: string, params?: unknown[]) => {
        if (sql === 'begin') return client.query('savepoint api_tx');
        if (sql === 'commit') return client.query('release savepoint api_tx');
        if (sql === 'rollback') return client.query('rollback to savepoint api_tx');
        return client.query(sql, params);
      },
      release: () => {},
    };
    return { query: (sql: string, params?: unknown[]) => client.query(sql, params), connect: async () => tx } as unknown as Db;
  }

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-me-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    const domains = (await client.query<{ domain: string; member_type: string; campus_id: string }>(
      `select d.domain, d.member_type, d.campus_id from campus_email_domains d join campuses c on c.id = d.campus_id
        where c.status = 'active' order by c.created_at`)).rows;
    studentDomain = domains.find((d) => d.member_type === 'student')!.domain;
    staffDomain = domains.find((d) => d.member_type === 'staff')!.domain;
    campusId = domains[0]!.campus_id;
    const db = rollbackPool();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir }), db);
    app.post('/api/test/needs-profile', async (req, reply) => (await requireCompleteProfile(db, req, reply)) ? { ok: true } : reply);
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); });
  afterEach(async () => { await client.query('rollback'); });

  /** A freshly verified member, as verify-code makes them, and their session cookie. */
  async function member(local: string, type: 'continuing' | 'staff' = 'continuing') {
    const email = `${local}@${type === 'staff' ? staffDomain : studentDomain}`;
    const id = (await client.query<{ id: string }>(
      `insert into users (campus_id, email, member_type, verified, verified_method) values ($1, $2, $3, true, 'email_code') returning id`,
      [campusId, email, type])).rows[0]!.id;
    const token = await createSession(client, id, { userAgent: 'test', ip: '10.7.0.1' });
    const as = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
    return { id, email, as };
  }
  const onboarding = { name: 'Wanjiru M.', memberType: 'fresher', course: 'BSc Computer Science', yearOfStudy: 1, memberNumber: 'ABT5/09919/23', isUnder18: false };
  const classGroupsOf = async (id: string) => (await client.query<{ name: string }>(
    `select g.name from group_members m join groups g on g.id = m.group_id where m.user_id = $1 and g.auto_type = 'course_year'`, [id])).rows.map((r) => r.name);
  async function uploadedImage(owner: string): Promise<string> {
    const id = randomUUID();
    await client.query(`insert into images (id, user_id, path, width, height, bytes) values ($1, $2, $3, 320, 320, 1000)`, [id, owner, `2026/11/${id}`]);
    return id;
  }

  it('GET shows a new member their own profile, private fields included', async () => {
    const m = await member('new.me');
    const res = await m.as('GET', '/api/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: m.id, campus: { slug: expect.any(String), name: expect.any(String) }, email: m.email, memberType: 'continuing',
      name: null, photoUrl: null, course: null, yearOfStudy: null, graduationYear: null,
      memberNumber: null, memberNumberStatus: 'unverified', isUnder18: null, badges: [], isAdmin: false, profileComplete: false,
    });
  });

  it('GET without a session is 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  });

  it('onboarding completes the profile and joins the class group', async () => {
    const m = await member('onboard');
    const res = await m.as('PATCH', '/api/me', onboarding);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'Wanjiru M.', memberType: 'fresher', course: 'BSc Computer Science', yearOfStudy: 1,
      memberNumber: 'ABT5/09919/23', memberNumberStatus: 'unverified', isUnder18: false, profileComplete: true,
    });
    expect(await classGroupsOf(m.id)).toEqual(['BSc Computer Science — Year 1']);
  });

  it('gates other routes with 403 profile_incomplete until onboarding is done', async () => {
    const m = await member('gated');
    expect([(await m.as('POST', '/api/test/needs-profile')).statusCode, (await m.as('POST', '/api/test/needs-profile')).json().error]).toEqual([403, 'profile_incomplete']);
    await m.as('PATCH', '/api/me', onboarding);
    expect((await m.as('POST', '/api/test/needs-profile')).json()).toEqual({ ok: true });
  });

  it('moves the member to the class group of a new course or year', async () => {
    const m = await member('mover');
    await m.as('PATCH', '/api/me', onboarding);
    await m.as('PATCH', '/api/me', { memberType: 'continuing', yearOfStudy: 2 });
    expect(await classGroupsOf(m.id)).toEqual(['BSc Computer Science — Year 2']);
    await m.as('PATCH', '/api/me', { course: '  Bachelor   of Commerce ' });
    expect((await m.as('GET', '/api/me')).json().course).toBe('Bachelor of Commerce');
    expect(await classGroupsOf(m.id)).toEqual(['Bachelor of Commerce — Year 2']);
  });

  it('alumni keep a graduation year instead of a year of study, and leave their class group', async () => {
    const m = await member('graduate');
    await m.as('PATCH', '/api/me', onboarding);
    const res = await m.as('PATCH', '/api/me', { memberType: 'alumni' });
    expect(res.json()).toMatchObject({ memberType: 'alumni', yearOfStudy: null, profileComplete: false });
    expect(await classGroupsOf(m.id)).toEqual([]);
    expect((await m.as('PATCH', '/api/me', { graduationYear: 2025 })).json()).toMatchObject({ graduationYear: 2025, profileComplete: true });
  });

  it('students cannot become staff, and staff stay staff', async () => {
    const s = await member('not.staff');
    expect((await s.as('PATCH', '/api/me', { memberType: 'staff' })).json().error).toBe('invalid_input');
    const t = await member('lecturer', 'staff');
    expect((await t.as('PATCH', '/api/me', { memberType: 'continuing' })).json().error).toBe('invalid_input');
    const ok = await t.as('PATCH', '/api/me', { name: 'Dr T', memberType: 'staff', memberNumber: 'TS-1042', isUnder18: false, yearOfStudy: 3 });
    expect(ok.json()).toMatchObject({ memberType: 'staff', memberNumber: 'TS-1042', yearOfStudy: null, profileComplete: true });
    expect(await classGroupsOf(t.id)).toEqual([]);
  });

  it('member numbers: one account per number, however it is typed', async () => {
    const a = await member('first.owner');
    const b = await member('second.claimer');
    expect((await a.as('PATCH', '/api/me', { memberNumber: 'ABT5/09919/23' })).statusCode).toBe(200);
    const taken = await b.as('PATCH', '/api/me', { memberNumber: ' abt5/09919/23 ', name: 'B' });
    expect([taken.statusCode, taken.json().error]).toEqual([409, 'member_number_taken']);
    expect((await b.as('GET', '/api/me')).json().name).toBeNull();          // nothing else was saved either
    expect((await a.as('PATCH', '/api/me', { memberNumber: 'ABT5/09919/23' })).statusCode).toBe(200);   // own number again is fine
  });

  it('a deleted account frees its member number', async () => {
    const a = await member('leaver');
    await a.as('PATCH', '/api/me', { memberNumber: 'ABT5/00001/20' });
    await client.query('update users set email = null, deleted_at = now() where id = $1', [a.id]);
    expect((await (await member('rejoiner')).as('PATCH', '/api/me', { memberNumber: 'ABT5/00001/20' })).statusCode).toBe(200);
  });

  it('a changed number goes back to unverified', async () => {
    const m = await member('renumber');
    await m.as('PATCH', '/api/me', { memberNumber: 'ABT5/1/23' });
    await client.query(`update users set member_number_status = 'verified' where id = $1`, [m.id]);
    expect((await m.as('PATCH', '/api/me', { memberNumber: 'abt5/1/23' })).json().memberNumberStatus).toBe('verified');   // same number
    expect((await m.as('PATCH', '/api/me', { memberNumber: 'ABT5/2/23' })).json().memberNumberStatus).toBe('unverified');
  });

  it('rejects bad input, saving nothing', async () => {
    const m = await member('careless');
    for (const body of [{ memberNumber: 'nope' }, { name: '' }, { name: 'x'.repeat(81) }, { yearOfStudy: 9 }, { graduationYear: 1900 },
      { isUnder18: 'no' }, { email: 'other@x.example' }, { memberNumberStatus: 'verified' }, { course: 'c'.repeat(121) }]) {
      const res = await m.as('PATCH', '/api/me', body);
      expect([res.statusCode, res.json().error], JSON.stringify(body)).toEqual([400, 'invalid_input']);
    }
    expect((await m.as('GET', '/api/me')).json()).toMatchObject({ name: null, memberNumber: null, memberNumberStatus: 'unverified' });
  });

  it('shows current role badges; admin is a permission, not a badge', async () => {
    const m = await member('badged', 'staff');
    await client.query(`insert into roles (user_id, role, starts_at, ends_at) values
      ($1, 'staff', now() - interval '1 day', null), ($1, 'moderator', now() - interval '1 day', null),
      ($1, 'admin', now() - interval '1 day', null), ($1, 'club_leader', now() - interval '2 days', now() - interval '1 day')`, [m.id]);
    expect((await m.as('GET', '/api/me')).json()).toMatchObject({ badges: ['Moderator', 'Staff'], isAdmin: true });
  });

  it('profile photo: set from an upload, replace (old files deleted), remove; never someone else\'s image', async () => {
    const m = await member('photogenic');
    const first = await uploadedImage(m.id);
    const res = await m.as('PATCH', '/api/me', { photoImageId: first });
    expect(res.json().photoUrl).toBe(`/media/2026/11/${first}/320.webp`);

    const second = await uploadedImage(m.id);
    expect((await m.as('PATCH', '/api/me', { photoImageId: second })).json().photoUrl).toContain(second);
    expect((await client.query('select 1 from images where id = $1', [first])).rows).toHaveLength(0);

    expect((await m.as('PATCH', '/api/me', { photoImageId: null })).json().photoUrl).toBeNull();
    expect((await client.query('select 1 from images where id = $1', [second])).rows).toHaveLength(0);

    const other = await member('other.person');
    const theirs = await uploadedImage(other.id);
    expect((await m.as('PATCH', '/api/me', { photoImageId: theirs })).json().error).toBe('invalid_input');
    expect((await m.as('PATCH', '/api/me', { photoImageId: randomUUID() })).json().error).toBe('invalid_input');
  });

  // ---------------------------------------------------------------- disputes (#21)
  const dispute = (m: Awaited<ReturnType<typeof member>>, memberNumber: string, details?: string) =>
    m.as('POST', '/api/me/member-number-dispute', { memberNumber, ...(details ? { details } : {}) });

  it('a dispute goes to the admin queue and flags the unverified holder', async () => {
    const holder = await member('holder');
    await holder.as('PATCH', '/api/me', { memberNumber: 'ABT5/777/23' });
    const owner = await member('real.owner');
    const res = await dispute(owner, 'abt5-777/23', 'This is my reg number, see my ID.');
    expect([res.statusCode, res.json()]).toEqual([202, { received: true }]);
    const row = (await client.query('select member_number_normalised, reporter_user_id, details, status from member_number_disputes where reporter_user_id = $1', [owner.id])).rows[0];
    expect(row).toEqual({ member_number_normalised: 'ABT5777/23', reporter_user_id: owner.id, details: 'This is my reg number, see my ID.', status: 'open' });
    expect((await client.query('select 1 from users where id = $1', [holder.id])).rows).toHaveLength(1);
    expect((await holder.as('GET', '/api/me')).json().memberNumberStatus).toBe('unverified');   // normalised differently: ABT5/777/23
    await dispute(owner, 'ABT5/777/23');
    expect((await holder.as('GET', '/api/me')).json().memberNumberStatus).toBe('disputed');
  });

  it('an admin-verified holder stays verified; nobody learns whether a number is held', async () => {
    const holder = await member('verified.holder');
    await holder.as('PATCH', '/api/me', { memberNumber: 'ABT5/888/23' });
    await client.query(`update users set member_number_status = 'verified' where id = $1`, [holder.id]);
    const claimer = await member('claimer');
    const held = await dispute(claimer, 'ABT5/888/23');
    const free = await dispute(claimer, 'ABT5/999/23');
    expect([held.statusCode, held.body]).toEqual([free.statusCode, free.body]);
    expect((await holder.as('GET', '/api/me')).json().memberNumberStatus).toBe('verified');
  });

  it('refuses your own number, nonsense, and more than 3 disputes a day', async () => {
    const m = await member('disputer');
    await m.as('PATCH', '/api/me', { memberNumber: 'ABT5/1/23' });
    expect((await dispute(m, 'abt5/1/23')).json().error).toBe('invalid_input');
    expect((await dispute(m, 'nope')).json().error).toBe('invalid_input');
    for (let i = 2; i <= 4; i++) expect((await dispute(m, `ABT5/${i}/23`)).statusCode).toBe(202);
    const fourth = await dispute(m, 'ABT5/5/23');
    expect([fourth.statusCode, fourth.json().error]).toEqual([429, 'rate_limited']);
  });

  // ---------------------------------------------------------------- public profile (#21)
  it('a public profile shows public fields only: never email or member number', async () => {
    const them = await member('public.person');
    await them.as('PATCH', '/api/me', onboarding);
    await client.query(`insert into roles (user_id, role) values ($1, 'student_leader')`, [them.id]);
    const me = await member('looker');
    const res = await me.as('GET', `/api/users/${them.id}`);
    expect(res.json()).toEqual({
      id: them.id, name: 'Wanjiru M.', photoUrl: null, memberType: 'fresher', course: 'BSc Computer Science',
      yearOfStudy: 1, graduationYear: null, badges: ['Student Leader'], isFollowing: false,
    });
    expect(res.body).not.toContain('@');
    expect(res.body).not.toContain('09919');
  });

  it('404 for blocked (either way), deleted, other-campus and made-up members', async () => {
    const me = await member('viewer');
    const blockedByMe = await member('blocked.by.me');
    const blocksMe = await member('blocks.me');
    const gone = await member('gone.member');
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1)', [me.id, blockedByMe.id, blocksMe.id]);
    await client.query('update users set email = null, deleted_at = now() where id = $1', [gone.id]);
    const other = (await client.query<{ id: string }>(`insert into campuses (slug, name) values ('profile-test', 'Elsewhere') returning id`)).rows[0]!.id;
    const far = (await client.query<{ id: string }>(`insert into users (campus_id, email, member_type) values ($1, 'far@elsewhere.example', 'continuing') returning id`, [other])).rows[0]!.id;
    for (const id of [blockedByMe.id, blocksMe.id, gone.id, far, randomUUID(), 'not-a-uuid']) {
      const res = await me.as('GET', `/api/users/${id}`);
      expect([res.statusCode, res.json().error], id).toEqual([404, 'not_found']);
    }
  });

  // ---------------------------------------------------------------- delete account (#21)
  it('needs { confirm: "DELETE" }', async () => {
    const m = await member('hesitant');
    for (const body of [{}, { confirm: 'delete' }, { confirm: 'DELETE', reason: 'x' }]) {
      expect((await m.as('DELETE', '/api/me', body)).json().error).toBe('invalid_input');
    }
    expect((await m.as('GET', '/api/me')).statusCode).toBe(200);
  });

  it('deletes personal data and files, signs out everywhere, keeps posts as "Deleted member"', async () => {
    const m = await member('leaving');
    await m.as('PATCH', '/api/me', { ...onboarding, memberNumber: 'ABT5/4242/23' });
    const photo = await uploadedImage(m.id);
    await m.as('PATCH', '/api/me', { photoImageId: photo });
    const postImage = await uploadedImage(m.id);
    const post = (await client.query<{ id: string }>(
      `insert into posts (campus_id, author_user_id, body, image_id) values ($1, $2, 'my last post', $3) returning id`, [campusId, m.id, postImage])).rows[0]!.id;
    const friend = await member('friend');
    await client.query('insert into likes (user_id, post_id) values ($1, $2)', [m.id, post]);
    await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [friend.id, m.id]);
    await client.query(`insert into roles (user_id, role) values ($1, 'student_leader')`, [m.id]);
    const otherSession = await createSession(client, m.id, { userAgent: 'laptop', ip: '10.7.0.2' });
    expect(await classGroupsOf(m.id)).toHaveLength(1);

    const res = await m.as('DELETE', '/api/me', { confirm: 'DELETE' });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'hatua_session')!.value).toBe('');

    const u = (await client.query('select * from users where id = $1', [m.id])).rows[0];
    expect(u.deleted_at).not.toBeNull();
    for (const col of ['email', 'name', 'photo_url', 'photo_image_id', 'course', 'year_of_study', 'graduation_year', 'member_number', 'member_number_normalised', 'is_under_18']) {
      expect(u[col], col).toBeNull();
    }
    expect((await client.query('select 1 from images where user_id = $1', [m.id])).rows).toHaveLength(0);
    expect((await client.query('select body, image_id from posts where id = $1', [post])).rows[0]).toEqual({ body: 'my last post', image_id: null });
    expect((await client.query('select 1 from likes where user_id = $1', [m.id])).rows).toHaveLength(0);
    expect((await client.query('select 1 from blocks where blocked_id = $1', [m.id])).rows).toHaveLength(0);
    expect((await client.query('select 1 from roles where user_id = $1 and ends_at > clock_timestamp()', [m.id])).rows).toHaveLength(0);
    expect(await classGroupsOf(m.id)).toEqual([]);
    expect((await client.query('select 1 from sessions where user_id = $1 and revoked_at is null', [m.id])).rows).toHaveLength(0);

    expect((await m.as('GET', '/api/me')).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', cookies: { hatua_session: otherSession } })).statusCode).toBe(401);
    expect((await friend.as('GET', `/api/users/${m.id}`)).statusCode).toBe(404);

    // The email and the reg number are free again.
    const again = await member('leaving');
    expect((await again.as('PATCH', '/api/me', { memberNumber: 'ABT5/4242/23' })).statusCode).toBe(200);
  });

  it('a suspended member can still delete their account', async () => {
    const m = await member('suspended.leaver');
    await client.query(`update users set suspended_at = now() where id = $1`, [m.id]);
    expect((await m.as('GET', '/api/me')).statusCode).toBe(403);
    expect((await m.as('DELETE', '/api/me', { confirm: 'DELETE' })).statusCode).toBe(204);
  });
});
