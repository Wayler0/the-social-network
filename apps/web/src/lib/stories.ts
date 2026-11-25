import { call } from './api';

/**
 * Stories (docs/api-contract.md section 13): photo or text, gone after 24 hours.
 * The server decides who sees what (followers, close friends, under-18 and staff rules);
 * the app only shows what GET /api/stories returns.
 */
export type StoryImage = { url: string; thumbUrl: string; width: number; height: number };
export type Story = {
  id: string; body: string | null; image: StoryImage | null; audience: 'followers' | 'close_friends';
  createdAt: string; expiresAt: string; seen: boolean; likedByMe: boolean;
  /** Only on your own stories. */
  viewCount?: number; likeCount?: number;
};
export type StoryAuthor = { type: 'user' | 'office' | 'group'; id: string; name: string; photoUrl: string | null; badges: string[] };
export type StoryGroup = { author: StoryAuthor; isMine: boolean; allSeen: boolean; stories: Story[] };
export type StoryViewer = { id: string; name: string | null; photoUrl: string | null; viewedAt: string; liked: boolean };

export const STORY_MAX = 500;
const id = encodeURIComponent;

export const getStories = () => call<{ items: StoryGroup[] }>('GET', '/api/stories');
export const createStory = (input: { body?: string; imageId?: string; audience?: 'followers' | 'close_friends' }) =>
  call<Story>('POST', '/api/stories', input);
export const markStorySeen = (storyId: string) => call<void>('POST', `/api/stories/${id(storyId)}/view`);
export const getStoryViewers = (storyId: string) => call<{ count: number; likeCount: number; items: StoryViewer[] }>('GET', `/api/stories/${id(storyId)}/viewers`);
/** Like or unlike someone else's story (only its author sees who liked it). */
export const likeStory = (storyId: string, on: boolean) => call<{ liked: boolean }>(on ? 'PUT' : 'DELETE', `/api/stories/${id(storyId)}/like`);
export const deleteStory = (storyId: string) => call<void>('DELETE', `/api/stories/${id(storyId)}`);
