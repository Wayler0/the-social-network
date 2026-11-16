import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database tests that send hundreds of requests (the per-IP sign-in limits) take ~2 s alone,
    // but several times that while every test file runs in parallel on a small machine or CI runner.
    testTimeout: 30_000,
  },
});
