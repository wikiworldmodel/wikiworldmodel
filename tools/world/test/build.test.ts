// Pass criteria: building twice gives byte-identical output, and the tile set is complete.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeTile } from '../../../core/container.ts';
import { fromMa } from '../../../core/time.ts';
import type { TileHeader, Tileset } from '../../../core/tileset.ts';
import { generateClouds, type CloudParams } from '../../../world/generators/clouds/v1.ts';
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
  it('is reproducible: two builds are byte-identical', async () => {
    const quiet = console.log;
    console.log = () => {};
    try {
      expect(await runBuild([])).toBe(0);
      const first = latestBuild();
      const a = digest(first);
      expect(await runBuild([])).toBe(0);
      const second = latestBuild();
      expect(second).toBe(first);
      expect(digest(second)).toEqual(a);
    } finally {
      console.log = quiet;
    }
  });

  it('has, in every tile, the keyframes that bracket every moment of its span', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const keys = ts.keyframesMa;
    for (const ref of ts.tiles) {
      const { header, arrays } = decodeTile<TileHeader>(readFileSync(join(dir, ref.url)).buffer.slice(0) as ArrayBuffer);
      const ages = header.field.keyframes.map((k) => k.ageMa);
      // The nearest keyframe at or before the span's start, and at or after its end.
      const older = keys.filter((k) => fromMa(k) <= ref.time[0])[0];
      const younger = keys.filter((k) => fromMa(k) >= ref.time[1]).at(-1);
      expect(ages).toContain(older);
      expect(ages).toContain(younger);
      const n = header.field.grid.nx * header.field.grid.ny;
      for (const k of header.field.keyframes) {
        expect(arrays[k.elev].length).toBe(n);
        expect(arrays[k.plate].length).toBe(n);
      }
      if (ref.parent) {
        const parent = ts.tiles.find((t) => t.id === ref.parent)!;
        expect(parent.time[0]).toBeLessThanOrEqual(ref.time[0]);
        expect(parent.time[1]).toBeGreaterThanOrEqual(ref.time[1]);
      }
    }
    const lod0 = ts.tiles.filter((t) => t.lod === 0).sort((a, b) => a.time[0] - b.time[0]);
    expect(lod0[0].time[0]).toBe(ts.timeRange[0]);
    expect(lod0.at(-1)!.time[1]).toBe(ts.timeRange[1]);
    for (let i = 1; i < lod0.length; i++) expect(lod0[i].time[0]).toBe(lod0[i - 1].time[1]);
  });

  it('records generator output that the generator reproduces', () => {
    const dir = latestBuild();
    const ts = JSON.parse(readFileSync(join(dir, 'tileset.json'), 'utf8')) as Tileset;
    const { header } = decodeTile<TileHeader>(readFileSync(join(dir, ts.tiles[0].url)).buffer.slice(0) as ArrayBuffer);
    const g = header.generators.find((x) => x.generator === 'clouds')!;
    const out = generateClouds(g.seed, g.params as unknown as CloudParams);
    expect(createHash('sha256').update(out).digest('hex')).toBe(g.outputSha256);
  });
});
