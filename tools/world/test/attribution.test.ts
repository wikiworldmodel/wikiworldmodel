import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attributionMarkdown, credits } from '../src/attribution.ts';
import { REPO } from '../src/paths.ts';
import { loadWorld } from '../src/world.ts';

describe('attribution', () => {
  it('the repository ATTRIBUTION.md is current: run `npm run world -- attribution` if not', async () => {
    const world = await loadWorld();
    expect(readFileSync(join(REPO, 'ATTRIBUTION.md'), 'utf8')).toBe(attributionMarkdown(world));
  });

  it('credits every dataset the build reads, with its licence, and every one of those is allowed', async () => {
    const world = await loadWorld();
    const text = attributionMarkdown(world);
    for (const [id, d] of Object.entries(world.manifest.datasets)) {
      expect(text).toContain(`\`${id}\``);
      expect(world.manifest.publish.licenses).toContain(d.license);
    }
    const labels = credits(world).map((c) => c.label);
    for (const d of Object.values(world.manifest.datasets)) expect(labels).toContain(d.credit);
  });
});
