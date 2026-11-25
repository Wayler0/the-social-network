import { call } from './api';

/** In-app feedback (API: apps/api/src/feedback/routes.ts). Admins read it without names. */
export const sendFeedback = (rating: number, body?: string) =>
  call<{ ok: true }>('POST', '/api/feedback', { rating, ...(body?.trim() ? { body: body.trim() } : {}) });
export const feedbackLater = () => call<void>('POST', '/api/feedback/later');

export type FeedbackItem = { id: string; rating: number; body: string | null; createdAt: string };
export const getFeedbackList = (cursor?: string | null) =>
  call<{ count: number; average: number | null; items: FeedbackItem[]; nextCursor: string | null }>(
    'GET', `/api/admin/feedback?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
