// A generator's output is part of the world: changing it is a new version, not an edit.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { generateSurface, VERSION, type SurfaceParams } from './v1.ts';

const record = parse(readFileSync(join(import.meta.dirname, '../surface.yaml'), 'utf8'));
const DEFAULT_PARAMS = record.params as SurfaceParams;

describe('surface generator v1', () => {
  it('is deterministic and unchanged (bump VERSION if this must change)', () => {
    expect(VERSION).toBe(1);
    expect(record.version).toBe(VERSION);
    const a = generateSurface('earth/surface', DEFAULT_PARAMS);
    const b = generateSurface('earth/surface', DEFAULT_PARAMS);
    expect(a).toEqual(b);
    expect(createHash('sha256').update(a).digest('hex')).toBe('c5f3b4e0daac0829ed2483b4f3feeaa8208d5b2214480adad69e5168f194c3c4');
  });
  it('depends on the seed', () => {
    const small = { ...DEFAULT_PARAMS, width: 64, height: 32 };
    expect(generateSurface('earth/surface', small)).not.toEqual(generateSurface('other', small));
  });
  it('orders crust from plate interiors to the cracks between them', () => {
    const p = { ...DEFAULT_PARAMS, width: 128, height: 64 };
    const px = generateSurface('earth/surface', p);
    const order = Array.from({ length: p.width * p.height }, (_, i) => px[i * 4]);
    // Every share of the surface crusts over at some point in the phase: early and late spots both exist.
    expect(Math.min(...order)).toBeLessThan(60);
    expect(Math.max(...order)).toBeGreaterThan(220);
    // Most of the surface is plate interior, which crusts over in the first half.
    expect(order.filter((v) => v < 128).length / order.length).toBeGreaterThan(0.5);
  });
});
