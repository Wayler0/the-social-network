import { describe, expect, it } from 'vitest';
import { linkify } from '../components/RichText';

describe('linkify', () => {
  it('turns http and https addresses into links and keeps the rest as text', () => {
    expect(linkify('Form: https://forms.gle/UzhKWHRRcZrSEhQb8 thanks')).toEqual([
      { text: 'Form: ' },
      { text: 'https://forms.gle/UzhKWHRRcZrSEhQb8', href: 'https://forms.gle/UzhKWHRRcZrSEhQb8' },
      { text: ' thanks' },
    ]);
  });
  it('leaves sentence punctuation out of the link', () => {
    expect(linkify('See http://example.org/a.')[1]).toEqual({ text: 'http://example.org/a', href: 'http://example.org/a' });
    expect(linkify('(at https://example.org)')[1]?.text).toBe('https://example.org');
  });
  it('keeps a bracket that belongs to the address', () => {
    expect(linkify('https://en.wikipedia.org/wiki/Hatua_(film)')[0]?.text).toBe('https://en.wikipedia.org/wiki/Hatua_(film)');
  });
  it('never links other schemes', () => {
    for (const t of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'www.example.org']) {
      expect(linkify(t).every((p) => !p.href)).toBe(true);
    }
  });
  it('handles text with no links and several links', () => {
    expect(linkify('no links here')).toEqual([{ text: 'no links here' }]);
    expect(linkify('https://a.org and https://b.org').filter((p) => p.href)).toHaveLength(2);
  });
});
