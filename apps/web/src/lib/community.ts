/**
 * Groups, Today board and Ask a Senior (docs/api-contract.md sections 8–10). Real API only.
 */
import { call } from './api';
import type { Author, Page, Post } from './feed';

const q = (path: string, params: Record<string, string | number | boolean | null | undefined>) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return s ? `${path}?${s}` : path;
};
const id = encodeURIComponent;

// ---------------------------------------------------------------- groups
export type Group = {
  id: string; name: string; description: string | null;
  visibility: 'public' | 'private'; studentOnly: boolean;
  kind: 'group' | 'club'; clubVerified: boolean; posting: 'everyone' | 'admins_only';
  isClassGroup: boolean; memberCount: number | null;
  myStatus: 'none' | 'pending' | 'active'; myRole: 'member' | 'admin' | null;
  /** Club follows (v0.2): only public clubs can be followed; followerCount is null otherwise. */
  canFollow: boolean; following: boolean; followerCount: number | null;
};
export type Member = { id: string; name: string; photoUrl: string | null; memberType: string; role: 'admin' | 'member'; joinedAt: string };
export type JoinRequest = { id: string; name: string; photoUrl: string | null; memberType: string; requestedAt: string };

export const getGroups = (mine: boolean, cursor?: string | null) => call<Page<Group>>('GET', q('/api/groups', { mine: mine || undefined, limit: 30, cursor }));
export const getGroup = (groupId: string) => call<Group>('GET', `/api/groups/${id(groupId)}`);
export const createGroup = (input: { name: string; description?: string; visibility: 'public' | 'private'; studentOnly?: boolean }) =>
  call<Group>('POST', '/api/groups', input);
export const joinGroup = (groupId: string) => call<{ status: 'active' | 'pending' }>('PUT', `/api/groups/${id(groupId)}/membership`);
export const leaveGroup = (groupId: string) => call<void>('DELETE', `/api/groups/${id(groupId)}/membership`);
/** Clubs: `announcements` (admins post) or `discussion` (members); `all` for other groups. */
export type Channel = 'all' | 'announcements' | 'discussion';
export const getGroupPosts = (groupId: string, cursor?: string | null, channel: Channel = 'all') =>
  call<Page<Post>>('GET', q(`/api/groups/${id(groupId)}/posts`, { limit: 20, cursor, channel }));
export const getMembers = (groupId: string, cursor?: string | null) => call<Page<Member>>('GET', q(`/api/groups/${id(groupId)}/members`, { limit: 50, cursor }));
export const getRequests = (groupId: string) => call<{ items: JoinRequest[] }>('GET', `/api/groups/${id(groupId)}/requests`);
export const answerRequest = (groupId: string, userId: string, approve: boolean) =>
  call<{ status: 'active' | 'none' }>('POST', `/api/groups/${id(groupId)}/requests/${id(userId)}`, { approve });

// ---------------------------------------------------------------- Today board
export type OfficeRef = { id: string; name: string; photoUrl: string | null; verified: boolean };
export type Announcement = {
  id: string; office: OfficeRef; title: string; body: string;
  urgency: 'urgent' | 'normal'; pinned: boolean; pinnedUntil: string | null; createdAt: string;
};
export type MyOffice = OfficeRef & { role: 'owner' | 'editor' };

export const getAnnouncements = (cursor?: string | null) => call<Page<Announcement>>('GET', q('/api/announcements', { limit: 20, cursor }));
export const createAnnouncement = (input: { officeId: string; title: string; body: string; urgency: 'urgent' | 'normal'; pinnedUntil?: string }) =>
  call<Announcement>('POST', '/api/announcements', input);
export const deleteAnnouncement = (annId: string) => call<void>('DELETE', `/api/announcements/${id(annId)}`);
export const getMyOffices = () => call<{ items: MyOffice[] }>('GET', '/api/me/offices');

// ---------------------------------------------------------------- Ask a Senior
export type Question = { id: string; body: string; author: Author | null; nameHidden: boolean; isMine: boolean; answerCount: number; createdAt: string };
export type Answer = { id: string; body: string; author: Author | null; byAsker: boolean; isMine: boolean; helpfulCount: number; helpfulByMe: boolean; createdAt: string };

export const getQuestions = (search?: string, cursor?: string | null) => call<Page<Question>>('GET', q('/api/questions', { q: search, limit: 20, cursor }));
export const askQuestion = (body: string, hideName: boolean) => call<Question>('POST', '/api/questions', { body, hideName });
export const getQuestion = (qId: string) => call<Question & { answers: Answer[] }>('GET', `/api/questions/${id(qId)}`);
export const answerQuestion = (qId: string, body: string) => call<Answer>('POST', `/api/questions/${id(qId)}/answers`, { body });
export const deleteQuestion = (qId: string) => call<void>('DELETE', `/api/questions/${id(qId)}`);
export const deleteAnswer = (aId: string) => call<void>('DELETE', `/api/answers/${id(aId)}`);
export const markHelpful = (aId: string, helpful: boolean) =>
  call<{ helpful: boolean; helpfulCount: number }>(helpful ? 'PUT' : 'DELETE', `/api/answers/${id(aId)}/helpful`);

/** Shown in place of an author whose name is hidden from you. */
export const HIDDEN_AUTHOR: Author = { id: null, name: 'A student', photoUrl: null, badges: [] };

/** Courses members of your campus already use (GET /api/courses), most used first. */
export type Course = { name: string; members: number };
export const getCourses = () => call<{ items: Course[] }>('GET', '/api/courses');

/** Loose key for matching what someone types to a course: lower-case, letters and digits only. */
export const courseKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Up to `max` suggestions for what has been typed so far (all courses when nothing is typed yet). */
export function suggestCourses(courses: Course[], typed: string, max = 6): Course[] {
  const key = courseKey(typed);
  if (!key) return courses.slice(0, max);
  if (courses.some((c) => c.name.toLowerCase() === typed.trim().replace(/\s+/g, ' ').toLowerCase())) return [];   // already exact
  return courses.filter((c) => courseKey(c.name).includes(key)).slice(0, max);
}
