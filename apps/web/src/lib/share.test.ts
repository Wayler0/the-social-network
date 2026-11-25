import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './return-to';
import { postUrl } from './share';

describe('postUrl', () => {
  it('links to the post page on this site', () => {
    expect(postUrl('abc-123', 'https://example.org')).toBe('https://example.org/post/abc-123');
  });
});

describe('safeReturnPath', () => {
  it('keeps paths inside the app', () => {
    expect(safeReturnPath('/post/abc')).toBe('/post/abc');
  });
  it('rejects other sites and junk', () => {
    expect(safeReturnPath('//evil.example')).toBeNull();
    expect(safeReturnPath('/\\evil.example')).toBeNull();
    expect(safeReturnPath('https://evil.example')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});
