// A generator's output is part of the world: changing it is a new version, not an edit.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { generateBiomeTexture, VERSION, type BiomeTextureParams } from './v1.ts';

const record = parse(readFileSync(join(import.meta.dirname, '../biome.yaml'), 'utf8'));
const PARAMS = record.params as BiomeTextureParams;
const SEED = record.slots.globe.seed as string;

describe('biome texture generator v1', () => {
  it('is deterministic and unchanged (bump VERSION if this must change)', () => {
    expect(VERSION).toBe(1);
    expect(record.version).toBe(VERSION);
    const a = generateBiomeTexture(SEED, PARAMS);
    expect(generateBiomeTexture(SEED, PARAMS)).toEqual(a);
    expect(createHash('sha256').update(a).digest('hex')).toBe('3fc3a5f29663314844f12a48010f8188eb38f59fbae6db286b003c0301a1323f');
  });
  it('depends on the seed', () => {
    const small = { ...PARAMS, size: 32 };
    expect(generateBiomeTexture(SEED, small)).not.toEqual(generateBiomeTexture('other', small));
  });
  it('repeats in both directions, so the globe shows no seam in it', () => {
    const size = 64;
    const t = generateBiomeTexture(SEED, { ...PARAMS, size });
    const at = (x: number, y: number, c: number) => t[(y * size + x) * 4 + c];
    let across = 0;
    let along = 0;
    for (let i = 0; i < size; i++) {
      for (const c of [0, 1, 2]) {
        across = Math.max(across, Math.abs(at(0, i, c) - at(size - 1, i, c)));
        along = Math.max(along, Math.abs(at(i, 0, c) - at(i, size - 1, c)));
      }
    }
    // Neighbours across the seam differ no more than neighbours anywhere else.
    let inside = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x + 1 < size; x++) for (const c of [0, 1, 2]) inside = Math.max(inside, Math.abs(at(x, y, c) - at(x + 1, y, c)));
    expect(across).toBeLessThanOrEqual(inside);
    expect(along).toBeLessThanOrEqual(inside * 1.5);
  });
});
