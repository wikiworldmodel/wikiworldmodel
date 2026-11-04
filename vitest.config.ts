import { defineConfig } from 'vitest/config';

// Two groups. `unit` needs only the code, the records and the plate model, and runs on every
// pull request in a few seconds. `build` reads a world build (`npm run build:world`), including
// one it makes itself to check builds are reproducible; it runs when a build is made.
const BUILD = ['tools/world/test/build.test.ts', 'tools/world/test/mesosaurus.test.ts', 'tools/world/test/life.test.ts'];

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tools/world/test/**/*.test.ts', 'world/generators/**/*.test.ts', 'core/**/*.test.ts'],
          exclude: BUILD,
        },
      },
      { extends: true, test: { name: 'build', include: BUILD } },
    ],
  },
});
