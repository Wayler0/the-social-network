import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createSession } from '../auth/sessions.js';
import { loadConfig } from '../config.js';
import { seed, seedId } from '../seed.js';
import { rollbackPool } from '../testing/rollback-pool.js';
import { notify, queueUrgentAnnouncement } from './notify.js';
import { runPushWorker, type PushMessage, type PushSender, type Subscription } from './push.js';

/** Notifications and push against the seed data (npm run test:db -w apps/api); each test rolled back. */
const url = process.env.TEST_DATABASE_URL;
const U = (key: string) => seedId(`user:${key}`);
const G = (key: string) => seedId(`group:${key}`);
const O = (key: string) => seedId(`office:${key}`);
const P = (key: string) => seedId(`post:${key}`);
const Q = (key: string) => seedId(`question:${key}`);

// A valid-looking VAPID pair (format only; the tests never talk to a real push service).
const VAPID = {
  VAPID_PUBLIC_KEY: 'B' + 'A'.repeat(86),
  VAPID_PRIVATE_KEY: 'A'.repeat(43),
  VAPID_SUBJECT: 'mailto:team@example.org',
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

describe.skipIf(!url)('Notifications and push (real database, seed data)', () => {
  let client: pg.Client;
  let app: FastifyInstance;
  let mediaDir: string;
  const tokens = new Map<string, string>();

  beforeAll(async () => {
    mediaDir = await mkdtemp(path.join(tmpdir(), 'hatua-notifications-'));
    client = new pg.Client({ connectionString: url });
    await client.connect();
    app = buildApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: url!, MEDIA_DIR: mediaDir, ...VAPID }), rollbackPool(client));
    await app.ready();
  });
  afterAll(async () => { await app.close(); await client.end(); await rm(mediaDir, { recursive: true, force: true }); });
  beforeEach(async () => { await client.query('begin'); await seed(client, { mediaDir }); tokens.clear(); });
  afterEach(async () => { await client.query('rollback'); });

  async function as(who: string, method: Method, url: string, payload?: object) {
    let token = tokens.get(who);
    if (!token) { token = await createSession(client, U(who), { userAgent: 'test', ip: '10.12.0.1' }); tokens.set(who, token); }
    return app.inject({ method, url, cookies: { hatua_session: token }, ...(payload ? { payload } : {}) });
  }
  const inbox = async (who: string) => (await as(who, 'GET', '/api/notifications')).json();
  const subscribe = (who: string, n = 1) => as(who, 'PUT', '/api/push/subscriptions',
    { endpoint: `https://push.example.org/${who}/${n}`, keys: { p256dh: `p256-${who}-${n}`, auth: `auth-${who}-${n}` } });
  const outbox = async (who: string) => (await client.query<{ kind: string; title: string; body: string; url: string; sent_at: Date | null; attempts: number }>(
    'select kind, title, body, url, sent_at, attempts from push_outbox where user_id = $1 order by created_at', [U(who)])).rows;
  const comment = (who: string, post: string, body = 'Nice one') => as(who, 'POST', `/api/posts/${P(post)}/comments`, { body });

  describe('inbox', () => {
    it('a comment notifies the post author with a link that opens the post', async () => {
      expect((await comment('amina', 'photo')).statusCode).toBe(201);
      const res = await inbox('cynthia');
      expect(res.unreadCount).toBe(1);
      expect(res.items).toEqual([expect.objectContaining({
        type: 'comment', count: 1, read: false, text: 'New comment on your post',
        actor: expect.objectContaining({ id: U('amina') }),
        target: { type: 'post', id: P('photo') }, url: `/post/${P('photo')}`,
      })]);
    });

    it('a burst of comments collapses into one unread notification with a count and the latest actor', async () => {
      await comment('amina', 'photo');
      await comment('brian', 'photo');
      await comment('amina', 'photo', 'Again');
      const res = await inbox('cynthia');
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ count: 3, actor: { id: U('amina') } });

      // Once read, the next comment starts a fresh notification.
      await as('cynthia', 'POST', '/api/notifications/read', { all: true });
      await comment('brian', 'photo');
      const after = await inbox('cynthia');
      expect(after.unreadCount).toBe(1);
      expect(after.items.map((n: { count: number; read: boolean }) => [n.count, n.read])).toEqual([[1, false], [3, true]]);
    });

    it('never notifies you about your own action', async () => {
      await comment('cynthia', 'photo');
      expect((await inbox('cynthia')).items).toEqual([]);
    });

    it('nothing across a block, either way; an actor blocked later is no longer shown', async () => {
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('cynthia'), U('david')]);
      await comment('david', 'photo').catch(() => undefined);
      expect((await inbox('cynthia')).items).toEqual([]);

      await comment('amina', 'photo');
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [U('amina'), U('cynthia')]);
      const res = await inbox('cynthia');
      expect(res.items).toHaveLength(1);
      expect(res.items[0].actor).toBeNull();
    });

    it('an answer notifies the asker, even when the question hides their name', async () => {
      expect((await as('cynthia', 'POST', `/api/questions/${Q('open')}/answers`, { body: 'Yes, it gets better.' })).statusCode).toBe(201);
      expect((await inbox('brian')).items).toEqual([expect.objectContaining({
        type: 'answer', target: { type: 'question', id: Q('open') }, url: `/ask/${Q('open')}`,
      })]);
    });

    it('following a member notifies them; following again does not add a second one', async () => {
      await as('amina', 'PUT', `/api/follows/user/${U('cynthia')}`);
      await as('amina', 'PUT', `/api/follows/user/${U('cynthia')}`);
      const res = await inbox('cynthia');
      expect(res.items).toEqual([expect.objectContaining({ type: 'follow', count: 1, actor: expect.objectContaining({ id: U('amina') }) })]);
      // Following an office or a club notifies nobody.
      await as('amina', 'PUT', `/api/follows/office/${O('library')}`);
      await as('amina', 'PUT', `/api/follows/group/${G('chess')}`);
      expect((await inbox('felix')).items).toEqual([]);
    });

    it('a join request notifies the group admins; approving notifies the member and clears the admins\' request', async () => {
      expect((await as('amina', 'PUT', `/api/groups/${G('roommates')}/membership`)).json()).toEqual({ status: 'pending' });
      expect((await inbox('david')).items).toEqual([expect.objectContaining({ type: 'group_request', target: { type: 'group', id: G('roommates') } })]);

      // brian is still waiting (seed), so the request stays unread after amina is approved.
      await as('david', 'POST', `/api/groups/${G('roommates')}/requests/${U('amina')}`, { approve: true });
      expect((await inbox('amina')).items).toEqual([expect.objectContaining({ type: 'group_approved', url: `/groups/${G('roommates')}` })]);
      expect((await inbox('david')).unreadCount).toBe(1);

      await as('david', 'POST', `/api/groups/${G('roommates')}/requests/${U('brian')}`, { approve: false });
      expect((await inbox('david')).unreadCount).toBe(0);
      expect((await inbox('brian')).items).toEqual([]);   // a refusal sends nothing
    });

    it('cancelling an event notifies everyone who said Going or Interested, once', async () => {
      const ev = (await as('cynthia', 'POST', '/api/events', { title: 'Chess night', startsAt: new Date(Date.now() + 48 * 3600_000).toISOString() })).json();
      await as('amina', 'PUT', `/api/events/${ev.id}/rsvp`, { status: 'going' });
      await as('brian', 'PUT', `/api/events/${ev.id}/rsvp`, { status: 'interested' });
      expect((await as('cynthia', 'PATCH', `/api/events/${ev.id}`, { cancelled: true })).statusCode).toBe(200);
      await as('cynthia', 'PATCH', `/api/events/${ev.id}`, { cancelled: true });   // already cancelled
      for (const who of ['amina', 'brian']) {
        expect((await inbox(who)).items).toEqual([expect.objectContaining({ type: 'event_cancelled', count: 1 })]);
      }
      expect((await inbox('cynthia')).items).toEqual([]);
    });

    it('skips deleted members', async () => {
      expect(await notify(client, 'Hatua', { type: 'follow', userIds: [U('gone')], actorId: U('amina'), targetId: U('amina') })).toBe(0);
    });

    it('pages newest first; marks chosen ids read; never touches someone else\'s', async () => {
      for (const who of ['amina', 'brian', 'david']) await as(who, 'PUT', `/api/follows/user/${U('cynthia')}`);
      await comment('amina', 'photo');
      const first = (await as('cynthia', 'GET', '/api/notifications?limit=2')).json();
      expect(first.items).toHaveLength(2);
      expect(first.items[0].type).toBe('comment');
      const second = (await as('cynthia', 'GET', `/api/notifications?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((n: { id: string }) => n.id)).size).toBe(4);

      const res = await as('cynthia', 'POST', '/api/notifications/read', { ids: [first.items[0].id] });
      expect(res.json()).toEqual({ unreadCount: 3 });
      // amina cannot mark cynthia's notification read.
      await as('amina', 'POST', '/api/notifications/read', { ids: [first.items[1].id] });
      expect((await inbox('cynthia')).unreadCount).toBe(3);
    });

    it('rejects bad input', async () => {
      expect((await as('cynthia', 'GET', '/api/notifications?cursor=nope')).statusCode).toBe(400);
      expect((await as('cynthia', 'POST', '/api/notifications/read', {})).statusCode).toBe(400);
      expect((await as('cynthia', 'POST', '/api/notifications/read', { ids: ['not-a-uuid'] })).statusCode).toBe(400);
      expect((await as('cynthia', 'POST', '/api/notifications/read', { all: false })).statusCode).toBe(400);
    });

    it('needs a session', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/notifications' })).statusCode).toBe(401);
    });
  });

  describe('push subscriptions and settings', () => {
    it('gives the public key; subscribes https endpoints only; unsubscribe is idempotent', async () => {
      expect((await as('amina', 'GET', '/api/push/key')).json()).toEqual({ publicKey: VAPID.VAPID_PUBLIC_KEY });
      expect((await subscribe('amina')).statusCode).toBe(204);
      expect((await subscribe('amina')).statusCode).toBe(204);   // same browser again
      const bad = await as('amina', 'PUT', '/api/push/subscriptions', { endpoint: 'http://push.example.org/x', keys: { p256dh: 'a', auth: 'b' } });
      expect(bad.statusCode).toBe(400);
      expect((await client.query('select 1 from push_subscriptions where user_id = $1', [U('amina')])).rowCount).toBe(1);

      const del = () => as('amina', 'DELETE', '/api/push/subscriptions', { endpoint: 'https://push.example.org/amina/1' });
      expect((await del()).statusCode).toBe(204);
      expect((await del()).statusCode).toBe(204);
      expect((await client.query('select 1 from push_subscriptions where user_id = $1', [U('amina')])).rowCount).toBe(0);
    });

    it('a browser someone else used moves to whoever subscribes now; only the newest 10 are kept', async () => {
      await subscribe('amina');
      await as('brian', 'PUT', '/api/push/subscriptions', { endpoint: 'https://push.example.org/amina/1', keys: { p256dh: 'x', auth: 'y' } });
      const owner = await client.query<{ user_id: string }>(`select user_id from push_subscriptions where endpoint = 'https://push.example.org/amina/1'`);
      expect(owner.rows.map((r) => r.user_id)).toEqual([U('brian')]);

      for (let i = 1; i <= 12; i++) await subscribe('cynthia', i);
      expect((await client.query('select 1 from push_subscriptions where user_id = $1', [U('cynthia')])).rowCount).toBe(10);
    });

    it('settings default to all on; PATCH changes only what it names', async () => {
      const all = { comments: true, answers: true, follows: true, groups: true, events: true, urgent: true };
      expect((await as('amina', 'GET', '/api/me/notification-settings')).json()).toEqual(all);
      expect((await as('amina', 'PATCH', '/api/me/notification-settings', { comments: false })).json()).toEqual({ ...all, comments: false });
      expect((await as('amina', 'GET', '/api/me/notification-settings')).json()).toEqual({ ...all, comments: false });
      expect((await as('amina', 'PATCH', '/api/me/notification-settings', { likes: false })).statusCode).toBe(400);
      expect((await as('amina', 'PATCH', '/api/me/notification-settings', { comments: 'no' })).statusCode).toBe(400);
    });
  });

  describe('push outbox', () => {
    it('queues one generic push per new notification, only with a subscription and the kind turned on', async () => {
      await comment('amina', 'photo');
      expect(await outbox('cynthia')).toEqual([]);   // no subscription yet

      await as('cynthia', 'POST', '/api/notifications/read', { all: true });
      await subscribe('cynthia');
      await comment('amina', 'photo');
      await comment('brian', 'photo');                // collapsed: no second push
      const rows = await outbox('cynthia');
      expect(rows).toEqual([expect.objectContaining({ kind: 'comments', body: 'New comment on your post', url: `/post/${P('photo')}` })]);
      // Generic: no names and no content on the lock screen.
      expect(JSON.stringify(rows)).not.toMatch(/Amina|Brian|Nice one/);

      await as('cynthia', 'POST', '/api/notifications/read', { all: true });
      await as('cynthia', 'PATCH', '/api/me/notification-settings', { comments: false });
      await comment('amina', 'photo');
      expect(await outbox('cynthia')).toHaveLength(1);
      expect((await inbox('cynthia')).unreadCount).toBe(1);   // the inbox still records
    });

    it('an urgent announcement pushes to the campus with its title; a normal one does not', async () => {
      for (const who of ['amina', 'brian', 'ivy']) await subscribe(who);
      await as('brian', 'PATCH', '/api/me/notification-settings', { urgent: false });
      const post = (urgency: string) => as('felix', 'POST', '/api/announcements',
        { officeId: O('dean'), title: `${urgency} notice`, body: 'Details.', urgency });

      expect((await post('normal')).statusCode).toBe(201);
      expect(await outbox('amina')).toEqual([]);

      expect((await post('urgent')).statusCode).toBe(201);
      expect(await outbox('amina')).toEqual([expect.objectContaining({ kind: 'urgent', body: 'urgent notice', url: '/today' })]);
      expect((await outbox('amina'))[0]!.title).toMatch(/^Urgent · /);
      expect(await outbox('brian')).toEqual([]);   // turned urgent off
      expect(await outbox('ivy')).toEqual([]);     // suspended
    });

    it('queueUrgentAnnouncement skips members of other campuses', async () => {
      await subscribe('amina');
      const other = await client.query<{ id: string }>(`insert into campuses (name, slug, status) values ('Other', 'other-test', 'active') returning id`);
      expect(await queueUrgentAnnouncement(client, 'Hatua', other.rows[0]!.id, 'x')).toBe(0);
    });
  });

  describe('push worker', () => {
    const fakeSender = (results: Record<string, 'ok' | 'gone' | 'retry'>) => {
      const sent: Array<{ sub: Subscription; msg: PushMessage }> = [];
      const sender: PushSender = { send: async (sub, msg) => { sent.push({ sub, msg }); return results[sub.endpoint] ?? 'ok'; } };
      return { sender, sent };
    };
    const queue = async (who: string) => {
      await client.query(`insert into push_outbox (user_id, kind, title, body, url) values ($1, 'comments', 'Hatua', 'Hi', '/')`, [U(who)]);
    };
    const subs = async (who: string) => (await client.query<{ endpoint: string; failures: number; last_success_at: Date | null }>(
      'select endpoint, failures, last_success_at from push_subscriptions where user_id = $1 order by endpoint', [U(who)])).rows;

    it('sends to every device, marks it sent, and does not send it again', async () => {
      await subscribe('amina', 1);
      await subscribe('amina', 2);
      await queue('amina');
      const { sender, sent } = fakeSender({});
      expect(await runPushWorker(rollbackPool(client), sender)).toBe(1);
      expect(sent.map((s) => s.sub.endpoint).sort()).toEqual(['https://push.example.org/amina/1', 'https://push.example.org/amina/2']);
      expect(sent[0]!.msg).toEqual({ title: 'Hatua', body: 'Hi', url: '/', tag: 'comments' });
      expect((await outbox('amina'))[0]!.sent_at).not.toBeNull();
      expect((await subs('amina')).every((s) => s.last_success_at !== null)).toBe(true);
      expect(await runPushWorker(rollbackPool(client), sender)).toBe(0);
    });

    it('drops a subscription the browser gave up (gone)', async () => {
      await subscribe('amina', 1);
      await subscribe('amina', 2);
      await queue('amina');
      const { sender } = fakeSender({ 'https://push.example.org/amina/1': 'gone' });
      await runPushWorker(rollbackPool(client), sender);
      expect((await subs('amina')).map((s) => s.endpoint)).toEqual(['https://push.example.org/amina/2']);
    });

    it('retries with back-off when no device got it; not when another device did', async () => {
      await subscribe('amina', 1);
      await queue('amina');
      const { sender } = fakeSender({ 'https://push.example.org/amina/1': 'retry' });
      await runPushWorker(rollbackPool(client), sender);
      const row = (await outbox('amina'))[0]!;
      expect([row.sent_at, row.attempts]).toEqual([null, 1]);
      expect((await subs('amina'))[0]!.failures).toBe(1);
      expect(await runPushWorker(rollbackPool(client), sender)).toBe(0);   // not due yet

      await client.query('delete from push_outbox');
      await subscribe('amina', 2);
      await queue('amina');
      await runPushWorker(rollbackPool(client), sender);
      expect((await outbox('amina'))[0]!.sent_at).not.toBeNull();
    });

    it('gives up after 5 attempts', async () => {
      await subscribe('amina', 1);
      await queue('amina');
      const { sender, sent } = fakeSender({ 'https://push.example.org/amina/1': 'retry' });
      for (let i = 0; i < 5; i++) {
        await client.query('update push_outbox set next_attempt_at = now() - interval \'1 second\'');
        await runPushWorker(rollbackPool(client), sender);
      }
      expect(sent).toHaveLength(5);
      const row = (await outbox('amina'))[0]!;
      expect(row.sent_at).not.toBeNull();
      expect(row.attempts).toBe(5);
    });
  });

  describe('account deletion and export', () => {
    it('export includes notifications, devices and settings', async () => {
      await comment('amina', 'photo');
      await subscribe('cynthia');
      await as('cynthia', 'PATCH', '/api/me/notification-settings', { follows: false });
      const data = (await as('cynthia', 'GET', '/api/me/export')).json();
      expect(data.notifications).toEqual([expect.objectContaining({ type: 'comment', target: { type: 'post', id: P('photo') } })]);
      expect(data.pushDevices).toEqual([expect.objectContaining({ since: expect.any(String), lastDelivered: null })]);
      expect(data.notificationSettings).toEqual({ follows: false });
    });

    it('deleting an account removes their notifications, devices and queued pushes, and their name as an actor', async () => {
      await subscribe('cynthia');
      await comment('amina', 'photo');
      await as('cynthia', 'PUT', `/api/follows/user/${U('brian')}`);
      expect((await as('cynthia', 'DELETE', '/api/me', { confirm: 'DELETE' })).statusCode).toBe(204);
      for (const table of ['notifications', 'push_subscriptions', 'push_outbox']) {
        expect((await client.query(`select 1 from ${table} where user_id = $1`, [U('cynthia')])).rowCount, table).toBe(0);
      }
      expect((await client.query('select 1 from notifications where actor_user_id = $1', [U('cynthia')])).rowCount).toBe(0);
      expect((await inbox('brian')).items[0].actor).toBeNull();
    });
  });
});
