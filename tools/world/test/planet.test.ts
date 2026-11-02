// The planet's state at a time: the phase that holds, how far through it the time is, and
// the ice of any glaciation, each following the scenario's picks and alternatives.
import { describe, expect, it } from 'vitest';
import { chosenClaim, lookAt, type PlanetFile, type StateClaim } from '../../../core/planet.ts';
import type { FeatureTime } from '../../../core/tileset.ts';

const span = (start: number, end: number | null): FeatureTime => ({
  start: { best: start, lo: start, hi: start, derived: false },
  end: { best: end, lo: end ?? Infinity, hi: end ?? Infinity, derived: false },
  instant: false,
});
const claim = (key: string, value: string | number, rank = 'normal', alt?: string): StateClaim => ({ claim: `x#${key}`, value, rank, alt, basis: 'reconstruction' });

const FILE: PlanetFile = {
  planet: {
    id: 'p',
    label: 'Planet',
    time: span(0, null),
    phases: [
      { subject: 'p@molten', label: 'Molten', time: span(0, 100), variants: { 'x#late': span(0, 200) }, values: { surface: [claim('s1', 'magma')], atmosphere: [claim('a1', 'steam')] } },
      { subject: 'p@wet', label: 'Wet', time: span(100, null), variants: { 'x#late': span(200, null) }, values: { surface: [claim('s2', 'ocean')] } },
    ],
  },
  episodes: [{ subject: 'ice', label: 'Ice age', time: span(500, 600), values: { ice_reach: [claim('hard', 0, 'preferred'), claim('belt', 12)] } }],
};

describe('the planet at a time', () => {
  it('has not formed before its record starts', () => {
    expect(lookAt(FILE, -1, {}).formed).toBe(false);
    expect(lookAt(FILE, 0, {}).formed).toBe(true);
  });

  it('is in the phase that holds, part of the way through it', () => {
    const a = lookAt(FILE, 25, {});
    expect(a.phase?.label).toBe('Molten');
    expect([a.surface, a.atmosphere]).toEqual(['magma', 'steam']);
    expect(a.progress).toBeCloseTo(0.25);
    // At a boundary the next phase has begun.
    expect(lookAt(FILE, 100, {}).phase?.label).toBe('Wet');
    expect(lookAt(FILE, 300, {}).atmosphere).toBeNull();
  });

  it('moves its phases with a pick that moves their dates', () => {
    expect(lookAt(FILE, 150, {}).surface).toBe('ocean');
    expect(lookAt(FILE, 150, { picks: ['x#late'] }).surface).toBe('magma');
    expect(lookAt(FILE, 150, { picks: ['x#late'] }).progress).toBeCloseTo(0.75);
  });

  it('has ice during a glaciation, as far as the chosen claim says', () => {
    expect(lookAt(FILE, 400, {}).iceReach).toBe(90);
    const hard = lookAt(FILE, 550, {});
    expect(hard.iceReach).toBe(0);
    expect(hard.ice?.label).toBe('Ice age');
    expect(lookAt(FILE, 550, { picks: ['x#belt'] }).iceReach).toBe(12);
  });

  it('chooses among competing claims as the chronology does', () => {
    const cs = [claim('a', 1), claim('b', 2)];
    expect(chosenClaim(cs, {})).toBeUndefined();
    expect(chosenClaim([...cs, claim('c', 3, 'preferred')], {})?.value).toBe(3);
    expect(chosenClaim([claim('d', 4, 'deprecated'), claim('e', 5)], {})?.value).toBe(5);
    // An alternative's own claims replace the default picture's.
    const alt = [claim('f', 6, 'preferred'), claim('g', 7, 'normal', 'alt:x')];
    expect(chosenClaim(alt, {})?.value).toBe(6);
    expect(chosenClaim(alt, { alts: ['alt:x'] })?.value).toBe(7);
  });
});
