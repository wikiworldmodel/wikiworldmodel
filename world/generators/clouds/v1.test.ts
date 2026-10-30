// A generator's output is part of the world: changing it is a new version, not an edit.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateClouds, sinCosDeg, VERSION } from './v1.ts';

describe('clouds generator v1', () => {
  it('is deterministic and unchanged (bump VERSION if this must change)', () => {
    expect(VERSION).toBe(1);
    const a = generateClouds('earth/clouds', DEFAULT_PARAMS);
    const b = generateClouds('earth/clouds', DEFAULT_PARAMS);
    expect(a).toEqual(b);
    expect(createHash('sha256').update(a).digest('hex')).toBe('0e6161e2213adc4c5fd51f5d4e55ae8ffa9651a40a99ed6dd165438ac98c7ef4');
  });
  it('depends on the seed', () => {
    const a = generateClouds('earth/clouds', { ...DEFAULT_PARAMS, width: 64, height: 32 });
    const b = generateClouds('other', { ...DEFAULT_PARAMS, width: 64, height: 32 });
    expect(a).not.toEqual(b);
  });
  it('has a sine accurate to 1e-12 without Math.sin', () => {
    for (let d = -720; d <= 720; d += 7.3) {
      const [s, c] = sinCosDeg(d);
      expect(Math.abs(s - Math.sin((d * Math.PI) / 180))).toBeLessThan(1e-12);
      expect(Math.abs(c - Math.cos((d * Math.PI) / 180))).toBeLessThan(1e-12);
    }
  });
});
