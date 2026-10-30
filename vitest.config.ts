import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tools/world/test/**/*.test.ts', 'world/generators/**/*.test.ts', 'core/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
