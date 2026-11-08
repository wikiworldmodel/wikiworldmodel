import { defineConfig } from 'vitest/config';

// Three groups.
// - `unit` needs only the code, the records and the plate model. It runs on every pull request,
//   its files side by side, so keep each quick and free of builds.
// - `build` reads the world build `npm run build:world` made; it runs whenever a build is made.
// - `reproducible` builds the world again and compares, minutes of work; it runs nightly.
const BUILD = ['tools/world/test/build.test.ts', 'tools/world/test/mesosaurus.test.ts', 'tools/world/test/life.test.ts', 'tools/world/test/energybalance.test.ts'];
const REPRODUCIBLE = ['tools/world/test/reproducible.test.ts'];

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tools/world/test/**/*.test.ts', 'world/generators/**/*.test.ts', 'core/**/*.test.ts'],
          exclude: [...BUILD, ...REPRODUCIBLE],
        },
      },
      { extends: true, test: { name: 'build', include: BUILD, fileParallelism: false } },
      { extends: true, test: { name: 'reproducible', include: REPRODUCIBLE, fileParallelism: false } },
    ],
  },
});
