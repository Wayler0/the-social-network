import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedId } from './seed.js';
import { notBlocked, visibleAnswer, visibleComment, visibleGroup, visiblePost, visibleQuestion, type ViewerSql } from './visibility.js';

describe('visibility helpers refuse anything that is not code', () => {
  const v: ViewerSql = { id: '$1', campusId: '$2' };
  it('rejects values in place of placeholders', () => {
    expect(() => visiblePost('p', { id: "'x'", campusId: '$2' })).toThrow();
    expect(() => visiblePost('p', { id: '$1', campusId: '1 or 1=1' })).toThrow();
  });
  it('rejects odd identifiers', () => {
    expect(() => notBlocked('p.user_id; drop table users', v)).toThrow();
    expect(() => visibleGroup('g)', v)).toThrow();
  });
});

/**
 * Against the development seed data (npm run seed), each test inside a rolled-back transaction.
 * Run with: npm run test:db -w apps/api
 */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const P = (key: string) => seedId(`post:${key}`);
const G = (key: string) => seedId(`group:${key}`);
const V: ViewerSql = { id: '$1', campusId: '$2' };

describe.skipIf(!url)('visibility rules (real database, seed data)', () => {
  let db: pg.Client;
  let campus: string;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    campus = (await db.query<{ campus_id: string }>('select campus_id from users where id = $1', [U('cynthia')])).rows[0]!.campus_id;
  });
  afterAll(async () => { await db.end(); });
  beforeEach(async () => { await db.query('begin'); });
  afterEach(async () => { await db.query('rollback'); });

  const canSee = async (who: string, table: string, cond: string, id: string, viewerCampus = campus) =>
    (await db.query(`select 1 from ${table} t where t.id = $3 and $2::uuid is not null and ${cond}`, [U(who), viewerCampus, id])).rows.length === 1;
  const seesPost = (who: string, id: string) => canSee(who, 'posts', visiblePost('t', V), id);
  const seesGroup = (who: string, id: string) => canSee(who, 'groups', visibleGroup('t', V), id);

  async function postBy(author: string, groupId: string | null = null): Promise<string> {
    return (await db.query<{ id: string }>(
      `insert into posts (campus_id, author_user_id, group_id, body) values ($1, $2, $3, 'visibility test') returning id`,
      [campus, U(author), groupId])).rows[0]!.id;
  }

  it('shows an ordinary campus post to everyone on the campus', async () => {
    expect(await seesPost('felix', P('feed:0'))).toBe(true);
    expect(await seesPost('amina', P('feed:0'))).toBe(true);
  });

  it('never shows hidden or deleted posts, even to their author', async () => {
    for (const key of ['spam', 'modhide']) expect(await seesPost('ivy', P(key)), key).toBe(false);
    expect(await seesPost('david', P('deleted'))).toBe(false);
  });

  it('keeps posts by a deleted account', async () => {
    expect(await seesPost('cynthia', P('gone'))).toBe(true);
  });

  it('hides posts both ways when one member blocked the other (brian blocked ivy)', async () => {
    const byIvy = await postBy('ivy');
    const byBrian = await postBy('brian');
    expect(await seesPost('brian', byIvy)).toBe(false);
    expect(await seesPost('ivy', byBrian)).toBe(false);
    expect(await seesPost('cynthia', byIvy)).toBe(true);
  });

  it('never shows another campus\'s posts', async () => {
    const other = (await db.query<{ id: string }>(`insert into campuses (slug, name) values ('vis-test', 'Other') returning id`)).rows[0]!.id;
    expect(await canSee('cynthia', 'posts', visiblePost('t', V), P('feed:0'), other)).toBe(false);
  });

  it('shows group posts only to active members', async () => {
    expect(await seesPost('cynthia', P('chess1'))).toBe(true);                 // club admin
    const outsider = (await db.query(`select 1 from group_members where group_id = $1 and user_id = $2`, [G('chess'), U('felix')])).rows.length === 0;
    expect(outsider).toBe(true);
    expect(await seesPost('felix', P('chess1'))).toBe(false);
    await db.query(`insert into group_members (group_id, user_id, status) values ($1, $2, 'pending')`, [G('chess'), U('felix')]);
    expect(await seesPost('felix', P('chess1'))).toBe(false);                 // pending is not enough
    await db.query(`update group_members set status = 'active' where group_id = $1 and user_id = $2`, [G('chess'), U('felix')]);
    expect(await seesPost('felix', P('chess1'))).toBe(true);
  });

  it('never shows a student-only group or its posts to staff, even a staff member added by mistake', async () => {
    expect(await seesGroup('grace', G('study'))).toBe(true);
    expect(await seesGroup('cynthia', G('study'))).toBe(true);                 // students can find it
    expect(await seesGroup('felix', G('study'))).toBe(false);
    await db.query(`insert into group_members (group_id, user_id, status) values ($1, $2, 'active')`, [G('study'), U('felix')]);
    expect(await seesPost('felix', P('study1'))).toBe(false);
    expect(await seesPost('grace', P('study1'))).toBe(true);
  });

  it('applies hidden, deleted and block rules to comments, questions and answers', async () => {
    expect(await canSee('cynthia', 'comments', visibleComment('t', V), seedId('comment:1'))).toBe(true);
    expect(await canSee('cynthia', 'comments', visibleComment('t', V), seedId('comment:6'))).toBe(false); // hidden
    expect(await canSee('ivy', 'comments', visibleComment('t', V), seedId('comment:1'))).toBe(false);     // by brian, who blocked ivy

    expect(await canSee('cynthia', 'questions', visibleQuestion('t', V), seedId('question:hidden'))).toBe(false);
    expect(await canSee('cynthia', 'questions', visibleQuestion('t', V), seedId('question:hostel'))).toBe(true);

    expect(await canSee('cynthia', 'answers', visibleAnswer('t', V), seedId('answer:hostel1'))).toBe(true);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [U('david'), U('cynthia')]);
    expect(await canSee('cynthia', 'answers', visibleAnswer('t', V), seedId('answer:hostel1'))).toBe(false);
  });
});
