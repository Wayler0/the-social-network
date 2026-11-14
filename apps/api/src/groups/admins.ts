import type { Queryable } from '../images/store.js';

/**
 * Makes sure a group that still has active members also has an admin: if none is left, the
 * longest-standing active member becomes one. Call it inside the transaction that removed an
 * admin (leaving, deleting an account). Class groups have no admins by design and are skipped.
 * Returns the promoted member's id, or null.
 */
export async function ensureGroupHasAdmin(tx: Queryable, groupId: string): Promise<string | null> {
  const { rows } = await tx.query<{ user_id: string }>(
    `update group_members set role = 'admin'
      where (group_id, user_id) = (
        select m.group_id, m.user_id from group_members m join groups g on g.id = m.group_id
         where m.group_id = $1 and m.status = 'active' and g.auto_type = 'none'
           and not exists (select 1 from group_members a where a.group_id = $1 and a.role = 'admin' and a.status = 'active')
         order by m.joined_at, m.user_id limit 1)
      returning user_id`,
    [groupId],
  );
  return rows[0]?.user_id ?? null;
}
