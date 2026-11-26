import { call } from './api';
import type { Post } from './feed';
import type { MemberTypeFull } from './profile';

/** GET /api/search: people, groups and clubs, posts, Ask a Senior questions (privacy rules on the server). */
export type SearchType = 'all' | 'people' | 'groups' | 'posts' | 'questions';
export type SearchPerson = { id: string; name: string; photoUrl: string | null; memberType: MemberTypeFull; course: string | null; yearOfStudy: number | null; badges: string[] };
export type SearchGroup = { id: string; name: string; description: string | null; kind: 'group' | 'club'; visibility: 'public' | 'private'; clubVerified: boolean; memberCount: number };
export type SearchQuestion = { id: string; body: string; answerCount: number; createdAt: string };
export type SearchResult = { q: string; people: SearchPerson[]; groups: SearchGroup[]; posts: Post[]; questions: SearchQuestion[] };

export const SEARCH_MIN = 2;
export const search = (q: string, type: SearchType = 'all') =>
  call<SearchResult>('GET', `/api/search?q=${encodeURIComponent(q)}&type=${type}`);
