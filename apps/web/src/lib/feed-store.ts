import { useSyncExternalStore } from 'react';
import type { Post } from './feed';

/**
 * The Home feed kept in memory while the app is open, so leaving Home (a post, Discover,
 * Profile) and coming back shows the same posts at the same scroll position instead of
 * loading from scratch. It lives only in memory: closing the app or signing out clears it.
 */
export type FeedState = {
  posts: Post[];
  cursor: string | null;
  done: boolean;
  /** When the first page was last fetched (ms), 0 if never. */
  loadedAt: number;
  /** Window scroll position when the member left Home. */
  scrollY: number;
};

const EMPTY: FeedState = { posts: [], cursor: null, done: false, loadedAt: 0, scrollY: 0 };
let state: FeedState = EMPTY;
const listeners = new Set<() => void>();

function set(next: FeedState) {
  state = next;
  listeners.forEach((fn) => fn());
}

export const getFeedState = () => state;

export function useFeedState(): FeedState {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, getFeedState);
}

/** A fresh first page: new posts on top, posts already loaded below it stay (updated). */
export function setFirstPage(items: Post[], nextCursor: string | null) {
  const fresh = new Set(items.map((p) => p.id));
  const kept = state.posts.filter((p) => !fresh.has(p.id));
  // Nothing loaded yet: take the page as it is, with its cursor.
  if (state.posts.length === 0) {
    set({ ...state, posts: items, cursor: nextCursor, done: nextCursor === null, loadedAt: Date.now() });
  } else {
    set({ ...state, posts: [...items, ...kept], loadedAt: Date.now() });
  }
}

export function appendPage(items: Post[], nextCursor: string | null) {
  const seen = new Set(state.posts.map((p) => p.id));
  set({ ...state, posts: [...state.posts, ...items.filter((p) => !seen.has(p.id))], cursor: nextCursor, done: nextCursor === null });
}

/** Keep the feed in step with changes made elsewhere (a like on the post page, a new comment). */
export function patchPost(post: Post) {
  if (state.posts.some((p) => p.id === post.id)) set({ ...state, posts: state.posts.map((p) => (p.id === post.id ? post : p)) });
}

export function addPostToTop(post: Post) {
  if (post.group) return; // group posts live in their group, not the campus feed
  set({ ...state, posts: [post, ...state.posts.filter((p) => p.id !== post.id)] });
}

export function removePost(id: string) {
  set({ ...state, posts: state.posts.filter((p) => p.id !== id) });
}

export function removeAuthor(authorId: string) {
  set({ ...state, posts: state.posts.filter((p) => p.author.id !== authorId) });
}

export function saveScroll(y: number) { state = { ...state, scrollY: y }; }

/** Signing out: nothing from this account stays in memory (shared phones). */
export function clearFeed() { set(EMPTY); }
