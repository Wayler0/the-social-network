import type { Queryable } from '../images/store.js';
import { imageUrls } from '../images/store.js';
import { loadMe, meBody } from './profile.js';

/**
 * Everything we hold about one member, for GET /api/me/export (Data Protection Act 2019: right of
 * access and data portability; CLAUDE.md sections 4 and 10).
 *
 * Included: profile (with email and member number), account dates and any suspension, roles and
 * office memberships (history too), groups, everything they wrote (also what they deleted or what
 * moderators hid, which we still keep), likes, helpful votes, announcements they posted, people
 * they blocked, reports and disputes they made, sign-in sessions, and their uploaded images.
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
  const likes = await q<{ post_id: string; created_at: Date }>(
    'select post_id, created_at from likes where user_id = $1 order by created_at');
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
    likes: likes.map((l) => ({ postId: l.post_id, createdAt: iso(l.created_at) })),
    savedPosts: saved.map((s) => ({ postId: s.post_id, createdAt: iso(s.created_at) })),
    questions: questions.map((x) => ({ id: x.id, body: x.body, hideName: x.hide_name, createdAt: iso(x.created_at), hiddenAt: iso(x.hidden_at), deletedAt: iso(x.deleted_at) })),
    answers: answers.map((a) => ({ id: a.id, questionId: a.question_id, body: a.body, createdAt: iso(a.created_at), hiddenAt: iso(a.hidden_at), deletedAt: iso(a.deleted_at) })),
    helpfulVotes: helpful.map((h) => ({ answerId: h.answer_id, createdAt: iso(h.created_at) })),
    announcements: announcements.map((a) => ({ id: a.id, office: a.office_name, title: a.title, body: a.body, urgency: a.urgency,
      pinnedUntil: iso(a.pinned_until), createdAt: iso(a.created_at) })),
    blocked: blocks.map((b) => ({ id: b.id, name: b.name ?? 'Deleted member', since: iso(b.created_at) })),
    reportsMade: reports.map((r) => ({ targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details,
      status: r.status, createdAt: iso(r.created_at) })),
    memberNumberDisputes: disputes.map((d) => ({ memberNumber: d.member_number_normalised, details: d.details, status: d.status, createdAt: iso(d.created_at) })),
    sessions: sessions.map((s) => ({ createdAt: iso(s.created_at), lastSeenAt: iso(s.last_seen_at), expiresAt: iso(s.expires_at),
      revokedAt: iso(s.revoked_at), device: s.user_agent, ip: s.ip })),
    images: images.map((i) => ({ id: i.id, url: imageUrls(i.path).url, width: i.width, height: i.height, uploadedAt: iso(i.created_at) })),
  };
}
