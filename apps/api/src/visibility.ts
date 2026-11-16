/**
 * What a member may see: one place for the rules every list and every "get one" must apply
 * (docs/api-contract.md section 1; CLAUDE.md section 6). Forgetting one of these in a single
 * query is a privacy bug, so routes build their WHERE clauses from these helpers instead.
 *
 *   - only the viewer's own campus;
 *   - nothing hidden by moderators or reports, nothing deleted (posts, comments, questions, answers);
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
  return `(${alias}.campus_id = ${v.campusId} and ${alias}.hidden_at is null and ${alias}.deleted_at is null
           and ${notBlocked(`${alias}.user_id`, v)})`;
}

/** An answer the viewer may read. Its question must be checked with visibleQuestion as well. */
export function visibleAnswer(alias: string, v: ViewerSql): string {
  check(v, alias);
  return `(${alias}.hidden_at is null and ${alias}.deleted_at is null and ${notBlocked(`${alias}.user_id`, v)})`;
}

/**
 * A story the viewer may see now (CLAUDE.md section 4, "Stories / status"): own campus, live
 * (not expired, hidden or deleted), author not deleted, no block with the author, and
 *   - the viewer's own story; or
 *   - an office story (verified office): everyone on the campus; or
 *   - a club story: the club's followers and active members, if the viewer may see the club; or
 *   - a personal story: the viewer follows the author, the author has not hidden their stories
 *     from the viewer, the viewer is a close friend when the audience is close friends, and
 *       · an under-18 author follows the viewer back (child safety);
 *       · a staff viewer of a student's story is followed by that student (student-first rule).
 */
export function visibleStory(alias: string, v: ViewerSql): string {
  check(v, alias);
  const a = `${alias}.author_user_id`;
  const authorFollowsViewer = `exists (select 1 from follows sf where sf.follower_id = ${a} and sf.target_type = 'user' and sf.target_id = ${v.id})`;
  return `(${alias}.campus_id = ${v.campusId}
           and ${alias}.hidden_at is null and ${alias}.deleted_at is null and ${alias}.expires_at > clock_timestamp()
           and exists (select 1 from users sa where sa.id = ${a} and sa.deleted_at is null)
           and ${notBlocked(a, v)}
           and (
             (${a} = ${v.id} and ${alias}.author_office_id is null and ${alias}.author_group_id is null)
             or (${alias}.author_office_id is not null
                 and exists (select 1 from office_accounts so where so.id = ${alias}.author_office_id and so.verified))
             or (${alias}.author_group_id is not null
                 and exists (select 1 from groups sg where sg.id = ${alias}.author_group_id and sg.kind = 'club' and ${visibleGroup('sg', v)})
                 and (${isActiveMember(`${alias}.author_group_id`, v)}
                      or exists (select 1 from follows sf where sf.follower_id = ${v.id} and sf.target_type = 'group' and sf.target_id = ${alias}.author_group_id)))
             or (${alias}.author_office_id is null and ${alias}.author_group_id is null
                 and exists (select 1 from follows sf where sf.follower_id = ${v.id} and sf.target_type = 'user' and sf.target_id = ${a})
                 and not exists (select 1 from story_hidden_from sh where sh.user_id = ${a} and sh.hidden_user_id = ${v.id})
                 and (${alias}.audience = 'followers'
                      or exists (select 1 from close_friends cf where cf.user_id = ${a} and cf.friend_id = ${v.id}))
                 and (not exists (select 1 from users su where su.id = ${a} and su.is_under_18) or ${authorFollowsViewer})
                 and (not (${viewerIsStaff(v)}
                           and exists (select 1 from users su where su.id = ${a} and su.member_type in ('fresher', 'continuing')))
                      or ${authorFollowsViewer}))
           ))`;
}
