// Pass criteria: a polity's territory at a time is the rows of its chosen claim that hold
// then, only while the polity exists, and a click resolves inside its polygons, holes out.
import { describe, expect, it } from 'vitest';
import { contains, territoriesAt, type Territory, type TerritoryRow } from '../../../core/territory.ts';
import type { FeatureTime } from '../../../core/tileset.ts';

const span = (start: number, end: number): FeatureTime => ({
  start: { best: start, lo: start, hi: start, derived: false },
  end: { best: end, lo: end, hi: end, derived: false },
  instant: false,
});

/** A square from (x0, y0) to (x1, y1) in degrees, as a ring in hundredths. */
const square = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0].map((v) => v * 100);

const row = (name: string, from: number, to: number, rings: number[][]): TerritoryRow => ({ name, from, to, area: 1, at: [0, 0], rings });

const rome: Territory = {
  subject: 'x/rome',
  label: 'Rome',
  time: span(-752, 1453),
  variants: { 'x/rome#end-late': span(-752, 1461) },
  claims: [
    {
      claim: 'x/rome#territory',
      value: 'A, B',
      rank: 'preferred',
      basis: 'reconstruction',
      source: 'src:d',
      rows: [row('A', -800, -400, [square(10, 40, 14, 44)]), row('B', -420, 1470, [square(0, 30, 40, 50), square(10, 40, 14, 44)])],
    },
    { claim: 'x/rome#territory-other', value: 'C', rank: 'normal', basis: 'reconstruction', source: 'src:e', rows: [row('C', -800, 1470, [square(-5, -5, 5, 5)])] },
  ],
};

describe('territory', () => {
  it('fills even-odd: inside a ring, outside its hole', () => {
    const r = row('B', 0, 1, [square(0, 30, 40, 50), square(10, 40, 14, 44)]);
    expect(contains(r, 5, 35)).toBe(true);
    expect(contains(r, 12, 42)).toBe(false);
    expect(contains(r, 45, 35)).toBe(false);
  });

  it('holds the rows of the chosen claim for their years, only while the polity exists', () => {
    const file = { territories: [rome] };
    expect(territoriesAt(file, -900, {})).toEqual([]);
    // Before its start the polity does not exist, though its row does.
    expect(territoriesAt(file, -760, {})).toEqual([]);
    expect(territoriesAt(file, -500, {})[0].rows.map((r) => r.name)).toEqual(['A']);
    // Rows that overlap in time both hold.
    expect(territoriesAt(file, -410, {})[0].rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(territoriesAt(file, 1455, {})).toEqual([]);
  });

  it('follows the picks: another claim, or a lifetime that a competing date moves', () => {
    const file = { territories: [rome] };
    expect(territoriesAt(file, 100, { picks: ['x/rome#territory-other'] })[0].rows.map((r) => r.name)).toEqual(['C']);
    expect(territoriesAt(file, 1455, { picks: ['x/rome#end-late'] })[0].rows.map((r) => r.name)).toEqual(['B']);
  });
});

describe('an outline written in a claim (docs/STRUCTURE.md section 5)', () => {
  it('covers about the area it encloses on the sphere', async () => {
    const { areaKm2 } = await import('../src/build/territory.ts');
    const { TERRITORY_SCALE } = await import('../../../core/territory.ts');
    const square = (lat: number) => [[0, lat, 1, lat, 1, lat + 1, 0, lat + 1].map((x) => x * TERRITORY_SCALE)];
    // A degree square is about 111 km on a side at the equator, and half as wide at 60°.
    expect(areaKm2(square(0))).toBeCloseTo(12392, -2);
    expect(areaKm2(square(60)) / areaKm2(square(0))).toBeCloseTo(0.49, 1);
  });
});
