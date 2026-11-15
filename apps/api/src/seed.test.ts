import { describe, expect, it } from 'vitest';
import { refusal, seedId, seedUserIds } from './seed.js';

describe('seedId', () => {
  it('gives the same valid UUID for the same name, and different ones for different names', () => {
    expect(seedId('user:amina')).toBe(seedId('user:amina'));
    expect(seedId('user:amina')).not.toBe(seedId('user:brian'));
    expect(seedId('user:amina')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('has one distinct id per seed member', () => {
    expect(new Set(seedUserIds()).size).toBe(seedUserIds().length);
  });
});

describe('refusal (when the seed must not run)', () => {
  it('never runs in production, even with --force', () => {
    expect(refusal('production', 0, false)).toMatch(/production/);
    expect(refusal('production', 0, true)).toMatch(/production/);
  });
  it('does not touch a database that has real members unless forced', () => {
    expect(refusal('development', 3, false)).toMatch(/3 member/);
    expect(refusal('development', 3, true)).toBeNull();
  });
  it('runs on an empty or seed-only database', () => {
    expect(refusal('development', 0, false)).toBeNull();
    expect(refusal('test', 0, false)).toBeNull();
  });
});
