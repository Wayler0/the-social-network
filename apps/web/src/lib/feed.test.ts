import { describe, expect, it } from 'vitest';
import { timeAgo } from './feed';

describe('timeAgo', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  it('says now under a minute', () => expect(timeAgo(ago(30), now)).toBe('now'));
  it('uses minutes, hours and days', () => {
    expect(timeAgo(ago(5 * 60), now)).toBe('5m');
    expect(timeAgo(ago(3 * 3600), now)).toBe('3h');
    expect(timeAgo(ago(2 * 86_400), now)).toBe('2d');
  });
  it('shows a date after a week, with the year only when it differs', () => {
    expect(timeAgo('2026-11-01T12:00:00Z', now)).toBe('1 Nov');
    expect(timeAgo('2025-11-01T12:00:00Z', now)).toBe('1 Nov 2025');
  });
  it('never goes negative for clocks slightly ahead', () => expect(timeAgo(ago(-20), now)).toBe('now'));
});

import { plural } from './feed';
describe('plural', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(0, 'comment')).toBe('0 comments');
    expect(plural(1, 'comment')).toBe('1 comment');
    expect(plural(2, 'reply', 'replies')).toBe('2 replies');
  });
});
