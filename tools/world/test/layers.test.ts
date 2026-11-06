// Rows of a dataset drawn over the globe: today's map, and the hazards of NOAA's databases.
import { describe, expect, it } from 'vitest';
import { hazardsNear, insideRow, politiesAt, type HazardFile, type PolitiesFile } from '../../../core/layers.ts';
import { fromWorldMercator, hazardOf, linesOf, placeOf, polityRow, thin } from '../src/build/layers.ts';
import { hazardRow } from '../src/noaa.ts';

describe('a row of NOAA’s hazard databases', () => {
  it('keeps what the panel shows, by kind', () => {
    expect(hazardRow('eruption', { id: 1, year: 1883, month: 8, day: 27, name: 'Krakatau', country: 'Indonesia', latitude: -6.1, longitude: 105.4, vei: 6, deathsTotal: 36000 })).toEqual({ kind: 'eruption', id: 1, year: 1883, month: 8, day: 27, lat: -6.1, lon: 105.4, name: 'Krakatau, Indonesia', size: 6, deaths: 36000 });
    expect(hazardRow('earthquake', { id: 2, year: -2150, locationName: 'JORDAN', latitude: 31.1, longitude: 35.5, eqMagnitude: 7.3 })).toEqual({ kind: 'earthquake', id: 2, year: -2150, lat: 31.1, lon: 35.5, name: 'JORDAN', size: 7.3 });
  });

  it('leaves out what has no place to draw it, and the tsunamis the database doubts', () => {
    expect(hazardRow('earthquake', { id: 3, year: 100, locationName: 'X' })).toBeUndefined();
    expect(hazardRow('tsunami', { id: 4, year: 100, locationName: 'X', latitude: 1, longitude: 1, eventValidity: 2 })).toBeUndefined();
    expect(hazardRow('tsunami', { id: 5, year: 100, locationName: 'X', latitude: 1, longitude: 1, eventValidity: 4, tsIntensity: 2 })?.size).toBe(2);
  });

  it('comes onto the world’s axis, which has a year zero where the database has none', () => {
    const base = { kind: 'earthquake' as const, id: 1, lat: 0, lon: 0, name: 'x' };
    // 2150 BC is astronomical year −2149.
    const old = hazardOf({ ...base, year: -2150 });
    expect(Math.floor(old.t)).toBe(-2149);
    expect(old.when).toContain('2150 BCE');
    // 27 August 1883 falls about two thirds of the way through the year.
    const day = hazardOf({ ...base, year: 1883, month: 8, day: 27 });
    expect(day.t).toBeGreaterThan(1883.65);
    expect(day.t).toBeLessThan(1883.68);
    expect(day.when).toBe('27 August 1883 CE');
    // A year alone is held at its middle.
    expect(hazardOf({ ...base, year: 1000 }).t).toBe(1000.5);
  });

  it('is found near a time, however many there are', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ kind: 'eruption' as const, t: i, when: '', lat: 0, lon: 0, name: String(i) }));
    const file: HazardFile = { format: 'lightworld-hazards@1', title: '', source: 's', rows };
    expect(hazardsNear(file, 500, 2).map((r) => r.t)).toEqual([498, 499, 500, 501, 502]);
    expect(hazardsNear(file, -100, 2)).toEqual([]);
    expect(hazardsNear(file, 999.5, 1).map((r) => r.t)).toEqual([999]);
  });
});

describe('today’s map', () => {
  it('keeps its borders as hundredths of a degree, without repeated points', () => {
    expect(linesOf({ type: 'LineString', coordinates: [[1.234, 5.678], [1.2341, 5.6781], [2, 6]] })).toEqual([[123, 568, 200, 600]]);
    expect(linesOf({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] })).toEqual([[0, 0, 100, 100], [200, 200, 300, 300]]);
  });

  it('keeps what a place needs', () => {
    expect(placeOf({ name: 'Rome', adm0name: 'Italy', longitude: 12.48, latitude: 41.9, pop_max: 3339000, adm0cap: 1 })).toEqual({ name: 'Rome', country: 'Italy', lon: 12.48, lat: 41.9, pop: 3339000, capital: true });
  });
});

describe('the world’s states', () => {
  const square = (name: string, x: number, from: number, to: number) => ({
    properties: { Name: name, FromYear: from, ToYear: to, Area: 1000 },
    geometry: { type: 'Polygon' as const, coordinates: [[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]]] },
  });

  it('are thinned to within a tolerance of their outlines, keeping the ends', () => {
    // A straight line loses its middle; a corner stays.
    expect(thin([0, 0, 50, 1, 100, 0], 5)).toEqual([0, 0, 100, 0]);
    expect(thin([0, 0, 50, 90, 100, 0], 5)).toEqual([0, 0, 50, 90, 100, 0]);
    expect(thin([0, 0, 100, 0], 5)).toEqual([0, 0, 100, 0]);
  });

  it('come onto the world’s axis, where a row holds to the end of its last year', () => {
    const r = polityRow(square('A', 0, -100, -50), 0.01)!;
    expect(r.from).toBe(-99);
    expect(r.to).toBe(-48);
    expect(r.area).toBe(1000);
    expect(r.at[0]).toBeGreaterThan(0);
    // A sliver that thins away is no row.
    expect(polityRow({ properties: { Name: 'B', FromYear: 1, ToYear: 2, Area: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.001, 0.001], [0, 0.002], [0, 0]]] } }, 1)).toBeUndefined();
  });

  it('hold for their years, and contain what is inside them', () => {
    const a = polityRow(square('A', 0, 100, 200), 0.01)!;
    const b = polityRow(square('B', 20, 150, 300), 0.01)!;
    const file: PolitiesFile = { format: 'lightworld-polities@1', title: '', source: 's', rows: [a, b] };
    expect(politiesAt(file, 120).map((r) => r.name)).toEqual(['A']);
    expect(politiesAt(file, 180).map((r) => r.name)).toEqual(['A', 'B']);
    expect(politiesAt(file, 201).map((r) => r.name)).toEqual(['B']);
    expect(politiesAt(file, 50)).toEqual([]);
    expect(insideRow(a, 5, 5)).toBe(true);
    expect(insideRow(a, 15, 5)).toBe(false);
    expect(insideRow(b, 25, 5)).toBe(true);
  });
});

describe('the roads of a dataset', () => {
  it('come out of the world Mercator projection', () => {
    expect(fromWorldMercator(0, 0)).toEqual([0, 0]);
    // A degree of longitude on the WGS 84 equator, and the projection's y at 60° north.
    expect(fromWorldMercator(111319.49079327358, 0)[1]).toBeCloseTo(1, 9);
    const [lat] = fromWorldMercator(0, 8362698.5);
    expect(lat).toBeCloseTo(60, 2);
  });
});
