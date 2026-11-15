/**
 * Feed, posts, comments, likes, images, report and block (docs/api-contract.md sections 5–7).
 * These always talk to the real API: run it with `npm run dev -w apps/api`.
 */
import { call } from './api';

export type Author = { id: string | null; name: string; photoUrl: string | null; badges: string[] };
export type Office = { id: string; name: string; photoUrl: string | null; verified: boolean };
export type PostImage = { url: string; width: number; height: number };

export type Post = {
  id: string;
  author: Author;
  office: Office | null;
  group: { id: string; name: string } | null;
  body: string;
  image: PostImage | null;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  createdAt: string;
};

export type Comment = { id: string; author: Author; body: string; createdAt: string };
export type Page<T> = { items: T[]; nextCursor: string | null };

export const POST_MAX = 2000;
export const COMMENT_MAX = 1000;

const page = (path: string, cursor?: string | null, limit = 20) =>
  `${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

export const getFeed = (cursor?: string | null) => call<Page<Post>>('GET', page('/api/feed', cursor));
export const getPost = (id: string) => call<Post>('GET', `/api/posts/${encodeURIComponent(id)}`);
export const createPost = (input: { body: string; imageId?: string }) => call<Post>('POST', '/api/posts', input);
export const deletePost = (id: string) => call<void>('DELETE', `/api/posts/${encodeURIComponent(id)}`);

export const likePost = (id: string, like: boolean) =>
  call<{ liked: boolean; likeCount: number }>(like ? 'PUT' : 'DELETE', `/api/posts/${encodeURIComponent(id)}/like`);

export const getComments = (postId: string, cursor?: string | null) =>
  call<Page<Comment>>('GET', page(`/api/posts/${encodeURIComponent(postId)}/comments`, cursor, 30));
export const addComment = (postId: string, body: string) =>
  call<Comment>('POST', `/api/posts/${encodeURIComponent(postId)}/comments`, { body });
export const deleteComment = (id: string) => call<void>('DELETE', `/api/comments/${encodeURIComponent(id)}`);

/** JPEG, PNG or WebP up to 8 MB; the server strips location data and re-encodes to WebP. */
export const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export function uploadImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  return call<{ imageId: string; url: string; width: number; height: number }>('POST', '/api/images', form);
}

export type ReportTarget = 'post' | 'comment' | 'user' | 'group' | 'question' | 'answer';
export const REPORT_REASONS = [
  ['spam', 'Spam or scam'],
  ['harassment', 'Bullying or harassment'],
  ['hate', 'Hate speech'],
  ['nudity', 'Nudity or sexual content'],
  ['violence', 'Violence or graphic content'],
  ['self_harm', 'Self-harm or suicide'],
  ['false_info', 'False information'],
  ['other', 'Something else'],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];

export const report = (targetType: ReportTarget, targetId: string, reason: ReportReason, details?: string) =>
  call<{ received: true }>('POST', '/api/reports', { targetType, targetId, reason, ...(details ? { details } : {}) });

export const blockUser = (id: string) => call<void>('PUT', `/api/users/${encodeURIComponent(id)}/block`);

/** "1 comment", "3 comments". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "now", "5m", "3h", "2d", then a date ("12 Nov", with the year if it isn't this year). */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso);
  const s = Math.max(0, Math.round((now - then.getTime()) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
