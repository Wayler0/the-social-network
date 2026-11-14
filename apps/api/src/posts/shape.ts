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
const authorColumns = (alias: string) => `
  case when ${alias}.deleted_at is null then ${alias}.id end as author_id,
  case when ${alias}.deleted_at is null then ${alias}.name end as author_name,
  case when ${alias}.deleted_at is null then ${alias}.photo_url end as author_photo,
  case when ${alias}.deleted_at is null then ${activeRoles(`${alias}.id`)} else '{}' end as author_roles`;

/** Select list and joins for posts aliased `p`; add WHERE, ORDER BY and LIMIT. */
export const POST_SELECT = `
  select p.id, p.body, p.created_at, p.created_at::text as cursor_at, ${authorColumns('au')},
         o.id as office_id, o.name as office_name, o.photo_url as office_photo, o.verified as office_verified,
         g.id as group_id, g.name as group_name,
         i.path as image_path, i.width as image_width, i.height as image_height,
         (select count(*) from likes l where l.post_id = p.id)::int as like_count,
         (select count(*) from comments c where c.post_id = p.id and c.hidden_at is null and c.deleted_at is null)::int as comment_count,
         exists (select 1 from likes l where l.post_id = p.id and l.user_id = $1) as liked_by_me
    from posts p
    join users au on au.id = p.author_user_id
    left join office_accounts o on o.id = p.author_office_id
    left join groups g on g.id = p.group_id
    left join images i on i.id = p.image_id`;

type AuthorRow = { author_id: string | null; author_name: string | null; author_photo: string | null; author_roles: string[] };

export type PostRow = AuthorRow & {
  id: string; body: string; created_at: Date; cursor_at: string;
  office_id: string | null; office_name: string | null; office_photo: string | null; office_verified: boolean | null;
  group_id: string | null; group_name: string | null;
  image_path: string | null; image_width: number | null; image_height: number | null;
  like_count: number; comment_count: number; liked_by_me: boolean;
};

function author(r: AuthorRow) {
  return r.author_id
    ? { id: r.author_id, name: r.author_name, photoUrl: r.author_photo, badges: badgesFor(r.author_roles) }
    : { id: null, name: 'Deleted member', photoUrl: null, badges: [] };
}

export function postBody(r: PostRow) {
  return {
    id: r.id,
    author: author(r),
    office: r.office_id ? { id: r.office_id, name: r.office_name, photoUrl: r.office_photo, verified: r.office_verified } : null,
    group: r.group_id ? { id: r.group_id, name: r.group_name } : null,
    body: r.body,
    image: r.image_path ? { url: imageUrls(r.image_path).url, width: r.image_width, height: r.image_height } : null,
    likeCount: r.like_count,
    commentCount: r.comment_count,
    likedByMe: r.liked_by_me,
    createdAt: r.created_at.toISOString(),
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
