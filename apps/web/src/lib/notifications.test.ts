import { describe as group, expect, it } from 'vitest';
import { describe, hasScreen, keyBytes } from './notifications';

const actor = { id: 'u1', name: 'Amina', photoUrl: null };

group('describe', () => {
  it('names the latest actor, and how many others when collapsed', () => {
    expect(describe({ type: 'comment', count: 1, actor, text: 'New comment on your post' })).toBe('Amina commented on your post');
    expect(describe({ type: 'comment', count: 2, actor, text: '' })).toBe('Amina and 1 other commented on your post');
    expect(describe({ type: 'follow', count: 4, actor, text: '' })).toBe('Amina and 3 others started following you');
  });
  it('falls back to counts or the API text when the actor is hidden (blocked or deleted)', () => {
    expect(describe({ type: 'comment', count: 3, actor: null, text: 'x' })).toBe('3 new comments on your post');
    expect(describe({ type: 'answer', count: 1, actor: null, text: 'Someone answered your question' })).toBe('Someone answered your question');
  });
  it('uses the API text for kinds without an actor phrase', () => {
    expect(describe({ type: 'event_cancelled', count: 1, actor, text: 'An event you planned to go to was cancelled' }))
      .toBe('An event you planned to go to was cancelled');
  });
});

group('hasScreen', () => {
  it('knows the screens the web app has', () => {
    expect(hasScreen('/post/abc')).toBe(true);
    expect(hasScreen('/groups/abc')).toBe(true);
    expect(hasScreen('/ask/abc')).toBe(true);
    expect(hasScreen('/events/abc')).toBe(true);
    expect(hasScreen('/events/abc/edit')).toBe(false);
    expect(hasScreen('https://evil.example/post/1')).toBe(false);
  });
});

group('keyBytes', () => {
  it('decodes base64url without padding', () => {
    expect(Array.from(keyBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
});
