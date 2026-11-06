// Pass criterion: builds are reproducible in meaning (docs/STRUCTURE.md section 3.5). Building the same
// commit again makes the same files, with the same records, ids and words, and the same numbers within a
// tolerance; generators may use any arithmetic, so their bytes may differ in the last bits of a float.
// It builds the world once more and compares with the build `npm run build:world` made, which takes
// minutes, so it runs nightly (.github/workflows/nightly.yml), not on every change.
import { describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/index.ts';
import { latestBuild } from './helpers.ts';
import { meaningOf, meaningProblems } from './meaning.ts';

describe('build', () => {
  it('is reproducible: building again makes a build that means the same', async () => {
    const before = meaningOf(latestBuild());
    const quiet = console.log;
    console.log = () => {};
    try {
      expect(await runBuild([])).toBe(0);
    } finally {
      console.log = quiet;
    }
    expect(meaningProblems(before, meaningOf(latestBuild()))).toEqual([]);
  }, 1_800_000);
});
