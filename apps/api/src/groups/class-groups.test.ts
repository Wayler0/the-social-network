import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { classGroupName, normaliseCourse, syncClassGroup } from './class-groups.js';

describe('course names', () => {
  it('ignores extra spaces', () => {
    expect(normaliseCourse('  BSc   Computer\tScience ')).toBe('BSc Computer Science');
  });
  it('builds the group name, shortening a very long course to fit 120 characters', () => {
    expect(classGroupName('BSc Computer Science', 1)).toBe('BSc Computer Science — Year 1');
    const long = classGroupName('Bachelor of Science in '.padEnd(120, 'x'), 4);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('… — Year 4')).toBe(true);
  });
});

/**
 * The rest runs against a real PostgreSQL with the migrations applied, because the behaviour
 * that matters (unique index, upsert, concurrent sign-ups) lives in the database.
 * Set TEST_DATABASE_URL to run it; CI does, in the database job. Each test rolls back, so the
 * database is left exactly as it was.
 */
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('syncClassGroup (real database)', () => {
  let db: pg.Client;
  let campus: string;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    campus = (await db.query<{ id: string }>(`select id from campuses where status = 'active' order by created_at limit 1`)).rows[0]!.id;
  });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => { await db.query('begin'); });
  afterEach(async () => { await db.query('rollback'); });

  let n = 0;
  async function member(type: string, course: string | null, year: number | null, client: pg.Client = db) {
    const { rows } = await client.query<{ id: string }>(
      `insert into users (campus_id, email, member_type, course, year_of_study) values ($1, $2, $3, $4, $5) returning id`,
      [campus, `classgroup-test-${process.pid}-${++n}@example.org`, type, course, year],
    );
    return rows[0]!.id;
  }
  const membership = async (userId: string) =>
    (await db.query<{ group_id: string; status: string; name: string; visibility: string }>(
      `select m.group_id, m.status, g.name, g.visibility from group_members m join groups g on g.id = m.group_id
        where m.user_id = $1 and g.auto_type = 'course_year'`, [userId])).rows;

  it('creates the class group for the first member and reuses it for classmates', async () => {
    const a = await member('fresher', 'BSc Test Science', 1);
    const first = await syncClassGroup(db, a);
    expect(first).toMatchObject({ created: true, left: [] });
    expect(await membership(a)).toEqual([{ group_id: first.groupId, status: 'active', name: 'BSc Test Science — Year 1', visibility: 'private' }]);

    const b = await member('fresher', '  bsc   test SCIENCE ', 1); // same course, typed differently
    const second = await syncClassGroup(db, b);
    expect(second).toMatchObject({ groupId: first.groupId, created: false, left: [] });
  });

  it('is safe to call repeatedly', async () => {
    const a = await member('continuing', 'BSc Test Science', 2);
    const once = await syncClassGroup(db, a);
    const twice = await syncClassGroup(db, a);
    expect(twice).toEqual({ groupId: once.groupId, created: false, left: [] });
    expect(await membership(a)).toHaveLength(1);
  });

  it('moves a member when their year or course changes', async () => {
    const a = await member('fresher', 'BSc Test Science', 1);
    const year1 = await syncClassGroup(db, a);
    await db.query(`update users set year_of_study = 2, member_type = 'continuing' where id = $1`, [a]);
    const year2 = await syncClassGroup(db, a);
    expect(year2.groupId).not.toBe(year1.groupId);
    expect(year2.left).toEqual([year1.groupId]);
    expect((await membership(a)).map((m) => m.name)).toEqual(['BSc Test Science — Year 2']);

    await db.query(`update users set course = 'BCom Test' where id = $1`, [a]);
    const moved = await syncClassGroup(db, a);
    expect(moved.left).toEqual([year2.groupId]);
    expect((await membership(a)).map((m) => m.name)).toEqual(['BCom Test — Year 2']);
  });

  it('takes a member out when they become an alumnus, and never adds staff or unfinished profiles', async () => {
    const a = await member('continuing', 'BSc Test Science', 4);
    const before = await syncClassGroup(db, a);
    await db.query(`update users set member_type = 'alumni', year_of_study = null, graduation_year = 2026 where id = $1`, [a]);
    expect(await syncClassGroup(db, a)).toEqual({ groupId: null, created: false, left: [before.groupId] });
    expect(await membership(a)).toEqual([]);

    for (const id of [await member('staff', 'BSc Test Science', 1), await member('fresher', null, null), await member('fresher', '   ', 1), await member('fresher', 'BSc Test Science', null)]) {
      expect(await syncClassGroup(db, id)).toEqual({ groupId: null, created: false, left: [] });
    }
  });

  it('leaves clubs and ordinary groups alone', async () => {
    const a = await member('fresher', 'BSc Test Science', 1);
    const club = (await db.query<{ id: string }>(`insert into groups (campus_id, name, kind) values ($1, 'Test Club', 'club') returning id`, [campus])).rows[0]!.id;
    await db.query(`insert into group_members (group_id, user_id, role) values ($1, $2, 'admin')`, [club, a]);
    await syncClassGroup(db, a);
    await db.query(`update users set member_type = 'alumni' where id = $1`, [a]);
    await syncClassGroup(db, a);
    const left = await db.query(`select role from group_members where user_id = $1 and group_id = $2`, [a, club]);
    expect(left.rows).toEqual([{ role: 'admin' }]);
  });

  it('turns a stale pending row into an active membership', async () => {
    const a = await member('fresher', 'BSc Test Science', 1);
    const b = await member('fresher', 'BSc Test Science', 1);
    const { groupId } = await syncClassGroup(db, a);
    await db.query(`insert into group_members (group_id, user_id, status) values ($1, $2, 'pending')`, [groupId, b]);
    await syncClassGroup(db, b);
    expect((await membership(b))[0]!.status).toBe('active');
  });

  it('keeps campuses apart: the same course on another campus gets its own group', async () => {
    const other = (await db.query<{ id: string }>(`insert into campuses (slug, name) values ('classgroup-test', 'Test Campus') returning id`)).rows[0]!.id;
    const a = await member('fresher', 'BSc Test Science', 1);
    const b = (await db.query<{ id: string }>(
      `insert into users (campus_id, email, member_type, course, year_of_study) values ($1, 'classgroup-other@example.org', 'fresher', 'BSc Test Science', 1) returning id`, [other])).rows[0]!.id;
    const here = await syncClassGroup(db, a);
    const there = await syncClassGroup(db, b);
    expect(there.created).toBe(true);
    expect(there.groupId).not.toBe(here.groupId);
  });

  it('fails loudly for an unknown user', async () => {
    await expect(syncClassGroup(db, '00000000-0000-4000-8000-000000000000')).rejects.toThrow(/no user/);
  });

  it('gives two classmates who sign up at the same moment one shared group', async () => {
    // Needs real, separate transactions, so this test commits and then cleans up after itself.
    await db.query('rollback');
    const one = new pg.Client({ connectionString: url });
    const two = new pg.Client({ connectionString: url });
    await Promise.all([one.connect(), two.connect()]);
    const course = `Race Test ${process.pid}`;
    let ids: string[] = [];
    try {
      ids = [await member('fresher', course, 1, one), await member('fresher', course, 1, two)];
      await Promise.all([one.query('begin'), two.query('begin')]);
      // Both start together. Whichever insert lands second waits inside the database until the
      // first transaction commits, then must find the winner's group instead of making its own.
      const run = async (client: pg.Client, id: string) => {
        try {
          const result = await syncClassGroup(client, id);
          await client.query('commit');
          return result;
        } catch (err) {
          await client.query('rollback');
          throw err;
        }
      };
      const [r1, r2] = await Promise.all([run(one, ids[0]!), run(two, ids[1]!)]);
      expect(r1.groupId).toBe(r2.groupId);
      expect([r1.created, r2.created].filter(Boolean)).toHaveLength(1);
      const groups = await db.query(`select count(*)::int as n from groups where auto_course = $1`, [course]);
      expect(groups.rows[0]!.n).toBe(1);
    } finally {
      await db.query(`delete from groups where auto_course = $1`, [course]);
      if (ids.length) await db.query(`delete from users where id = any($1::uuid[])`, [ids]);
      await Promise.all([one.end(), two.end()]);
      await db.query('begin'); // so afterEach's rollback has something to end
    }
  });
});
