import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Database tests that send hundreds of requests (the per-IP sign-in limits) take ~2 s alone,
    // but several times that on a small machine or CI runner.
    testTimeout: 30_000,
    // With a test database, test files run one after another: each loads the seed data into the
    // same database inside its own transaction, and running them side by side deadlocks at random
    // ("deadlock detected" in CI). Unit tests alone (no TEST_DATABASE_URL) still run in parallel.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
