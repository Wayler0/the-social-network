/**
 * What a member may see: one place for the rules every list and every "get one" must apply
 * (docs/api-contract.md section 1; CLAUDE.md section 6). Forgetting one of these in a single
 * query is a privacy bug, so routes build their WHERE clauses from these helpers instead.
 *
 *   - only the viewer's own campus;
 *   - nothing hidden by moderators or reports, nothing deleted;
 *   - nothing by someone the viewer blocked, or who blocked the viewer;
 *   - group posts only for active members of the group;
 *   - student-only groups never for staff.
 *
 * Each helper returns a SQL condition. `alias` and column names are constants from our code,
 * never user input; the viewer's id and campus are always bound parameters, referenced by
 * placeholder (e.g. `{ id: '$1', campusId: '$2' }`).
 *
 * Moderators and admins see hidden content through the admin API, not through these.
 */

/** Placeholders for the viewer's id and campus id in the query being built. */
export type ViewerSql = { id: string; campusId: string };

/** Placeholders are written by our code, never taken from input. This catches a slip such as passing a value. */
const PLACEHOLDER = /^\$\d{1,3}$/;
const IDENT = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

function check(v: ViewerSql, ...idents: string[]): void {
  if (!PLACEHOLDER.test(v.id) || !PLACEHOLDER.test(v.campusId)) throw new Error('visibility: viewer must be $n placeholders');
  for (const i of idents) if (!IDENT.test(i)) throw new Error(`visibility: bad identifier ${i}`);
}

/** Neither the viewer nor `userCol` has blocked the other. */
export function notBlocked(userCol: string, v: ViewerSql): string {
  check(v, userCol);
  return `not exists (select 1 from blocks b
             where (b.blocker_id = ${v.id} and b.blocked_id = ${userCol})
                or (b.blocker_id = ${userCol} and b.blocked_id = ${v.id}))`;
}

/** The viewer is an active (not pending) member of the group in `groupCol`. */
export function isActiveMember(groupCol: string, v: ViewerSql): string {
  check(v, groupCol);
  return `exists (select 1 from group_members gm
             where gm.group_id = ${groupCol} and gm.user_id = ${v.id} and gm.status = 'active')`;
}

/** The viewer is staff (student-first rules: staff never see student-only groups). */
function viewerIsStaff(v: ViewerSql): string {
  return `exists (select 1 from users vu where vu.id = ${v.id} and vu.member_type = 'staff')`;
}

/**
 * A group the viewer may know exists: own campus, and not student-only when the viewer is staff.
 * Private groups still pass (non-members see name and description only; the route decides what to show).
 */
export function visibleGroup(alias: string, v: ViewerSql): string {
  check(v, alias);
  return `(${alias}.campus_id = ${v.campusId}
           and not (${alias}.student_only and ${viewerIsStaff(v)}))`;
}

/**
 * A post the viewer may read: own campus, not hidden or deleted, no block with the author,
 * and for a group post, the viewer is an active member of a group they may see.
 */
export function visiblePost(alias: string, v: ViewerSql): string {
  check(v, alias);
  return `(${alias}.campus_id = ${v.campusId}
           and ${alias}.hidden_at is null and ${alias}.deleted_at is null
           and ${notBlocked(`${alias}.author_user_id`, v)}
           and (${alias}.group_id is null
                or (${isActiveMember(`${alias}.group_id`, v)}
                    and exists (select 1 from groups vg where vg.id = ${alias}.group_id and ${visibleGroup('vg', v)}))))`;
}

/** A comment the viewer may read. Its post must be checked with visiblePost as well. */
export function visibleComment(alias: string, v: ViewerSql): string {
  check(v, alias);
  return `(${alias}.hidden_at is null and ${alias}.deleted_at is null
           and ${notBlocked(`${alias}.user_id`, v)})`;
}

/** An Ask a Senior question the viewer may read. */
export function visibleQuestion(alias: string, v: ViewerSql): string {
  check(v, alias);
  return `(${alias}.campus_id = ${v.campusId} and ${alias}.hidden_at is null
           and ${notBlocked(`${alias}.user_id`, v)})`;
}

/** An answer the viewer may read. Its question must be checked with visibleQuestion as well. */
export function visibleAnswer(alias: string, v: ViewerSql): string {
  check(v, alias);
  return `(${alias}.hidden_at is null and ${notBlocked(`${alias}.user_id`, v)})`;
}
