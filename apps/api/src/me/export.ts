import type { Queryable } from '../images/store.js';
import { imageUrls } from '../images/store.js';
import { loadMe, meBody } from './profile.js';

/**
 * Everything we hold about one member, for GET /api/me/export (Data Protection Act 2019: right of
 * access and data portability; CLAUDE.md sections 4 and 10).
 *
 * Included: profile (with email and member number), account dates and any suspension, roles and
 * office memberships (history too), groups, everything they wrote (also what they deleted or what
 * moderators hid, which we still keep), likes, helpful votes, announcements they posted, whom they
 * follow and who follows them, people they blocked, reports and disputes they made, sign-in sessions, and their uploaded images.
 *
 * Not included, on purpose: reports other members made about them (protects reporters), who
 * blocked them, and other members' content. Sign-in codes are stored only as hashes and deleted
 * within 24 hours. When adding a table that holds personal data, add it here too.
 */
export async function exportMemberData(db: Queryable, userId: string, appName: string) {
  const me = await loadMe(db, userId);
  if (!me) return null;
  const q = async <T extends Record<string, unknown>>(sql: string) => (await db.query<T>(sql, [userId])).rows;
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  const [account] = await q<{ created_at: Date; verified: boolean; verified_method: string | null;
    suspended_at: Date | null; suspended_until: Date | null; suspended_reason: string | null }>(
    'select created_at, verified, verified_method, suspended_at, suspended_until, suspended_reason from users where id = $1');

  const roles = await q<{ role: string; title: string | null; starts_at: Date; ends_at: Date | null }>(
    'select role, title, starts_at, ends_at from roles where user_id = $1 order by starts_at');
  const offices = await q<{ id: string; name: string; role: string; starts_at: Date; ends_at: Date | null }>(
    `select o.id, o.name, m.role, m.starts_at, m.ends_at
       from office_members m join office_accounts o on o.id = m.office_id
      where m.user_id = $1 order by m.starts_at`);
  const groups = await q<{ id: string; name: string; role: string; status: string; joined_at: Date }>(
    `select g.id, g.name, gm.role, gm.status, gm.joined_at
       from group_members gm join groups g on g.id = gm.group_id
      where gm.user_id = $1 order by gm.joined_at`);

  const posts = await q<{ id: string; body: string; group_id: string | null; group_name: string | null; office_name: string | null;
    image_path: string | null; created_at: Date; hidden_at: Date | null; deleted_at: Date | null }>(
    `select p.id, p.body, p.group_id, g.name as group_name, o.name as office_name, i.path as image_path,
            p.created_at, p.hidden_at, p.deleted_at
       from posts p left join groups g on g.id = p.group_id
                    left join office_accounts o on o.id = p.author_office_id
                    left join images i on i.id = p.image_id
      where p.author_user_id = $1 order by p.created_at`);
  const comments = await q<{ id: string; post_id: string; body: string; created_at: Date; hidden_at: Date | null; deleted_at: Date | null }>(
    'select id, post_id, body, created_at, hidden_at, deleted_at from comments where user_id = $1 order by created_at');
  const likes = await q<{ post_id: string; reaction: string; created_at: Date }>(
    'select post_id, reaction, created_at from likes where user_id = $1 order by created_at');
  const saved = await q<{ post_id: string; created_at: Date }>(
    'select post_id, created_at from saved_posts where user_id = $1 order by created_at');
  const questions = await q<{ id: string; body: string; hide_name: boolean; created_at: Date; hidden_at: Date | null; deleted_at: Date | null }>(
    'select id, body, hide_name, created_at, hidden_at, deleted_at from questions where user_id = $1 order by created_at');
  const answers = await q<{ id: string; question_id: string; body: string; created_at: Date; hidden_at: Date | null; deleted_at: Date | null }>(
    'select id, question_id, body, created_at, hidden_at, deleted_at from answers where user_id = $1 order by created_at');
  const helpful = await q<{ answer_id: string; created_at: Date }>(
    'select answer_id, created_at from answer_helpful where user_id = $1 order by created_at');
  const announcements = await q<{ id: string; office_name: string; title: string; body: string; urgency: string;
    pinned_until: Date | null; created_at: Date }>(
    `select a.id, o.name as office_name, a.title, a.body, a.urgency, a.pinned_until, a.created_at
       from announcements a join office_accounts o on o.id = a.office_id
      where a.created_by = $1 order by a.created_at`);

  const blocks = await q<{ id: string; name: string | null; created_at: Date }>(
    `select u.id, u.name, b.created_at from blocks b join users u on u.id = b.blocked_id
      where b.blocker_id = $1 order by b.created_at`);
  const following = await q<{ target_type: string; target_id: string; name: string | null; created_at: Date }>(
    `select f.target_type, f.target_id, coalesce(u.name, o.name, g.name) as name, f.created_at
       from follows f
       left join users u on f.target_type = 'user' and u.id = f.target_id
       left join office_accounts o on f.target_type = 'office' and o.id = f.target_id
       left join groups g on f.target_type = 'group' and g.id = f.target_id
      where f.follower_id = $1 order by f.created_at`);
  const followers = await q<{ id: string; name: string | null; created_at: Date }>(
    `select u.id, u.name, f.created_at from follows f join users u on u.id = f.follower_id
      where f.target_type = 'user' and f.target_id = $1 and u.deleted_at is null order by f.created_at`);
  const stories = await q<{ id: string; body: string | null; image_path: string | null; audience: string; office_name: string | null;
    group_name: string | null; created_at: Date; expires_at: Date; hidden_at: Date | null; deleted_at: Date | null; view_count: number }>(
    `select s.id, s.body, i.path as image_path, s.audience, o.name as office_name, g.name as group_name,
            s.created_at, s.expires_at, s.hidden_at, s.deleted_at,
            (select count(*) from story_views v where v.story_id = s.id)::int as view_count
       from stories s left join images i on i.id = s.image_id
                      left join office_accounts o on o.id = s.author_office_id
                      left join groups g on g.id = s.author_group_id
      where s.author_user_id = $1 order by s.created_at`);
  const events = await q<{ id: string; title: string; description: string | null; location: string | null; starts_at: Date;
    ends_at: Date | null; cancelled_at: Date | null; created_at: Date; hidden_at: Date | null; deleted_at: Date | null }>(
    `select id, title, description, location, starts_at, ends_at, cancelled_at, created_at, hidden_at, deleted_at
       from events where created_by = $1 order by created_at`);
  const rsvps = await q<{ event_id: string; title: string; status: string; created_at: Date }>(
    `select r.event_id, e.title, r.status, r.created_at from event_rsvps r join events e on e.id = r.event_id
      where r.user_id = $1 order by r.created_at`);
  const notifications = await q<{ type: string; target_type: string; target_id: string; count: number; created_at: Date; read_at: Date | null }>(
    'select type, target_type, target_id, count, created_at, read_at from notifications where user_id = $1 order by created_at');
  const devices = await q<{ user_agent: string | null; created_at: Date; last_success_at: Date | null }>(
    'select user_agent, created_at, last_success_at from push_subscriptions where user_id = $1 order by created_at');
  const [prefs] = await q<{ notification_prefs: Record<string, unknown> }>('select notification_prefs from users where id = $1');
  const feedbackGiven = await q<{ rating: number; body: string | null; created_at: Date }>(
    'select rating, body, created_at from feedback where user_id = $1 order by created_at');
  const storiesViewed = await q<{ story_id: string; viewed_at: Date }>(
    'select story_id, viewed_at from story_views where viewer_id = $1 order by viewed_at');
  const closeFriends = await q<{ id: string; name: string | null }>(
    `select u.id, u.name from close_friends c join users u on u.id = c.friend_id where c.user_id = $1 order by c.created_at`);
  const storyHidden = await q<{ id: string; name: string | null }>(
    `select u.id, u.name from story_hidden_from h join users u on u.id = h.hidden_user_id where h.user_id = $1 order by h.created_at`);
  const reports = await q<{ target_type: string; target_id: string; reason: string; details: string | null; status: string; created_at: Date }>(
    'select target_type, target_id, reason, details, status, created_at from reports where reporter_id = $1 order by created_at');
  const disputes = await q<{ member_number_normalised: string; details: string | null; status: string; created_at: Date }>(
    `select member_number_normalised, details, status, created_at from member_number_disputes
      where reporter_user_id = $1 order by created_at`);
  const sessions = await q<{ created_at: Date; last_seen_at: Date; expires_at: Date; revoked_at: Date | null; user_agent: string | null; ip: string | null }>(
    'select created_at, last_seen_at, expires_at, revoked_at, user_agent, host(ip) as ip from sessions where user_id = $1 order by created_at');
  const images = await q<{ id: string; path: string; width: number; height: number; created_at: Date }>(
    'select id, path, width, height, created_at from images where user_id = $1 order by created_at');

  return {
    exportedAt: new Date().toISOString(),
    app: appName,
    about: 'Everything we hold about you. Not included: reports other members made about you (to protect them) '
      + 'and who blocked you. Sign-in codes are kept only as hashes and deleted within 24 hours.',
    profile: meBody(me),
    account: {
      createdAt: iso(account!.created_at), verified: account!.verified, verifiedMethod: account!.verified_method,
      suspension: account!.suspended_at
        ? { since: iso(account!.suspended_at), until: iso(account!.suspended_until), reason: account!.suspended_reason }
        : null,
    },
    roles: roles.map((r) => ({ role: r.role, title: r.title, startsAt: iso(r.starts_at), endsAt: iso(r.ends_at) })),
    offices: offices.map((o) => ({ id: o.id, name: o.name, role: o.role, startsAt: iso(o.starts_at), endsAt: iso(o.ends_at) })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, role: g.role, status: g.status, joinedAt: iso(g.joined_at) })),
    posts: posts.map((p) => ({
      id: p.id, body: p.body, group: p.group_id ? { id: p.group_id, name: p.group_name } : null, asOffice: p.office_name,
      imageUrl: p.image_path ? imageUrls(p.image_path).url : null,
      createdAt: iso(p.created_at), hiddenAt: iso(p.hidden_at), deletedAt: iso(p.deleted_at),
    })),
    comments: comments.map((c) => ({ id: c.id, postId: c.post_id, body: c.body, createdAt: iso(c.created_at), hiddenAt: iso(c.hidden_at), deletedAt: iso(c.deleted_at) })),
    likes: likes.map((l) => ({ postId: l.post_id, reaction: l.reaction, createdAt: iso(l.created_at) })),
    savedPosts: saved.map((s) => ({ postId: s.post_id, createdAt: iso(s.created_at) })),
    questions: questions.map((x) => ({ id: x.id, body: x.body, hideName: x.hide_name, createdAt: iso(x.created_at), hiddenAt: iso(x.hidden_at), deletedAt: iso(x.deleted_at) })),
    answers: answers.map((a) => ({ id: a.id, questionId: a.question_id, body: a.body, createdAt: iso(a.created_at), hiddenAt: iso(a.hidden_at), deletedAt: iso(a.deleted_at) })),
    helpfulVotes: helpful.map((h) => ({ answerId: h.answer_id, createdAt: iso(h.created_at) })),
    announcements: announcements.map((a) => ({ id: a.id, office: a.office_name, title: a.title, body: a.body, urgency: a.urgency,
      pinnedUntil: iso(a.pinned_until), createdAt: iso(a.created_at) })),
    stories: stories.map((s) => ({ id: s.id, body: s.body, imageUrl: s.image_path ? imageUrls(s.image_path).url : null, audience: s.audience,
      asOffice: s.office_name, asClub: s.group_name, createdAt: iso(s.created_at), expiresAt: iso(s.expires_at),
      hiddenAt: iso(s.hidden_at), deletedAt: iso(s.deleted_at), viewCount: s.view_count })),
    events: events.map((e) => ({ id: e.id, title: e.title, description: e.description, location: e.location,
      startsAt: iso(e.starts_at), endsAt: iso(e.ends_at), cancelledAt: iso(e.cancelled_at), createdAt: iso(e.created_at),
      hiddenAt: iso(e.hidden_at), deletedAt: iso(e.deleted_at) })),
    eventRsvps: rsvps.map((r) => ({ eventId: r.event_id, title: r.title, status: r.status, since: iso(r.created_at) })),
    notifications: notifications.map((n) => ({ type: n.type, target: { type: n.target_type, id: n.target_id }, count: n.count,
      createdAt: iso(n.created_at), readAt: iso(n.read_at) })),
    pushDevices: devices.map((d) => ({ device: d.user_agent, since: iso(d.created_at), lastDelivered: iso(d.last_success_at) })),
    notificationSettings: prefs?.notification_prefs ?? {},
    storiesViewed: storiesViewed.map((v) => ({ storyId: v.story_id, viewedAt: iso(v.viewed_at) })),
    feedback: feedbackGiven.map((f) => ({ rating: f.rating, body: f.body, createdAt: iso(f.created_at) })),
    closeFriends: closeFriends.map((c) => ({ id: c.id, name: c.name ?? 'Deleted member' })),
    storiesHiddenFrom: storyHidden.map((h) => ({ id: h.id, name: h.name ?? 'Deleted member' })),
    following: following.map((f) => ({ type: f.target_type, id: f.target_id, name: f.name, since: iso(f.created_at) })),
    followers: followers.map((f) => ({ id: f.id, name: f.name, since: iso(f.created_at) })),
    blocked: blocks.map((b) => ({ id: b.id, name: b.name ?? 'Deleted member', since: iso(b.created_at) })),
    reportsMade: reports.map((r) => ({ targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details,
      status: r.status, createdAt: iso(r.created_at) })),
    memberNumberDisputes: disputes.map((d) => ({ memberNumber: d.member_number_normalised, details: d.details, status: d.status, createdAt: iso(d.created_at) })),
    sessions: sessions.map((s) => ({ createdAt: iso(s.created_at), lastSeenAt: iso(s.last_seen_at), expiresAt: iso(s.expires_at),
      revokedAt: iso(s.revoked_at), device: s.user_agent, ip: s.ip })),
    images: images.map((i) => ({ id: i.id, url: imageUrls(i.path).url, width: i.width, height: i.height, uploadedAt: iso(i.created_at) })),
  };
}
