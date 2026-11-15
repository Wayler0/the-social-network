/**
 * Moderation and admin (docs/api-contract.md section 11). Moderators: reports and hiding.
 * Admins: everything. The API checks every role again; the web app only hides what you can't use.
 */
import { call } from './api';
import type { Page } from './feed';
import type { Me } from './profile';

export const isModerator = (me: Me | null) => !!me && (me.isAdmin || me.badges.includes('Moderator'));

const id = encodeURIComponent;

export type ReportStatus = 'open' | 'hidden' | 'dismissed';
export type ContentType = 'post' | 'comment' | 'question' | 'answer';
export type ReportTargetType = ContentType | 'user' | 'group';

export type ReportTarget = {
  body?: string;
  name?: string;
  author?: { id: string | null; name: string | null; deleted: boolean };
  hiddenAt?: string | null;
  autoHidden?: boolean;
  deletedAt?: string | null;
  deleted?: boolean;
  suspended?: boolean;
  suspendedUntil?: string | null;
  memberType?: string;
  createdAt?: string;
};

export type AdminReport = {
  id: string; targetType: ReportTargetType; targetId: string; reason: string; details: string | null;
  status: ReportStatus; createdAt: string; resolvedAt: string | null;
  reporter: { id: string; name: string | null } | null;
  resolvedBy: { id: string; name: string | null } | null;
  reportCount: number;
  target: ReportTarget | null;
};

export type AdminUser = {
  id: string; name: string | null; email: string | null; memberType: string;
  memberNumber: string | null; memberNumberStatus: string;
  course: string | null; yearOfStudy: number | null; graduationYear: number | null;
  isUnder18: boolean | null; verified: boolean; createdAt: string; deleted: boolean;
  suspended: { since: string; until: string | null; reason: string | null } | null;
  roles: { id: string; role: Role; title: string | null; endsAt: string | null }[];
};

export const ROLES = ['staff', 'student_leader', 'club_leader', 'moderator', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const roleLabel: Record<Role, string> = {
  staff: 'Staff', student_leader: 'Student Leader', club_leader: 'Club Leader', moderator: 'Moderator', admin: 'Admin',
};

export type AdminOffice = {
  id: string; name: string; type: OfficeType; verified: boolean; createdAt: string;
  members: { id: string; name: string | null; role: 'owner' | 'editor'; since: string }[];
};
export const OFFICE_TYPES = ['office', 'department', 'student_council', 'club'] as const;
export type OfficeType = (typeof OFFICE_TYPES)[number];

export type LogEntry = { id: string; action: string; targetType: string; targetId: string; details: Record<string, unknown> | null; createdAt: string; by: { id: string; name: string | null } | null };

// ---------------------------------------------------------------- moderation
export const getReports = (status: ReportStatus, cursor?: string | null) =>
  call<Page<AdminReport>>('GET', `/api/admin/reports?status=${status}&limit=20${cursor ? `&cursor=${id(cursor)}` : ''}`);
export const resolveReport = (reportId: string, action: 'hide' | 'dismiss') =>
  call<{ status: string; resolved: number }>('POST', `/api/admin/reports/${id(reportId)}/resolve`, { action });
export const unhideContent = (type: ContentType, contentId: string) =>
  call<{ hidden: false }>('POST', `/api/admin/content/${type}/${id(contentId)}/unhide`);

// ---------------------------------------------------------------- members (admins)
export const findUsers = (q: string) => call<{ items: AdminUser[] }>('GET', `/api/admin/users?q=${id(q)}`);
export const suspendUser = (userId: string, reason: string, until?: string) =>
  call<AdminUser>('POST', `/api/admin/users/${id(userId)}/suspend`, { reason, ...(until ? { until } : {}) });
export const unsuspendUser = (userId: string) => call<AdminUser>('POST', `/api/admin/users/${id(userId)}/unsuspend`);
export const grantRole = (userId: string, role: Role, title?: string, endsAt?: string) =>
  call<AdminUser>('POST', `/api/admin/users/${id(userId)}/roles`, { role, ...(title ? { title } : {}), ...(endsAt ? { endsAt } : {}) });
export const endRole = (roleId: string) => call<void>('DELETE', `/api/admin/roles/${id(roleId)}`);

// ---------------------------------------------------------------- offices, clubs, log (admins)
export const getOffices = () => call<{ items: AdminOffice[] }>('GET', '/api/admin/offices');
export const createOffice = (name: string, type: OfficeType) => call<AdminOffice>('POST', '/api/admin/offices', { name, type });
export const setOfficeMember = (officeId: string, userId: string, role: 'owner' | 'editor') =>
  call<void>('POST', `/api/admin/offices/${id(officeId)}/members`, { userId, role });
export const removeOfficeMember = (officeId: string, userId: string) =>
  call<void>('DELETE', `/api/admin/offices/${id(officeId)}/members/${id(userId)}`);
export const setClubVerified = (groupId: string, verified: boolean) =>
  call<{ clubVerified: boolean }>('POST', `/api/admin/groups/${id(groupId)}/${verified ? 'verify-club' : 'unverify-club'}`);
export const getLog = (cursor?: string | null) =>
  call<Page<LogEntry>>('GET', `/api/admin/log?limit=30${cursor ? `&cursor=${id(cursor)}` : ''}`);
