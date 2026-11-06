// The coverage chart's counting (core/coverage.ts): columns that tile the span along the time control's scale,
// places that share the globe's area, and shares that add up, on a made-up world.
import { describe, expect, it } from 'vitest';
import { columnTimes, coverageColumns, coverageMatrix, coveragePlaces, decodeRuns, encodeRuns } from './coverage.ts';
import type { PlanetFile } from './planet.ts';
import { LAYERS, TIERS, type ResolveWorld } from './resolve.ts';
import type { FeatureTime } from './tileset.ts';
import { positionOf } from './timescale.ts';

const span = (a: number, b: number): FeatureTime => ({ start: { best: a, lo: a, hi: a, derived: false }, end: { best: b, lo: b, hi: b, derived: false }, instant: false });
const GA = (ga: number) => 1950 - ga * 1e9;
const PLANET: PlanetFile = {
  planet: {
    id: 'test/earth',
    label: 'Earth',
    time: span(GA(4.5), GA(-3)),
    phases: [{ subject: 'test/earth@oceans', label: 'Oceans', time: span(GA(4.5), GA(-3)), values: { surface: [{ claim: 'test/earth@oceans#s', value: 'ocean', rank: 'normal', basis: 'reconstruction' }] } }],
  },
  episodes: [],
};
const WORLD: ResolveWorld = {
  planet: PLANET,
  geography: [{ title: 'A map', mode: 'elevation', coverage: [GA(0.5), 1950] }],
  genericLand: (lat) => lat > 45,
};
const RANGE: [number, number] = [GA(4.6), GA(-3)];

describe('coverage', () => {
  it('cuts the span into columns of equal room on the time control, end to end', () => {
    const cols = coverageColumns(RANGE, 40);
    expect(cols.length).toBe(40);
    expect(cols[0][0]).toBe(RANGE[0]);
    expect(cols.at(-1)![1]).toBe(RANGE[1]);
    const widths = cols.map(([a, b]) => positionOf(b) - positionOf(a));
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i][0]).toBe(cols[i - 1][1]);
      expect(widths[i]).toBeCloseTo(widths[0], 6);
    }
    for (const t of columnTimes(cols[7], 3)) expect(t > cols[7][0] && t < cols[7][1]).toBe(true);
  });

  it('weighs each place by the area it stands for, from the north', () => {
    const places = coveragePlaces(10);
    expect(places.length).toBe(18 * 36);
    expect(places.reduce((a, p) => a + p.area, 0)).toBeCloseTo(1, 12);
    expect(places[0].lat).toBe(85);
    expect(places[0].lon).toBe(-175);
    // A cell at the equator stands for more of the globe than one at the pole.
    expect(places[9 * 36].area).toBeGreaterThan(places[0].area * 10);
  });

  it('writes a map as runs, and reads it back', () => {
    const codes = ['g', 'g', 'g', 'm', 'u', 'u', 'e'];
    expect(encodeRuns(codes)).toBe('g3m1u2e1');
    expect(decodeRuns('g3m1u2e1')).toEqual(['generic', 'generic', 'generic', 'model', 'unknown', 'unknown', 'evidence']);
  });

  it('counts every layer at every place, with shares that add up and maps of the whole grid', () => {
    const m = coverageMatrix(WORLD, RANGE, 24, 10, 3, []);
    expect(m.layers.map((l) => l.layer)).toEqual([...LAYERS]);
    for (const l of m.layers) {
      expect(l.cells.length).toBe(24);
      for (const c of l.cells) {
        expect(c.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
        expect(decodeRuns(c.map).length).toBe(18 * 36);
        for (const [k] of c.why) expect(m.whys[k]).toBeTruthy();
      }
    }
    const geo = m.layers.find((l) => l.layer === 'geography')!.cells;
    const at = (t: number) => geo[m.columns.findIndex(([a, b]) => a <= t && t < b)];
    // Under the map, a model answers everywhere; before it, generic land, its land poleward of 45° N.
    expect(at(GA(0.1)).share[TIERS.indexOf('model')]).toBe(1);
    const early = at(GA(2));
    expect(early.share[TIERS.indexOf('generic')]).toBe(1);
    const tiers = decodeRuns(early.map);
    expect(tiers.every((t) => t === 'generic')).toBe(true);
  });
});
