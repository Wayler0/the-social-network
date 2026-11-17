import { describe, expect, it } from 'vitest';
import { installState, isIos } from './install';

const ANDROID = 'Mozilla/5.0 (Linux; Android 13; TECNO KI5q) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const base = { standalone: false, installed: false, canPrompt: false, userAgent: ANDROID, maxTouchPoints: 5 };

describe('isIos', () => {
  it('spots iPhones and iPads that pretend to be Macs, not Android or a real Mac', () => {
    expect(isIos(IPHONE)).toBe(true);
    expect(isIos(MAC, 5)).toBe(true);
    expect(isIos(MAC, 0)).toBe(false);
    expect(isIos(ANDROID, 5)).toBe(false);
  });
});

describe('installState', () => {
  it('says installed when opened from the home screen or just installed', () => {
    expect(installState({ ...base, standalone: true, canPrompt: true })).toBe('installed');
    expect(installState({ ...base, installed: true })).toBe('installed');
  });

  it('offers the install dialog when the browser has one', () => {
    expect(installState({ ...base, canPrompt: true })).toBe('available');
  });

  it('shows Share → Add to Home Screen on iPhone', () => {
    expect(installState({ ...base, userAgent: IPHONE })).toBe('ios');
  });

  it('is unavailable otherwise (e.g. not on HTTPS yet, or Firefox on desktop)', () => {
    expect(installState(base)).toBe('unavailable');
  });
});
