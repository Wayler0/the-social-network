import { call } from './api';

/**
 * Stories (docs/api-contract.md section 13): photo or text, gone after 24 hours.
 * The server decides who sees what (followers, close friends, under-18 and staff rules);
 * the app only shows what GET /api/stories returns.
 */
/** Background colours for text stories (photos always sit on black). Black is the default. */
export const STORY_BACKGROUNDS = ['black', 'violet', 'coral', 'mint', 'sunshine', 'white'] as const;
export type StoryBackground = (typeof STORY_BACKGROUNDS)[number];
export const STORY_BACKGROUND_LABEL: Record<StoryBackground, string> = {
  black: 'Black', violet: 'Violet', coral: 'Coral', mint: 'Mint', sunshine: 'Sunshine', white: 'White',
};
export type StoryImage = { url: string; thumbUrl: string; width: number; height: number };
export type Story = {
  id: string; body: string | null; image: StoryImage | null; audience: 'followers' | 'close_friends';
  /** Shared from someone else's story: who it is from. */
  resharedFrom?: { name: string } | null;
  /** The author lets others add it to their story (off by default, like WhatsApp). */
  allowReshare?: boolean;
  /** Missing on stories from before colours existed: treat as black. */
  background?: StoryBackground;
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
export const createStory = (input: { body?: string; imageId?: string; audience?: 'followers' | 'close_friends'; background?: StoryBackground; allowReshare?: boolean }) =>
  call<Story>('POST', '/api/stories', input);
export const markStorySeen = (storyId: string) => call<void>('POST', `/api/stories/${id(storyId)}/view`);
export const getStoryViewers = (storyId: string) => call<{ count: number; likeCount: number; items: StoryViewer[] }>('GET', `/api/stories/${id(storyId)}/viewers`);
/** Like or unlike someone else's story (only its author sees who liked it). */
export const likeStory = (storyId: string, on: boolean) => call<{ liked: boolean }>(on ? 'PUT' : 'DELETE', `/api/stories/${id(storyId)}/like`);
export const deleteStory = (storyId: string) => call<void>('DELETE', `/api/stories/${id(storyId)}`);

/** Add someone's story to your own (with credit). Not your own or close-friends stories. */
export const reshareStory = (storyId: string) => call<Story>('POST', `/api/stories/${id(storyId)}/reshare`);
/** One story, for a shared link; 404 when you may not see it or it has gone. */
export const getStory = (storyId: string) =>
  call<{ author: StoryAuthor; isMine: boolean; story: Story }>('GET', `/api/stories/${id(storyId)}`);
