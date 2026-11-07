// The climate at a height (model:earth/lapse-rate): months moved up a mountain by the lapse rate, the classes they give
// there, the snow lying in each month, and the tiles a scene reads them from.
import { describe, expect, it } from 'vitest';
import { atHeight, classAtHeight, decodeRain, encodeRain, MonthsTile, nearestNode, snowInMonth, snowLine, tileKey, tilesNear, warmestMonth, type Months, type MonthsTileHeader } from './months.ts';
import type { ClimateRule } from './climate.ts';
import type { WaterParams } from './water.ts';
import { decodeTile } from './container.ts';
import { monthsFiles, monthsOfRun, type ClimateKeyframe } from '../tools/world/src/build/climate.ts';
import { climateGrid } from '../tools/world/src/build/climate.ts';

// The values of the records: world/fields/earth/climate-at-height.yaml, biome.yaml and runoff.yaml.
const LAPSE = 5.8;
const RULE: ClimateRule = { polar: 10, frost: 0, tropical: 18, cold: 0, arid: 1, desert: 0.5 };
const W: WaterParams = { hamon: { a: 13.97, b: 4.95, c: 0.062 }, t_rain: 3.3, t_snow: -10, t_snow_high: -1, high_m: 1000, melt_max: 0.5, direct: 0.05, soil_mm: 150, rfactor: 0.5, obliquity_deg: 23.44, equinox_day: 80 };

// A wet equatorial lowland, and a temperate one with cold winters (both made up, to test the rules).
const TROPICS: Months = { t: [26, 26.5, 27, 26.5, 26, 25.5, 25, 25.5, 26, 26.5, 26.5, 26], p: Array(12).fill(220) };
const TEMPERATE: Months = { t: [-2, -1, 3, 8, 13, 17, 19, 18, 14, 9, 4, 0], p: Array(12).fill(80) };

describe('the climate at a height', () => {
  it('cools the months up a mountain by the lapse rate, with the same rain', () => {
    const up = atHeight(TEMPERATE, 1000, LAPSE);
    up.t.forEach((t, m) => expect(t).toBeCloseTo(TEMPERATE.t[m] - 5.8, 9));
    expect(up.p).toEqual(TEMPERATE.p);
    expect(atHeight(TEMPERATE, -500, LAPSE).t[6]).toBeCloseTo(19 + 2.9, 9);
    expect(warmestMonth(TEMPERATE)).toBe(7);
    // The tiles keep a month's rain to within a few per cent, and a dry one to a fraction of a millimetre.
    for (const mm of [20, 90, 400, 1500, 3500]) expect(Math.abs(decodeRain(encodeRain(mm)) - mm) / mm).toBeLessThan(0.06);
    expect(decodeRain(encodeRain(0))).toBe(0);
    expect(Math.abs(decodeRain(encodeRain(1.2)) - 1.2)).toBeLessThan(0.3);
    expect(warmestMonth({ t: [20, 21, 19, 15, 10, 6, 5, 7, 10, 14, 17, 19], p: Array(12).fill(50) })).toBe(2);
  });

  it('brings a tropical mountain to tundra and then ice where the Köppen thresholds say', () => {
    expect(classAtHeight(TROPICS, 0, LAPSE, RULE)).toBe('rainforest');
    // The warmest month, 27 °C, falls to 10 °C after 17 / 5.8 km, and to 0 °C after 27 / 5.8 km.
    expect(classAtHeight(TROPICS, 2800, LAPSE, RULE)).not.toBe('tundra');
    expect(classAtHeight(TROPICS, 3000, LAPSE, RULE)).toBe('tundra');
    expect(classAtHeight(TROPICS, 4600, LAPSE, RULE)).not.toBe('ice');
    expect(classAtHeight(TROPICS, 4700, LAPSE, RULE)).toBe('ice');
  });

  it('lays snow lower in winter than in summer', () => {
    // January's snow lies on the lowland itself, below freezing all winter; in July, only high up. The lowland keeps a
    // trace of it into the summer, as the model melts at most half the snow in a month, but less than is drawn.
    expect(snowInMonth(TEMPERATE, 1, 45, 200, W)).toBeGreaterThan(10);
    expect(snowInMonth(TEMPERATE, 7, 45, 200, W)).toBeLessThan(10);
    const jan = snowLine(TEMPERATE, 1, 45, 200, W, LAPSE, 10, 0, 5000, 25);
    const jul = snowLine(TEMPERATE, 7, 45, 200, W, LAPSE, 10, 0, 5000, 25);
    expect(jan).toBeLessThan(200);
    expect(jul).toBeGreaterThan(2000);
    expect(jul).toBeLessThan(5000);
    // And none on a tropical lowland, in any month.
    for (let m = 1; m <= 12; m++) expect(snowLine(TROPICS, m, 0, 0, W, LAPSE, 10, 0, 1000, 25)).toBe(Infinity);
  });

  it('reads back a node from its tile, near its edge, as the build wrote it', () => {
    // A run on a 1° grid with land only at two cells, at 9°E and 10°E: one each side of a tile's edge at 10°E.
    const grid = climateGrid(1);
    const lat = [5];
    const lon = [8.8, 10.4];
    const land = [1, 1];
    const t: number[] = [];
    const p: number[] = [];
    for (let m = 0; m < 12; m++) {
      t.push(TEMPERATE.t[m], TEMPERATE.t[m] + 1);
      p.push(TEMPERATE.p[m], 90);
    }
    const months = monthsOfRun(grid, lat, lon, land, t, p, (_j, i) => [400, 900][i]);
    const keys = [{ ageMa: 0, frameMa: 0, values: new Uint8Array(0), plate: new Uint16Array(0), nodes: new Float32Array(0), months }] as ClimateKeyframe[];
    const out = monthsFiles('field:test', 'months/test', grid, keys, 10);
    expect(Object.keys(out.tiles)).toEqual([tileKey(9, 5, 10), tileKey(10, 5, 10)].sort());
    // A place just west of the edge reads the tiles on both sides of it, and finds the east node nearer.
    const set = { step: 1, tile_deg: 10 };
    const tiles = tilesNear(5, 9.8, set).filter((k) => out.tiles[k]).map((k) => {
      const { header, arrays } = decodeTile<MonthsTileHeader>(out.files.get(out.tiles[k])!.slice().buffer as ArrayBuffer);
      return new MonthsTile(header, arrays as unknown as ArrayLike<number>[]);
    });
    expect(tiles).toHaveLength(2);
    const a = nearestNode(tiles, 0, 5, 9.8)!;
    expect(a.lon).toBe(10);
    expect(a.height).toBe(900);
    expect(a.months.t[6]).toBe(20);
    // Rain as the tiles keep it: to a few per cent.
    expect(a.months.p[0]).toBeCloseTo(90, -0.5);
    expect(nearestNode(tiles, 0, 5, 9.2)!.height).toBe(400);
    expect(nearestNode(tiles, 0, 20, 9.4)).toBeUndefined();
  });
});
