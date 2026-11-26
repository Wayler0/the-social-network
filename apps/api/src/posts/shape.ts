import { imageUrls } from '../images/store.js';
import { badgesFor } from '../me/profile.js';

/**
 * How posts and comments look in the API (docs/api-contract.md section 5), and the SQL that
 * fetches everything one needs in a single query. The viewer's id is always $1.
 */

/** A member's current roles, for badges. `userCol` is a constant from our code. */
export const activeRoles = (userCol: string) =>
  `coalesce(array(select distinct r.role from roles r
                   where r.user_id = ${userCol} and r.starts_at <= clock_timestamp()
                     and (r.ends_at is null or r.ends_at > clock_timestamp())
                   order by r.role), '{}')`;

/** Authors who deleted their account show as "Deleted member", with nothing that identifies them. */
export const authorColumns = (alias: string) => `
  case when ${alias}.deleted_at is null then ${alias}.id end as author_id,
  case when ${alias}.deleted_at is null then ${alias}.name end as author_name,
  case when ${alias}.deleted_at is null then ${alias}.photo_url end as author_photo,
  case when ${alias}.deleted_at is null then ${activeRoles(`${alias}.id`)} else '{}' end as author_roles`;

/** Select list and joins for posts aliased `p`; add WHERE, ORDER BY and LIMIT. */
export const POST_SELECT = `
  select p.id, p.body, p.announcement, p.created_at, p.edited_at, p.created_at::text as cursor_at, ${authorColumns('au')},
         o.id as office_id, o.name as office_name, o.photo_url as office_photo, o.verified as office_verified,
         g.id as group_id, g.name as group_name, g.kind as group_kind,
         i.path as image_path, i.width as image_width, i.height as image_height,
         (select count(*) from likes l where l.post_id = p.id)::int as like_count,
         (select count(*) from comments c where c.post_id = p.id and c.hidden_at is null and c.deleted_at is null)::int as comment_count,
         (select l.reaction from likes l where l.post_id = p.id and l.user_id = $1) as my_reaction,
         (select coalesce(jsonb_object_agg(r.reaction, r.n), '{}') from (select l.reaction, count(*)::int as n from likes l where l.post_id = p.id group by l.reaction) r) as reaction_counts,
         exists (select 1 from saved_posts s where s.post_id = p.id and s.user_id = $1) as saved_by_me,
         ev.id as event_id, ev.title as event_title, ev.location as event_location, ev.starts_at as event_starts_at,
         (ev.cancelled_at is not null) as event_cancelled,
         (select count(*) from event_rsvps er where er.event_id = ev.id and er.status = 'going')::int as event_going,
         (select er.status from event_rsvps er where er.event_id = ev.id and er.user_id = $1) as event_my_rsvp,
         exists (select 1 from follows fa where fa.follower_id = $1 and fa.target_type = 'user' and fa.target_id = p.author_user_id) as following_author,
         p.repost_of as repost_of_id, op.id as rp_id, op.body as rp_body, op.created_at as rp_created_at,
         case when opa.deleted_at is null then opa.id end as rp_author_id,
         case when opa.deleted_at is null then opa.name end as rp_author_name,
         case when opa.deleted_at is null then opa.photo_url end as rp_author_photo,
         case when opa.deleted_at is null then ${activeRoles('opa.id')} else '{}' end as rp_author_roles,
         opi.path as rp_image_path, opi.width as rp_image_width, opi.height as rp_image_height,
         (select count(*) from posts rr where rr.repost_of = p.id and rr.deleted_at is null and rr.hidden_at is null)::int as repost_count,
         exists (select 1 from posts rr where rr.repost_of = p.id and rr.author_user_id = $1 and rr.deleted_at is null) as reposted_by_me
    from posts p
    join users au on au.id = p.author_user_id
    left join office_accounts o on o.id = p.author_office_id
    left join groups g on g.id = p.group_id
    left join images i on i.id = p.image_id
    left join events ev on ev.id = p.event_id and ev.hidden_at is null and ev.deleted_at is null
    -- A repost's original, only while the viewer may see it (a campus feed post, same campus, not
    -- hidden or deleted, no block either way): the same as visiblePost for a post outside groups.
    left join posts op on op.id = p.repost_of and op.campus_id = p.campus_id and op.group_id is null
                        and op.hidden_at is null and op.deleted_at is null
                        and not exists (select 1 from blocks ob where (ob.blocker_id = $1 and ob.blocked_id = op.author_user_id)
                                                                 or (ob.blocker_id = op.author_user_id and ob.blocked_id = $1))
    left join users opa on opa.id = op.author_user_id
    left join images opi on opi.id = op.image_id`;

export type AuthorRow = { author_id: string | null; author_name: string | null; author_photo: string | null; author_roles: string[] };

export type PostRow = AuthorRow & {
  id: string; body: string; announcement: boolean; created_at: Date; edited_at: Date | null; cursor_at: string;
  office_id: string | null; office_name: string | null; office_photo: string | null; office_verified: boolean | null;
  group_id: string | null; group_name: string | null; group_kind: string | null;
  image_path: string | null; image_width: number | null; image_height: number | null;
  like_count: number; comment_count: number; my_reaction: Reaction | null; reaction_counts: Partial<Record<Reaction, number>>;
  saved_by_me: boolean;
  event_id: string | null; event_title: string | null; event_location: string | null; event_starts_at: Date | null;
  event_cancelled: boolean | null; event_going: number | null; event_my_rsvp: string | null; following_author: boolean;
  repost_of_id: string | null; rp_id: string | null; rp_body: string | null; rp_created_at: Date | null;
  rp_author_id: string | null; rp_author_name: string | null; rp_author_photo: string | null; rp_author_roles: string[] | null;
  rp_image_path: string | null; rp_image_width: number | null; rp_image_height: number | null;
  repost_count: number; reposted_by_me: boolean;
};

export function author(r: AuthorRow) {
  return r.author_id
    ? { id: r.author_id, name: r.author_name, photoUrl: r.author_photo, badges: badgesFor(r.author_roles) }
    : { id: null, name: 'Deleted member', photoUrl: null, badges: [] };
}

export function postBody(r: PostRow) {
  return {
    id: r.id,
    author: author(r),
    office: r.office_id ? { id: r.office_id, name: r.office_name, photoUrl: r.office_photo, verified: r.office_verified } : null,
    group: r.group_id ? { id: r.group_id, name: r.group_name, kind: r.group_kind } : null,
    announcement: r.announcement,
    body: r.body,
    image: r.image_path ? { url: imageUrls(r.image_path).url, width: r.image_width, height: r.image_height } : null,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    likedByMe: r.my_reaction !== null,
    myReaction: r.my_reaction,
    reactions: r.reaction_counts,
    savedByMe: r.saved_by_me,
    /** A shared event: its card (null if it was deleted or hidden). */
    event: r.event_id ? { id: r.event_id, title: r.event_title, location: r.event_location, startsAt: r.event_starts_at!.toISOString(),
      cancelled: Boolean(r.event_cancelled), goingCount: r.event_going ?? 0, myRsvp: r.event_my_rsvp } : null,
    /** Whether the viewer follows the author (for the Follow button next to the name). */
    followingAuthor: r.following_author,
    createdAt: r.created_at.toISOString(),
    /** When the author last changed the text (shown as "Edited"), or null. */
    editedAt: r.edited_at ? r.edited_at.toISOString() : null,
    /** A repost: the original post, or { available: false } once it is deleted, hidden or blocked. */
    repostOf: r.repost_of_id === null ? null : r.rp_id === null ? { available: false as const } : {
      available: true as const, id: r.rp_id, body: r.rp_body ?? '', createdAt: r.rp_created_at!.toISOString(),
      author: r.rp_author_id
        ? { id: r.rp_author_id, name: r.rp_author_name, photoUrl: r.rp_author_photo, badges: badgesFor(r.rp_author_roles ?? []) }
        : { id: null, name: 'Deleted member', photoUrl: null, badges: [] },
      image: r.rp_image_path ? { url: imageUrls(r.rp_image_path).url, width: r.rp_image_width, height: r.rp_image_height } : null,
    },
    repostCount: r.repost_count,
    repostedByMe: r.reposted_by_me,
  };
}

/** Select list and joins for comments aliased `c`. */
export const COMMENT_SELECT = `
  select c.id, c.body, c.created_at, c.created_at::text as cursor_at, ${authorColumns('au')}
    from comments c
    join users au on au.id = c.user_id`;

export type CommentRow = AuthorRow & { id: string; body: string; created_at: Date; cursor_at: string };

export function commentBody(r: CommentRow) {
  return { id: r.id, author: author(r), body: r.body, createdAt: r.created_at.toISOString() };
}

/** Reactions on posts (v0.2). A v0.1 like is the reaction 'like'. Matches migration 014. */
export const REACTIONS = ['like', 'love', 'haha', 'wow', 'sad', 'support'] as const;
export type Reaction = (typeof REACTIONS)[number];
