import { APP_NAME } from '../config';

/**
 * Sharing a post outside the app shares its LINK only, never its text or photo: the app is
 * members-only (CLAUDE.md section 1), so whoever opens the link must sign in to see the post.
 * Uses the phone's share menu (WhatsApp, Telegram, SMS…) where there is one, else copies the link.
 */
export function postUrl(postId: string, origin = window.location.origin): string {
  return `${origin}/post/${encodeURIComponent(postId)}`;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function sharePost(postId: string): Promise<ShareResult> {
  return shareLink(postUrl(postId), `A post on ${APP_NAME}`);
}

/** A story's link: opens only for members who may see it (and only while it lasts). */
export function shareStory(storyId: string): Promise<ShareResult> {
  return shareLink(`${window.location.origin}/story/${encodeURIComponent(storyId)}`, `A story on ${APP_NAME}`);
}

/** The phone's share menu with a link and a short line, or copy the link where there is no menu. */
export async function shareLink(url: string, text: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: APP_NAME, text, url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Share menu unavailable (e.g. desktop without one): fall through to copying.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
