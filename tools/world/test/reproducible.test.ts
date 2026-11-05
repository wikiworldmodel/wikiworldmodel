// Pass criterion: builds are reproducible, so building the same commit again makes the same bytes.
// It builds the world once more and compares with the build `npm run build:world` made, which takes
// minutes, so it runs nightly (.github/workflows/nightly.yml), not on every change.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/index.ts';
import { latestBuild } from './helpers.ts';

function digest(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

describe('build', () => {
  it('is reproducible: building again makes the same bytes', async () => {
    const first = latestBuild();
    const before = digest(first);
    const quiet = console.log;
    console.log = () => {};
    try {
      expect(await runBuild([])).toBe(0);
    } finally {
      console.log = quiet;
    }
    expect(latestBuild()).toBe(first);
    expect(digest(first)).toEqual(before);
  }, 1_800_000);
});
